import { AppStats, DEFAULT_STATS } from '../types/stats';

const STATS_STORAGE_KEY = 'app_statistics';

export class StatsService {
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
      dailyStats: stats.dailyStats || {},
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

      // 3. 视频去重统计
      if (params.videoId && !stats.processedVideoIds.includes(params.videoId)) {
        stats.processedVideoIds.push(params.videoId);
        stats.totalVideos = stats.processedVideoIds.length;
        
        // 限制列表长度，防止存储爆炸 (只保留最近 1000 个 ID 用于去重，或者后期改用更高效方式)
        if (stats.processedVideoIds.length > 1000) {
          stats.processedVideoIds.shift();
        }
      }

      // 4. 反思成功统计
      if (params.isReflectionEnabled && params.reflectionSuccess) {
        stats.reflectionSuccessCount += 1;
      }

      // 5. 每日统计
      if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = { generations: 0, videos: 0 };
      }
      stats.dailyStats[today].generations += 1;
      // 这里简化处理，如果该视频是今天处理的，算一个视频
      // 实际应该检查该视频 ID 今天是否处理过
      stats.dailyStats[today].videos = stats.processedVideoIds.length; // 这是一个粗略值
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
