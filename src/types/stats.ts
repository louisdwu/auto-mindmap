export interface ModelUsageStats {
  count: number;
  success: number;
  failure: number;
  /** 上游返回/估算的输入 token 数 */
  inputTokens?: number;
  /** 上游返回/估算的输出 token 数 */
  outputTokens?: number;
}

export interface DailyStats {
  generations: number;
  videos: number;
  /** 当日处理过的视频 ID，用于正确计算每日去重视频数 */
  videoIds?: string[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface AppStats {
  totalVideos: number;           // 累计处理视频数
  totalGenerations: number;      // 累计生成思维导图数
  /** 开启反思且生成成功的次数（直通率分母） */
  reflectionRuns: number;
  /** 其中「初稿通过自动校验、无需重写」的次数 */
  reflectionSuccessCount: number;
  modelUsage: Record<string, ModelUsageStats>; // 模型 ID -> 使用统计
  dailyStats: Record<string, DailyStats>;      // 日期 (YYYY-MM-DD) -> 每日统计
  processedVideoIds: string[];   // 已处理的视频 ID 列表 (用于去重计算 totalVideos)
  /** 累计 token 用量（有上游 usage 时才累加） */
  totalInputTokens: number;
  totalOutputTokens: number;
  lastUpdated: number;
}

export const DEFAULT_STATS: AppStats = {
  totalVideos: 0,
  totalGenerations: 0,
  reflectionRuns: 0,
  reflectionSuccessCount: 0,
  modelUsage: {},
  dailyStats: {},
  processedVideoIds: [],
  totalInputTokens: 0,
  totalOutputTokens: 0,
  lastUpdated: 0,
};