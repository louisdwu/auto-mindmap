import { AppStats, DEFAULT_STATS } from '../types/stats';

const STATS_STORAGE_KEY = 'app_statistics';

export class StatsService {
  /** 并发任务可能同时记录统计，串行化读改写避免丢计数 */
  private static writeChain: Promise<void> = Promise.resolve();

  /**
   * 获取所有统计数据
   */
  static async getStats(): Promise<AppStats> {
    const result = await chrome.storage.local.get(STATS_STORAGE_KEY);
    const stats = result[STATS_STORAGE_KEY] || { ...DEFAULT_STATS };
    
    // 确保对象结构完整 (防抖处理旧版本数据)
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
            videoIds: Array.isArray(value?.videoIds) ? value.videoIds : []
          }
        ])
      ),
      processedVideoIds: stats.processedVideoIds || []
    };
  }

  /**
   * 保存统计数据
   */
  static async saveStats(stats: AppStats): Promise<void> {
    stats.lastUpdated = Date.now();
    await chrome.storage.local.set({ [STATS_STORAGE_KEY]: stats });
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
  }): Promise<void> {
    const stats = await this.getStats();
    const today = new Date().toISOString().split('T')[0];

    // 1. 模型使用统计
    if (!stats.modelUsage[params.modelId]) {
      stats.modelUsage[params.modelId] = { count: 0, success: 0, failure: 0 };
    }
    const modelStats = stats.modelUsage[params.modelId];
    modelStats.count += 1;
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

      // 4. 反思成功统计
      if (params.isReflectionEnabled && params.reflectionSuccess) {
        stats.reflectionSuccessCount += 1;
      }

      // 5. 每日统计：按当日视频 ID 去重，而不是把累计总数写进每日次数
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = { generations: 0, videos: 0, videoIds: [] };
      }
      const daily = stats.dailyStats[today];
      daily.generations += 1;

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
   * 清空统计数据
   */
  static async clearStats(): Promise<void> {
    await chrome.storage.local.remove(STATS_STORAGE_KEY);
  }
}