export type MindmapStyle = 'modern' | 'classic' | 'dark' | 'colorful' | 'handdrawn';

export interface MindmapData {
  id: string;
  videoUrl: string;
  videoTitle: string;
  subtitleText: string;
  /** Markdown格式的思维导图 */
  mindmapMarkdown: string;
  /** 初步生成的思维导图（开启反思模式时才有值） */
  initialMindmapMarkdown?: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  style?: MindmapStyle;
}

/** 任务实际使用的 LLM 调用上下文：悬浮球悬停提示与错误弹窗展示「配置名称 + 模型名」用 */
export interface TaskLLMContext {
  /** LLM 配置名称（配置列表里的显示名） */
  configName?: string;
  /** 模型标识（如 sensenova-6.8-flash-lite） */
  model?: string;
}

export interface Task {
  id: string;
  type: 'download_subtitle' | 'generate_mindmap';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  data: any;
  result?: any;
  error?: string;
  /** 导图任务解析出 LLM 配置后记录，失败时可随任务快照透传给 UI 做诊断 */
  llmContext?: TaskLLMContext;
  createdAt: number;
  updatedAt: number;
  /** 任务执行过程中的进度消息 */
  statusMessage?: string;
  /** 发起任务的标签页ID，用于将结果发送回正确的标签页 */
  tabId?: number;
  /** 用户已请求取消（运行中的任务在下一次中断点退出） */
  cancelRequested?: boolean;
  /** Service Worker 中断后的自动恢复次数，防止无限重试 */
  resumeCount?: number;
  cancelledAt?: number;
}