import { AppStats, DEFAULT_STATS, DailyStats, ModelUsageStats } from '../types/stats';

const STATS_STORAGE_KEY = 'app_statistics';
/**
 * 统计数据在 chrome.storage.sync 里的镜像 key。
 *
 * 背景：统计只存 chrome.storage.local 时，「移除扩展后重新加载」会把
 * storage.local 一起清掉（这是 unpacked 扩展更新插件的常见操作），统计就丢了。
 * sync 跟 Chrome 账号走：重装扩展、换设备都能自动恢复。
 * 统计是纯数字不含密钥，因此允许进 sync（配置与密钥仍然禁止，见 AGENTS 约定）。
 */
const STATS_SYNC_BACKUP_KEY = 'app_statistics_backup_v1';

/** chrome.storage.sync 单条目配额是 8KB（QUOTA_BYTES_PER_ITEM），留安全余量 */
const SYNC_ITEM_LIMIT = 8000;

/** 备份裁剪档位：按「最近 N 天 / 最多 M 个视频 ID」逐级降级，直到塞进 sync 配额 */
const BACKUP_TIERS: Array<{ days: number; dailyVideoIds: number; videoIds: number }> = [
  { days: 90, dailyVideoIds: 30, videoIds: 200 },
  { days: 30, dailyVideoIds: 20, videoIds: 100 },
  { days: 14, dailyVideoIds: 10, videoIds: 50 },
  { days: 7, dailyVideoIds: 0, videoIds: 0 }
];

export class StatsService {
  /** 并发任务可能同时记录统计，串行化读改写避免丢计数 */
  private static writeChain: Promise<void> = Promise.resolve();

  /**
   * 获取所有统计数据
   */
  static async getStats(): Promise<AppStats> {
    const result = await chrome.storage.local.get(STATS_STORAGE_KEY);
    return this.normalizeStats(result[STATS_STORAGE_KEY]);
  }

  /**
   * 把任意来源（旧版本数据 / sync 备份）的结构补全成完整的 AppStats
   */
  private static normalizeStats(raw: any): AppStats {
    const stats = raw || {};
    return {
      ...DEFAULT_STATS,
      ...stats,
      modelUsage: stats.modelUsage || {},
      dailyStats: Object.fromEntries(
        Object.entries(stats.dailyStats || {}).map(([day, value]: [string, any]) => [
          day,
          {
            generations: Number(value?.generations) || 0,
            videos: Number(value?.videos) || 0,
            videoIds: Array.isArray(value?.videoIds) ? value.videoIds : [],
            inputTokens: Number(value?.inputTokens) || 0,
            outputTokens: Number(value?.outputTokens) || 0
          }
        ])
      ),
      processedVideoIds: stats.processedVideoIds || [],
      totalInputTokens: Number(stats.totalInputTokens) || 0,
      totalOutputTokens: Number(stats.totalOutputTokens) || 0,
      reflectionRuns: Number(stats.reflectionRuns) || 0
    };
  }

  /**
   * 保存统计数据，并镜像一份到 chrome.storage.sync 作为更新/重装后的恢复源
   */
  static async saveStats(stats: AppStats): Promise<void> {
    stats.lastUpdated = Date.now();
    await chrome.storage.local.set({ [STATS_STORAGE_KEY]: stats });
    await this.mirrorToSync(stats);
  }

  /**
   * 构建可塞进 sync 配额的备份副本：
   * - dailyStats 只保留最近 N 天，且较老的天次剥掉 videoIds（去重精度换体积）
   * - processedVideoIds 只保留最新的 M 个（列表尾部是最新的）
   * 裁剪只影响备份副本，本地完整数据不受影响。
   */
  private static buildBackup(stats: AppStats): AppStats | null {
    const days = Object.keys(stats.dailyStats).sort();
    const ids = stats.processedVideoIds;

    for (const tier of BACKUP_TIERS) {
      const keptDays = days.slice(-tier.days);
      const recentDays = new Set(keptDays.slice(-3));
      const dailyStats: Record<string, DailyStats> = {};
      for (const day of keptDays) {
        const value = stats.dailyStats[day];
        dailyStats[day] = {
          generations: value.generations,
          videos: value.videos,
          // 最近 3 天保留少量 videoIds，保住「当天/近几天去重」精度；更早的剥掉
          videoIds: recentDays.has(day) ? (value.videoIds || []).slice(-tier.dailyVideoIds) : [],
          inputTokens: value.inputTokens,
          outputTokens: value.outputTokens
        };
      }

      const candidate: AppStats = {
        ...stats,
        dailyStats,
        processedVideoIds: tier.videoIds > 0 ? ids.slice(-tier.videoIds) : [],
        lastUpdated: stats.lastUpdated
      };

      if (JSON.stringify(candidate).length <= SYNC_ITEM_LIMIT) {
        return candidate;
      }
    }

    // 最小档位仍超限（理论上不会发生）就放弃镜像，统计继续留在 local
    return null;
  }

