import {
  PluginConfig,
  LLMConfig,
  DEFAULT_LLM_CONFIG,
  ExtensionState,
  DEFAULT_EXTENSION_STATE,
  DEFAULT_ASR_LANGUAGE,
  normalizeAsrLanguage
} from '../types/config';
import { MindmapData } from '../types/mindmap';
import { StorageMigration } from './storage/migration';
import { VideoUtils } from '../utils/videoUtils';

const STORAGE_KEYS = {
  CONFIG: 'plugin_config',
  LLM_CONFIGS: 'llm_configs',
  MINDMAPS: 'mindmaps',
  LATEST_MINDMAP_ID: 'latest_mindmap_id',
  EXTENSION_STATE: 'extension_state',
  // v2：早期版本把识别语言写死成中文，缓存里存的是英文视频的「中文译稿」，
  // 升级后这些缓存必须全部作废（换前缀即天然失效），否则修复后仍会命中错内容。
  ASR_CACHE_PREFIX: 'asr_cache_v2_',
  // v2：ASR 结果也会写入字幕缓存，旧版本存的是「英文视频被强制识别成中文」的译稿，
  // 且读取时优先于 ASR 缓存，不换前缀会让修复后仍然读到旧中文。官方字幕缓存丢掉可重下。
  SUBTITLE_CACHE_PREFIX: 'subtitle_cache_v2_',
  PHASE1_CACHE_PREFIX: 'phase1_cache_',
  CACHE_INDEX: 'cache_index_v1',
  SCHEMA_VERSION: 'storage_schema_version'
} as const;

const SCHEMA_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 缓存策略：文本缓存按类型设 TTL 与数量上限，避免本地存储无限增长 */
const CACHE_POLICY = {
  subtitle: { ttlMs: 30 * DAY_MS, maxEntries: 300 },
  asr: { ttlMs: 30 * DAY_MS, maxEntries: 150 },
  phase1: { ttlMs: 3 * DAY_MS, maxEntries: 30 }
} as const;

type CacheKind = keyof typeof CACHE_POLICY;
type CacheIndexEntry = {
  kind: CacheKind;
  /** 字符数，用于近似容量治理 */
  size: number;
  updatedAt: number;
  expiresAt: number;
};

/** 缓存总量软上限（字符数）；超过后按最久未更新淘汰 */
const CACHE_SOFT_LIMIT_CHARS = 6 * 1024 * 1024;
const MINDMAP_LIMIT = 30;
const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;

function now(): number {
  return Date.now();
}

function isQuotaError(error: unknown): boolean {
  const message = String((error as any)?.message || error);
  return /QUOTA_BYTES|quota/i.test(message);
}

export class StorageService {
  /** 配置 / LLM 配置 / 缓存的写操作都串行化，避免并发读改写互相覆盖 */
  private static configWriteChain: Promise<void> = Promise.resolve();
  private static llmWriteChain: Promise<void> = Promise.resolve();
  private static mindmapWriteChain: Promise<void> = Promise.resolve();
  private static cacheLock: Promise<void> = Promise.resolve();

  private static cacheIndex: Record<string, CacheIndexEntry> | null = null;
  private static cacheIndexLoaded = false;
  /** 配额恢复过程中避免 localSet 递归触发 prune */
  private static recoveringQuota = false;

  private static withLock<T>(chainRef: 'configWriteChain' | 'llmWriteChain' | 'mindmapWriteChain', fn: () => Promise<T>): Promise<T> {
    const previous = this[chainRef];
    const run = previous.then(fn, fn);
    this[chainRef] = run.then(() => undefined, () => undefined);
    return run;
  }

