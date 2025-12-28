export type MindmapStyle = 'modern' | 'classic' | 'dark' | 'colorful' | 'handdrawn';

export interface MindmapData {
  id: string;
  videoUrl: string;
  videoTitle: string;
  subtitleText: string;
  /** Markdown格式的思维导图 */
  mindmapMarkdown: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  style?: MindmapStyle;
}

export interface Task {
  id: string;
  type: 'download_subtitle' | 'generate_mindmap';
  status: 'pending' | 'running' | 'completed' | 'failed';
  data: any;
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}