  /**
   * 把统计镜像到 sync。sync 可能被企业策略禁用或配额不足，失败时静默降级：
   * 统计仍然完整保存在 local，只是少了「重装后自动恢复」的能力。
   */
  private static async mirrorToSync(stats: AppStats): Promise<void> {
    try {
      const backup = this.buildBackup(stats);
      if (!backup) return;
      await chrome.storage.sync.set({ [STATS_SYNC_BACKUP_KEY]: backup });
    } catch (error) {
      console.debug('[StatsService] 统计镜像到 sync 失败（不影响本地统计）:', error);
    }
  }

  /**
   * 从 sync 恢复统计到 local（用于重装/更新后 storage.local 被清的场景）。
   * 以 lastUpdated 判新旧：local 缺失或落后于备份时才覆盖，绝不回滚更新数据。
   * 幂等，Service Worker 每次启动、统计页打开时都可以安全调用。
   */
  static async restoreFromSync(): Promise<boolean> {
    try {
      const syncResult = await chrome.storage.sync.get(STATS_SYNC_BACKUP_KEY);
      const backup = syncResult?.[STATS_SYNC_BACKUP_KEY];
      if (!backup || typeof backup !== 'object') return false;

      const localResult = await chrome.storage.local.get(STATS_STORAGE_KEY);
      const backupTime = Number((backup as any).lastUpdated) || 0;
      const localTime = Number(localResult?.[STATS_STORAGE_KEY]?.lastUpdated) || 0;
      if (backupTime <= localTime) return false;

      const restored = this.normalizeStats(backup);
      restored.lastUpdated = backupTime;
      await chrome.storage.local.set({ [STATS_STORAGE_KEY]: restored });
      return true;
    } catch (error) {
      console.debug('[StatsService] 从 sync 恢复统计失败（可能被禁用）:', error);
      return false;
    }
  }

  /**
   * 记录一次成功的生成
   */
  static async recordGeneration(params: {
    videoId: string | null;
    modelId: string;
    isReflectionEnabled: boolean;
    reflectionSuccess?: boolean; // 反思阶段是否直接通过（不需要优化）
    isSuccess: boolean;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void> {
    const run = this.writeChain.then(() => this.recordGenerationUnlocked(params));
    this.writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private static async recordGenerationUnlocked(params: {
    videoId: string | null;
    modelId: string;
    isReflectionEnabled: boolean;
    reflectionSuccess?: boolean;
    isSuccess: boolean;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void> {
    const stats = await this.getStats();
    const today = new Date().toISOString().split('T')[0];

    // 1. 模型使用统计
    if (!stats.modelUsage[params.modelId]) {
      stats.modelUsage[params.modelId] = { count: 0, success: 0, failure: 0 };
    }
    const modelStats: ModelUsageStats = stats.modelUsage[params.modelId];
    modelStats.count += 1;
    const inputTokens = Math.max(0, Number(params.inputTokens) || 0);
    const outputTokens = Math.max(0, Number(params.outputTokens) || 0);
    if (inputTokens || outputTokens) {
      modelStats.inputTokens = (modelStats.inputTokens || 0) + inputTokens;
      modelStats.outputTokens = (modelStats.outputTokens || 0) + outputTokens;
      stats.totalInputTokens = (stats.totalInputTokens || 0) + inputTokens;
      stats.totalOutputTokens = (stats.totalOutputTokens || 0) + outputTokens;
    }
    if (params.isSuccess) {
      modelStats.success += 1;
    } else {
      modelStats.failure += 1;
    }

    if (params.isSuccess) {
      // 2. 总生成数
      stats.totalGenerations += 1;

      // 3. 视频去重统计（列表可以裁剪，但累计数不能跟着缩水）
      if (params.videoId && !stats.processedVideoIds.includes(params.videoId)) {
        stats.processedVideoIds.push(params.videoId);
        stats.totalVideos += 1;

        // 限制列表长度，防止存储爆炸；只影响「是否处理过」的判断范围
        if (stats.processedVideoIds.length > 1000) {
          stats.processedVideoIds.shift();
        }
      }

      // 4. 反思统计：分母只算「开启反思且成功」的运行，直通 = 初稿无需重写
      if (params.isReflectionEnabled) {
        stats.reflectionRuns += 1;
        if (params.reflectionSuccess) {
          stats.reflectionSuccessCount += 1;
        }
      }

      // 5. 每日统计：按当日视频 ID 去重，而不是把累计总数写进每日次数
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = { generations: 0, videos: 0, videoIds: [] };
      }
      const daily = stats.dailyStats[today];
      daily.generations += 1;
      if (inputTokens || outputTokens) {
        daily.inputTokens = (daily.inputTokens || 0) + inputTokens;
        daily.outputTokens = (daily.outputTokens || 0) + outputTokens;
      }

      if (params.videoId) {
        if (!daily.videoIds) daily.videoIds = [];
        if (!daily.videoIds.includes(params.videoId)) {
          daily.videoIds.push(params.videoId);
          daily.videos += 1;
          if (daily.videoIds.length > 500) daily.videoIds.shift();
        }
      }
    }

    await this.saveStats(stats);
  }

  /**
   * 清空统计数据（本地与 sync 备份一起清，保持「清空」语义一致）
   */
  static async clearStats(): Promise<void> {
    await chrome.storage.local.remove(STATS_STORAGE_KEY);
    try {
      await chrome.storage.sync.remove(STATS_SYNC_BACKUP_KEY);
    } catch {
      // sync 不可用时忽略，本地已清空
    }
  }
}
