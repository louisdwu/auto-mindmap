import { beforeEach, describe, expect, it, vi } from 'vitest';

type Store = Record<string, any>;

function createArea(store: Store) {
  return {
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys == null) return JSON.parse(JSON.stringify(store));
      if (typeof keys === 'string') {
        return keys in store ? { [keys]: JSON.parse(JSON.stringify(store[keys])) } : {};
      }
      if (Array.isArray(keys)) {
        const out: Store = {};
        for (const key of keys) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
        return out;
      }
      const out: Store = {};
      for (const [key, fallback] of Object.entries(keys)) {
        out[key] = key in store ? JSON.parse(JSON.stringify(store[key])) : fallback;
      }
      return out;
    }),
    set: vi.fn(async (items: Store) => {
      for (const [key, value] of Object.entries(items)) {
        store[key] = JSON.parse(JSON.stringify(value));
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete store[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(store)) delete store[key];
    }),
    getBytesInUse: vi.fn(async (keys?: string | string[] | null) => {
      const target = keys == null
        ? store
        : Array.isArray(keys)
          ? Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))
          : typeof keys === 'string'
            ? (keys in store ? { [keys]: store[keys] } : {})
            : store;
      return JSON.stringify(target).length;
    })
  };
}

let localStore: Store;
let syncStore: Store;

beforeEach(() => {
  vi.resetModules();
  localStore = {};
  syncStore = {};
  (globalThis as any).chrome = {
    storage: {
      local: createArea(localStore),
      sync: createArea(syncStore)
    }
  };
});

async function loadService() {
  return import('./storageService');
}

describe('StorageService 配置存储', () => {
  it('配置写入 local，不写入 sync', async () => {
    const { StorageService } = await loadService();
    const { DEFAULT_CONFIG } = await import('../types/config');

    await StorageService.saveConfig(DEFAULT_CONFIG);
    expect(localStore.plugin_config).toBeTruthy();
    expect(syncStore.plugin_config).toBeUndefined();

    const loaded = await StorageService.getConfig();
    expect(loaded?.settings.saveToLocalFile).toBe(true);
  });

  it('从旧 sync 配置迁移到 local 并删除 sync 副本', async () => {
    syncStore.plugin_config = {
      selectedLLMConfigId: 'default',
      prompt: {},
      settings: { cacheDirectory: 'enabled' },
      exclusionKeywords: []
    };

    const { StorageService } = await loadService();
    const loaded = await StorageService.getConfig();

    expect(loaded).not.toBeNull();
    expect(localStore.plugin_config).toBeTruthy();
    expect(syncStore.plugin_config).toBeUndefined();
    // 旧 cacheDirectory 非空 => saveToLocalFile=true
    expect(loaded?.settings.saveToLocalFile).toBe(true);
    expect(loaded?.settings.enableChunking).toBe(true);
  });

  it('LLM 配置写入 local，且导出时默认脱敏', async () => {
    const { StorageService } = await loadService();
    const { createDefaultLLMConfig } = await import('../types/config');
    const llm = createDefaultLLMConfig('openai');
    llm.id = 'llm_test';
    llm.apiKey = 'sk-secret';

    await StorageService.saveLLMConfig(llm);
    expect(localStore.llm_configs).toHaveLength(1);
    expect(syncStore.llm_configs).toBeUndefined();

    const exported = await StorageService.exportConfig();
    expect(exported.llmConfigs[0].apiKey).toBe('');
    expect(exported.includesSecrets).toBe(false);

    const full = await StorageService.exportConfig({ includeSecrets: true });
    expect(full.llmConfigs[0].apiKey).toBe('sk-secret');
  });
});

describe('StorageService 缓存治理', () => {
  it('字幕缓存可读写、可删除，并写入索引', async () => {
    const { StorageService } = await loadService();

    await StorageService.saveSubtitleCache('BV1_p2', '[00:01] hello');
    expect(await StorageService.getSubtitleCache('BV1_p2')).toBe('[00:01] hello');

    const index = localStore.cache_index_v1;
    expect(index.subtitle_cache_v2_BV1_p2).toMatchObject({ kind: 'subtitle' });

    await StorageService.deleteSubtitleCache('BV1_p2');
    expect(await StorageService.getSubtitleCache('BV1_p2')).toBeNull();
    expect(localStore.cache_index_v1.subtitle_cache_v2_BV1_p2).toBeUndefined();
  });

  it('ASR 缓存按语言分键，删除时清掉该视频所有语言', async () => {
    const { StorageService } = await loadService();

    await StorageService.saveAsrCache('BV1_p2', 'zh text', 'zh');
    await StorageService.saveAsrCache('BV1_p2', 'en text', 'en');
    expect(await StorageService.getAsrCache('BV1_p2', 'zh')).toBe('zh text');
    expect(await StorageService.getAsrCache('BV1_p2', 'en')).toBe('en text');

    await StorageService.deleteAsrCache('BV1_p2');
    expect(await StorageService.getAsrCache('BV1_p2', 'zh')).toBeNull();
    expect(await StorageService.getAsrCache('BV1_p2', 'en')).toBeNull();
  });

  it('过期缓存会被 pruneCaches 清理', async () => {
    const { StorageService } = await loadService();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await StorageService.saveSubtitleCache('old', 'text');

    vi.setSystemTime(new Date('2026-03-01T00:00:00Z')); // 超过 30 天 TTL
    const removed = await StorageService.pruneCaches();
    expect(removed).toBeGreaterThan(0);
    expect(await StorageService.getSubtitleCache('old')).toBeNull();
    vi.useRealTimers();
  });

  it('按分 P 精确匹配导图缓存', async () => {
    const { StorageService } = await loadService();
    const base = {
      videoTitle: 't',
      subtitleText: '[00:01] x',
      mindmapMarkdown: '# x',
      createdAt: Date.now(),
      status: 'completed' as const
    };

    await StorageService.saveMindmap({ ...base, id: 'p1', videoUrl: 'https://www.bilibili.com/video/BV1xx?p=1' });
    await StorageService.saveMindmap({ ...base, id: 'p2', videoUrl: 'https://www.bilibili.com/video/BV1xx?p=2' });

    expect((await StorageService.getLatestMindmapByUrl('https://www.bilibili.com/video/BV1xx?p=1'))?.id).toBe('p1');
    expect((await StorageService.getLatestMindmapByUrl('https://www.bilibili.com/video/BV1xx?p=2'))?.id).toBe('p2');

    await StorageService.deleteMindmapByUrl('https://www.bilibili.com/video/BV1xx?p=2');
    expect(await StorageService.getLatestMindmapByUrl('https://www.bilibili.com/video/BV1xx?p=2')).toBeNull();
    expect((await StorageService.getLatestMindmapByUrl('https://www.bilibili.com/video/BV1xx?p=1'))?.id).toBe('p1');
  });
});
