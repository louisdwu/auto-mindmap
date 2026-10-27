import { MindmapData, Task } from './mindmap';

// Content -> Background
export interface DownloadSubtitleMessage {
  type: 'DOWNLOAD_SUBTITLE';
  payload: {
    videoUrl: string;
    /** 页面标题，仅字幕模式下用于命名结果与文件 */
    videoTitle?: string;
    /** 清除缓存后重新获取 */
    force?: boolean;
    /** true = 仅获取字幕，不生成思维导图 */
    subtitleOnly?: boolean;
  };
}

export interface GetLatestMindmapMessage {
  type: 'GET_LATEST_MINDMAP';
}

export interface GetLatestMindmapByUrlMessage {
  type: 'GET_LATEST_MINDMAP_BY_URL';
  payload: {
    videoUrl: string;
  };
}

export interface GetCurrentTaskMessage {
  type: 'GET_CURRENT_TASK';
  payload?: {
    videoUrl?: string;
  };
}

export interface ClearMindmapsMessage {
  type: 'CLEAR_MINDMAPS';
}

export interface GenerateMindmapDirectMessage {
  type: 'GENERATE_MINDMAP_DIRECT';
  payload: {
    videoUrl: string;
    subtitleText: string;
    videoTitle: string;
  };
}

export interface GetSubtitleCacheMessage {
  type: 'GET_SUBTITLE_CACHE';
  payload: {
    videoUrl: string;
  };
}

// Background -> Content
export interface SubtitleDownloadedMessage {
  type: 'SUBTITLE_DOWNLOADED';
  payload: {
    videoUrl: string;
    subtitleText: string;
  };
}

export interface MindmapGeneratedMessage {
  type: 'MINDMAP_GENERATED';
  payload: {
    mindmapId: string;
    mindmapData: MindmapData;
  };
}

export interface SubtitleReadyMessage {
  type: 'SUBTITLE_READY';
  payload: {
    taskId: string;
    videoUrl: string;
    videoTitle?: string;
    subtitleText: string;
    isAsr?: boolean;
    /** 后台是否已按「本地文件缓存」设置自动保存了 .txt 文件 */
    savedToFile?: boolean;
  };
}

export interface TaskStatusUpdateMessage {
  type: 'TASK_STATUS_UPDATE';
  payload: {
    taskId: string;
    status: Task['status'];
  };
}

export type ExtensionMessage =
  | DownloadSubtitleMessage
  | GetLatestMindmapMessage
  | GetLatestMindmapByUrlMessage
  | GetCurrentTaskMessage
  | ClearMindmapsMessage
  | GenerateMindmapDirectMessage
  | GetSubtitleCacheMessage;

export type ContentMessage =
  | SubtitleDownloadedMessage
  | MindmapGeneratedMessage
  | TaskStatusUpdateMessage
  | SubtitleReadyMessage;
