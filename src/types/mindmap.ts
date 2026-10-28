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

export interface Task {
  id: string;
  type: 'download_subtitle' | 'generate_mindmap';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  data: any;
  result?: any;
  error?: string;
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