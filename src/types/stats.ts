export interface ModelUsageStats {
  count: number;
  success: number;
  failure: number;
  // 可以扩展 tokens 等
}

export interface DailyStats {
  generations: number;
  videos: number;
}

export interface AppStats {
  totalVideos: number;           // 累计处理视频数
  totalGenerations: number;      // 累计生成思维导图数
  reflectionSuccessCount: number; // 反思模式下“初稿即优秀”的次数
  modelUsage: Record<string, ModelUsageStats>; // 模型 ID -> 使用统计
  dailyStats: Record<string, DailyStats>;      // 日期 (YYYY-MM-DD) -> 每日统计
  processedVideoIds: string[];   // 已处理的视频 ID 列表 (用于去重计算 totalVideos)
  lastUpdated: number;
}

export const DEFAULT_STATS: AppStats = {
  totalVideos: 0,
  totalGenerations: 0,
  reflectionSuccessCount: 0,
  modelUsage: {},
  dailyStats: {},
  processedVideoIds: [],
  lastUpdated: 0,
};