  private static withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.cacheLock.then(fn, fn);
    this.cacheLock = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * 写本地存储；遇到配额错误时先清理缓存再重试一次。
   * 不吞掉最终错误，让设置页能显示「存储已满」而不是静默丢失。
   */
  private static async localSet(items: Record<string, unknown>): Promise<void> {
    try {
      await chrome.storage.local.set(items);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      if (this.recoveringQuota) throw error;
      console.warn('[StorageService] 本地存储配额不足，正在清理旧缓存后重试');
      this.recoveringQuota = true;
      try {
        // 这里可能已经持有 cacheLock，不能再调用会抢锁的 pruneCaches()
        const index = await this.readCacheIndex();
        await this.pruneIndex(index, true);
        await chrome.storage.local.set(items);
      } finally {
        this.recoveringQuota = false;
      }
    }
  }

  // ------------------------------------------------------------------ //
  // 配置（本地存储：避免 sync 单条 8KB 配额 + API Key 同步到云端）
  // ------------------------------------------------------------------ //

  static async getConfig(): Promise<PluginConfig | null> {
    const local = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
    let config = local[STORAGE_KEYS.CONFIG];

    if (!config) {
      // 从旧版 chrome.storage.sync 迁移一次；迁移后从 sync 删除，避免密钥留在云端。
      try {
        const synced = await chrome.storage.sync.get(STORAGE_KEYS.CONFIG);
        config = synced[STORAGE_KEYS.CONFIG];
        if (config) {
          await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config });
          await chrome.storage.sync.remove(STORAGE_KEYS.CONFIG);
          console.log('[StorageService] 已把配置从 storage.sync 迁移到 storage.local');
        }
      } catch (error) {
        console.warn('[StorageService] 读取 sync 配置失败:', error);
      }
    }

    if (!config) return null;
    return StorageMigration.normalizeConfig(config);
  }

  static async saveConfig(config: PluginConfig): Promise<void> {
    await this.withLock('configWriteChain', async () => {
      const cleanConfig = { ...config } as any;
      delete cleanConfig.llm;
      await this.localSet({ [STORAGE_KEYS.CONFIG]: cleanConfig });
    });
  }

  // ------------------------------------------------------------------ //
  // LLM 配置（本地存储：密钥不进入 sync）
  // ------------------------------------------------------------------ //

  private static async getLLMConfigsRaw(): Promise<LLMConfig[]> {
    const local = await chrome.storage.local.get(STORAGE_KEYS.LLM_CONFIGS);
    const localConfigs = local[STORAGE_KEYS.LLM_CONFIGS];
    if (Array.isArray(localConfigs) && localConfigs.length > 0) return localConfigs;

    // 旧版把 LLM 配置写在 sync；迁移到 local 并清掉 sync 副本
    try {
      const synced = await chrome.storage.sync.get(STORAGE_KEYS.LLM_CONFIGS);
      const syncedConfigs = synced[STORAGE_KEYS.LLM_CONFIGS];
      if (Array.isArray(syncedConfigs) && syncedConfigs.length > 0) {
        await chrome.storage.local.set({ [STORAGE_KEYS.LLM_CONFIGS]: syncedConfigs });
        await chrome.storage.sync.remove(STORAGE_KEYS.LLM_CONFIGS);
        console.log('[StorageService] 已把 LLM 配置从 storage.sync 迁移到 storage.local');
        return syncedConfigs;
      }
    } catch (error) {
      console.warn('[StorageService] 读取 sync LLM 配置失败:', error);
    }

    return [];
  }

  static async getLLMConfigs(): Promise<LLMConfig[]> {
    const configs = await this.getLLMConfigsRaw();
    if (configs.length > 0) return configs;

    // 旧版单一 LLM 配置迁移（plugin_config.llm）
    const pluginConfig = await this.getConfig();
    if (pluginConfig) {
      const migrated = StorageMigration.migrateToLLMConfigs(pluginConfig);
      if (migrated) {
        await this.saveLLMConfig(migrated);
        await this.saveConfig({ ...pluginConfig, selectedLLMConfigId: migrated.id });
        return [migrated];
      }
    }
    return [DEFAULT_LLM_CONFIG];
  }

  static async getLLMConfigById(id: string): Promise<LLMConfig | null> {
    const configs = await this.getLLMConfigs();
    return configs.find(c => c.id === id) || null;
  }

  static async getSelectedLLMConfig(): Promise<LLMConfig | null> {
    const pluginConfig = await this.getConfig();
    const selectedId = pluginConfig?.selectedLLMConfigId || 'default';
    const configs = await this.getLLMConfigs();
    return configs.find(c => c.id === selectedId) || configs[0] || null;
  }

  static async saveLLMConfig(config: LLMConfig): Promise<void> {
    await this.withLock('llmWriteChain', async () => {
      const configs = [...await this.getLLMConfigsRaw()];
      const existingIndex = configs.findIndex(c => c.id === config.id);
      const stamped = { ...config, updatedAt: now() };
      if (existingIndex >= 0) configs[existingIndex] = stamped;
      else configs.push(stamped);
      await this.localSet({ [STORAGE_KEYS.LLM_CONFIGS]: configs });
    });
  }

  static async deleteLLMConfig(id: string): Promise<boolean> {
    return this.withLock('llmWriteChain', async () => {
      const configs = await this.getLLMConfigsRaw();
      if (configs.length <= 1) return false;

      const filtered = configs.filter(c => c.id !== id);
      await this.localSet({ [STORAGE_KEYS.LLM_CONFIGS]: filtered });

      const pluginConfig = await this.getConfig();
      if (pluginConfig && pluginConfig.selectedLLMConfigId === id && filtered[0]) {
        await this.setSelectedLLMConfig(filtered[0].id);
      }
      return true;
    });
  }

  static async setSelectedLLMConfig(id: string): Promise<void> {
    const pluginConfig = await this.getConfig();
    const selectedConfig = await this.getLLMConfigById(id);
    if (pluginConfig && selectedConfig) {
      await this.saveConfig({ ...pluginConfig, selectedLLMConfigId: id });
    }
  }

  // ------------------------------------------------------------------ //
  // 思维导图
  // ------------------------------------------------------------------ //

  static async getMindmaps(): Promise<MindmapData[]> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MINDMAPS);
    const mindmaps = result[STORAGE_KEYS.MINDMAPS];
    return Array.isArray(mindmaps) ? mindmaps : [];
  }

  static async saveMindmap(mindmap: MindmapData): Promise<void> {
    await this.withLock('mindmapWriteChain', async () => {
      const mindmaps = await this.getMindmaps();
      const existingIndex = mindmaps.findIndex(m => m.id === mindmap.id);
      if (existingIndex >= 0) {
        mindmaps[existingIndex] = mindmap;
      } else {
        mindmaps.unshift(mindmap);
      }
      if (mindmaps.length > MINDMAP_LIMIT) mindmaps.splice(MINDMAP_LIMIT);

      await this.localSet({
        [STORAGE_KEYS.MINDMAPS]: mindmaps,
        [STORAGE_KEYS.LATEST_MINDMAP_ID]: mindmap.id
      });
    });

    // 导图可能很大，写入后顺手做一次容量治理（不阻塞主流程）
    void this.pruneCaches();
  }

  static async getLatestMindmapByUrl(videoUrl: string): Promise<MindmapData | null> {
    const mindmaps = await this.getMindmaps();
    return mindmaps.find(m => VideoUtils.isSameVideo(m.videoUrl, videoUrl)) || null;
  }

  static async deleteMindmapByUrl(videoUrl: string): Promise<void> {
    await this.withLock('mindmapWriteChain', async () => {
      const mindmaps = await this.getMindmaps();
      const filtered = mindmaps.filter(m => !VideoUtils.isSameVideo(m.videoUrl, videoUrl));
      if (filtered.length === mindmaps.length) return;

      const latest = await chrome.storage.local.get(STORAGE_KEYS.LATEST_MINDMAP_ID);
      const latestId = latest[STORAGE_KEYS.LATEST_MINDMAP_ID];
      const latestStillExists = filtered.some(m => m.id === latestId);

      const updates: Record<string, unknown> = { [STORAGE_KEYS.MINDMAPS]: filtered };
      if (!latestStillExists) {
        updates[STORAGE_KEYS.LATEST_MINDMAP_ID] = filtered[0]?.id || '';
      }
      await this.localSet(updates);
    });
  }

  static async getLatestMindmap(): Promise<MindmapData | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LATEST_MINDMAP_ID);
    const latestId = result[STORAGE_KEYS.LATEST_MINDMAP_ID];
    if (!latestId) return null;
    const mindmaps = await this.getMindmaps();
    return mindmaps.find(m => m.id === latestId) || null;
  }

  static async clearMindmaps(): Promise<void> {
    await this.withLock('mindmapWriteChain', async () => {
      await chrome.storage.local.remove([
        STORAGE_KEYS.MINDMAPS,
        STORAGE_KEYS.LATEST_MINDMAP_ID
      ]);
    });
  }

  // ------------------------------------------------------------------ //
  // 扩展状态
  // ------------------------------------------------------------------ //

  static async getExtensionState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.EXTENSION_STATE);
    return result[STORAGE_KEYS.EXTENSION_STATE] || DEFAULT_EXTENSION_STATE;
  }

  static async saveExtensionState(state: ExtensionState): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.EXTENSION_STATE]: state });
  }

  static async togglePaused(): Promise<boolean> {
    const state = await this.getExtensionState();
    const newPausedState = !state.isPaused;
    await this.saveExtensionState({ ...state, isPaused: newPausedState });
    return newPausedState;
  }

  static async isPaused(): Promise<boolean> {
    const state = await this.getExtensionState();
    return state.isPaused;
  }

  // ------------------------------------------------------------------ //
  // 缓存索引与容量治理
  // ------------------------------------------------------------------ //

  private static isCacheKey(key: string): boolean {
    return key.startsWith(STORAGE_KEYS.SUBTITLE_CACHE_PREFIX)
      || key.startsWith(STORAGE_KEYS.ASR_CACHE_PREFIX)
      || key.startsWith(STORAGE_KEYS.PHASE1_CACHE_PREFIX);
  }

  private static kindOfKey(key: string): CacheKind | null {
    if (key.startsWith(STORAGE_KEYS.SUBTITLE_CACHE_PREFIX)) return 'subtitle';
    if (key.startsWith(STORAGE_KEYS.ASR_CACHE_PREFIX)) return 'asr';
    if (key.startsWith(STORAGE_KEYS.PHASE1_CACHE_PREFIX)) return 'phase1';
    return null;
  }

  /** 首次使用时从已有存储重建索引，兼容没有 cache_index_v1 的旧版本 */
  private static async rebuildIndex(): Promise<Record<string, CacheIndexEntry>> {
    const all = await chrome.storage.local.get(null);
    const index: Record<string, CacheIndexEntry> = {};
    const timestamp = now();

    for (const [key, value] of Object.entries(all)) {
      if (!this.isCacheKey(key) || typeof value !== 'string') continue;
      const kind = this.kindOfKey(key);
      if (!kind) continue;
      index[key] = {
        kind,
        size: value.length,
        // 旧缓存没有更新时间，标记为很旧，容量紧张时优先淘汰
        updatedAt: 0,
        expiresAt: timestamp + CACHE_POLICY[kind].ttlMs
      };
    }
    return index;
  }

  private static async readCacheIndex(): Promise<Record<string, CacheIndexEntry>> {
    if (this.cacheIndex && this.cacheIndexLoaded) return this.cacheIndex;

    const stored = await chrome.storage.local.get(STORAGE_KEYS.CACHE_INDEX);
    const raw = stored[STORAGE_KEYS.CACHE_INDEX];
    if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
      this.cacheIndex = raw as Record<string, CacheIndexEntry>;
    } else {
      this.cacheIndex = await this.rebuildIndex();
      await chrome.storage.local.set({ [STORAGE_KEYS.CACHE_INDEX]: this.cacheIndex });
    }
    this.cacheIndexLoaded = true;
    return this.cacheIndex;
  }

  private static async writeCacheIndex(index: Record<string, CacheIndexEntry>): Promise<void> {
    this.cacheIndex = index;
    this.cacheIndexLoaded = true;
    await this.localSet({ [STORAGE_KEYS.CACHE_INDEX]: index });
  }

  /**
   * 在索引上执行淘汰，返回被删除的键。
   * 只做纯计算 + 批量删除，不获取锁，调用方负责串行。
   */
  private static async pruneIndex(
    index: Record<string, CacheIndexEntry>,
    force: boolean
  ): Promise<string[]> {
    const current = now();
    const remove = new Set<string>();

    for (const [key, entry] of Object.entries(index)) {
      if (!entry || entry.expiresAt <= current) remove.add(key);
    }

    // 按类型数量上限淘汰
    for (const kind of Object.keys(CACHE_POLICY) as CacheKind[]) {
      const entries = Object.entries(index)
        .filter(([key, entry]) => entry?.kind === kind && !remove.has(key))
        .sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));
      const overflow = entries.length - CACHE_POLICY[kind].maxEntries;
      for (let i = 0; i < overflow; i++) remove.add(entries[i][0]);
    }

    // 总容量软上限（force=true 时至少清到 70%，给新写入留空间）
    let total = Object.entries(index)
      .filter(([key]) => !remove.has(key))
      .reduce((sum, [, entry]) => sum + (entry?.size || 0), 0);
    const target = force ? CACHE_SOFT_LIMIT_CHARS * 0.7 : CACHE_SOFT_LIMIT_CHARS;
    if (total > target) {
      const candidates = Object.entries(index)
        .filter(([key]) => !remove.has(key))
        .sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));
      for (const [key, entry] of candidates) {
        if (total <= target) break;
        remove.add(key);
        total -= entry?.size || 0;
      }
    }

    if (remove.size === 0) return [];

    const keys = Array.from(remove);
    for (const key of keys) delete index[key];
    await chrome.storage.local.remove(keys);
    await this.writeCacheIndex(index);
    console.log('[StorageService] 已清理缓存条目:', keys.length);
    return keys;
  }

  /** 手动/自动触发缓存治理；返回删除的条目数 */
  static async pruneCaches(options: { force?: boolean } = {}): Promise<number> {
    return this.withCacheLock(async () => {
      const index = await this.readCacheIndex();
      const removed = await this.pruneIndex(index, options.force === true);
      return removed.length;
    });
  }

  private static cacheKey(kind: CacheKind, id: string): string {
    if (kind === 'subtitle') return STORAGE_KEYS.SUBTITLE_CACHE_PREFIX + id;
    if (kind === 'asr') return STORAGE_KEYS.ASR_CACHE_PREFIX + id;
    return STORAGE_KEYS.PHASE1_CACHE_PREFIX + id;
  }

  private static async getCacheText(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    return typeof value === 'string' ? value : null;
  }

  private static async saveCacheText(kind: CacheKind, id: string, text: string): Promise<void> {
    const key = this.cacheKey(kind, id);
    await this.withCacheLock(async () => {
      const index = await this.readCacheIndex();
      const current = now();
      index[key] = {
        kind,
        size: text.length,
        updatedAt: current,
        expiresAt: current + CACHE_POLICY[kind].ttlMs
      };
      await this.localSet({ [key]: text, [STORAGE_KEYS.CACHE_INDEX]: index });
      this.cacheIndex = index;
      await this.pruneIndex(index, false);
    });
  }

  private static async deleteCacheByKey(key: string): Promise<void> {
    await this.withCacheLock(async () => {
      const index = await this.readCacheIndex();
      if (index[key]) {
        delete index[key];
        await this.writeCacheIndex(index);
      }
      await chrome.storage.local.remove(key);
    });
  }

  // ------------------------------------------------------------------ //
  // 具体缓存 API（cacheId 已包含 B 站分 P 信息）
  // ------------------------------------------------------------------ //

  private static asrCacheKey(videoId: string, language: string): string {
    return normalizeAsrLanguage(language) + '_' + videoId;
  }

  static async getAsrCache(videoId: string, language: string = DEFAULT_ASR_LANGUAGE): Promise<string | null> {
    return this.getCacheText(this.cacheKey('asr', this.asrCacheKey(videoId, language)));
  }

  static async saveAsrCache(videoId: string, text: string, language: string = DEFAULT_ASR_LANGUAGE): Promise<void> {
    await this.saveCacheText('asr', this.asrCacheKey(videoId, language), text);
  }

  /** 删除该视频所有语言版本的 ASR 缓存 */
  static async deleteAsrCache(videoId: string): Promise<void> {
    await this.withCacheLock(async () => {
      const index = await this.readCacheIndex();
      const suffix = '_' + videoId;
      const keys = Object.keys(index).filter(
        key => key.startsWith(STORAGE_KEYS.ASR_CACHE_PREFIX) && key.endsWith(suffix)
      );
      if (keys.length === 0) return;

      for (const key of keys) delete index[key];
      await chrome.storage.local.remove(keys);
      await this.writeCacheIndex(index);
    });
  }

  static async getPhase1Cache(videoId: string): Promise<string | null> {
    return this.getCacheText(this.cacheKey('phase1', videoId));
  }

  static async savePhase1Cache(videoId: string, text: string): Promise<void> {
    await this.saveCacheText('phase1', videoId, text);
  }

  static async deletePhase1Cache(videoId: string): Promise<void> {
    await this.deleteCacheByKey(this.cacheKey('phase1', videoId));
  }

  static async getSubtitleCache(videoId: string): Promise<string | null> {
    return this.getCacheText(this.cacheKey('subtitle', videoId));
  }

  static async saveSubtitleCache(videoId: string, text: string): Promise<void> {
    await this.saveCacheText('subtitle', videoId, text);
  }

  static async deleteSubtitleCache(videoId: string): Promise<void> {
    await this.deleteCacheByKey(this.cacheKey('subtitle', videoId));
  }

  /** 清空所有字幕 / ASR / 阶段 1 缓存 */
  static async clearTextCaches(kind?: CacheKind): Promise<number> {
    return this.withCacheLock(async () => {
      const index = await this.readCacheIndex();
      const keys = Object.keys(index).filter(key => !kind || index[key]?.kind === kind);
      if (keys.length === 0) return 0;

      for (const key of keys) delete index[key];
      await chrome.storage.local.remove(keys);
      await this.writeCacheIndex(index);
      return keys.length;
    });
  }

  static async getStorageUsage(): Promise<{
    bytes: number;
    quotaBytes: number;
    cacheEntries: number;
    cacheChars: number;
    mindmaps: number;
  }> {
    let bytes = 0;
    try {
      bytes = await chrome.storage.local.getBytesInUse(null);
    } catch {
      // 测试环境或旧浏览器不支持时忽略
    }
    const index = await this.readCacheIndex();
    const entries = Object.values(index);
    return {
      bytes,
      quotaBytes: STORAGE_QUOTA_BYTES,
      cacheEntries: entries.length,
      cacheChars: entries.reduce((sum, entry) => sum + (entry?.size || 0), 0),
      mindmaps: (await this.getMindmaps()).length
    };
  }

  /** 执行一次 schema 标记 + 启动清理；由 background 初始化时调用 */
  static async initializeStorage(): Promise<void> {
    const meta = await chrome.storage.local.get(STORAGE_KEYS.SCHEMA_VERSION);
    if (meta[STORAGE_KEYS.SCHEMA_VERSION] !== SCHEMA_VERSION) {
      await chrome.storage.local.set({ [STORAGE_KEYS.SCHEMA_VERSION]: SCHEMA_VERSION });
    }

    // 旧版本把配置与密钥放在 sync；迁移到 local 后清掉云端副本。
    // 只删除「本地已经有」的键，避免误删尚未迁移的数据。
    try {
      const [local, synced] = await Promise.all([
        chrome.storage.local.get([STORAGE_KEYS.CONFIG, STORAGE_KEYS.LLM_CONFIGS]),
        chrome.storage.sync.get([STORAGE_KEYS.CONFIG, STORAGE_KEYS.LLM_CONFIGS])
      ]);
      const staleSyncKeys = [STORAGE_KEYS.CONFIG, STORAGE_KEYS.LLM_CONFIGS]
        .filter(key => key in synced && key in local);
      if (staleSyncKeys.length > 0) {
        await chrome.storage.sync.remove(staleSyncKeys);
        console.log('[StorageService] 已清理 sync 中的旧配置副本:', staleSyncKeys.join(', '));
      }
    } catch (error) {
      console.warn('[StorageService] 清理 sync 旧副本失败:', error);
    }

    await this.readCacheIndex();
    await this.pruneCaches();
  }

  // ------------------------------------------------------------------ //
  // 导入 / 导出
  // ------------------------------------------------------------------ //

  static async exportConfig(options: { includeSecrets?: boolean } = {}): Promise<any> {
    const pluginConfig = await this.getConfig();
    const llmConfigs = await this.getLLMConfigs();
    const includeSecrets = options.includeSecrets === true;

    return {
      version: '2.0',
      exportDate: new Date().toISOString(),
      includesSecrets: includeSecrets,
      pluginConfig,
      llmConfigs: llmConfigs.map(config => ({
        ...config,
        apiKey: includeSecrets ? config.apiKey : ''
      }))
    };
  }

  static async downloadConfigFile(options: { includeSecrets?: boolean } = {}): Promise<void> {
    const exportData = await this.exportConfig(options);
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `auto_mindmap_config_${new Date().toISOString().slice(0, 10)}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static async readConfigFromFile(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          resolve(JSON.parse(e.target?.result as string));
        } catch {
          reject(new Error('无法解析配置文件'));
        }
      };
      reader.readAsText(file);
    });
  }

  static async importConfig(data: any, options: any = {}): Promise<any> {
    const { overwriteExisting = true } = options;

    if (!data || typeof data !== 'object') {
      return { success: false, message: '无效的数据格式' };
    }

    try {
      let importedLLMConfigsCount = 0;
      if (data.llmConfigs && Array.isArray(data.llmConfigs)) {
        for (const config of data.llmConfigs) {
          if (!config.id || !config.provider || !config.apiUrl) {
            return { success: false, message: 'LLM 配置结构非法' };
          }
        }

        // 导出默认脱敏（apiKey 为空）。导入时如果同 id 的本机配置有密钥，
        // 保留本机密钥，避免「恢复配置」把可用的密钥清空。
        const existing = await this.getLLMConfigsRaw();
        const keyById = new Map(existing.map(config => [config.id, config.apiKey]));
        const merged = data.llmConfigs.map((config: LLMConfig) => ({
          ...config,
          apiKey: config.apiKey || keyById.get(config.id) || ''
        }));

        await this.withLock('llmWriteChain', async () => {
          await this.localSet({ [STORAGE_KEYS.LLM_CONFIGS]: merged });
        });
        importedLLMConfigsCount = merged.length;
      }

      if (data.pluginConfig && typeof data.pluginConfig === 'object' && overwriteExisting) {
        await this.saveConfig(data.pluginConfig);
      }

      return { success: true, message: '数据验证通过并导入完成', importedLLMConfigsCount };
    } catch (error) {
      console.error('[StorageService] Import failed:', error);
      return { success: false, message: '导入过程中发生未知错误' };
    }
  }
}