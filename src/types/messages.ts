import { MindmapData, Task } from './mindmap';

/** 请求来源：auto = 页面自动流程，user = 用户主动操作 */
export type RequestOrigin = 'auto' | 'user';

// Content -> Background
export interface DownloadSubtitleMessage {
  type: 'DOWNLOAD_SUBTITLE';
  payload: {
    videoUrl: string;
    /** 页面标题，仅字幕模式下用于命名结果与文件 */
    videoTitle?: string;
    /** 清除缓存后重新获取 */
    force?: boolean;
    /**
     * true = 强制「重新语音识别」：跳过官方字幕与服务端/本地缓存，
     * 直接对音频重新做 ASR（悬浮球右键菜单、字幕面板、导图查看器入口）。
     */
    forceAsr?: boolean;
    /** true = 仅获取字幕，不生成思维导图 */
    subtitleOnly?: boolean;
    /** 缺省按 user 处理，auto 会被「仅字幕模式」抑制 */
    origin?: RequestOrigin;
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
    /** 缺省按 user 处理，auto 会被「仅字幕模式」抑制 */
    origin?: RequestOrigin;
    force?: boolean;
  };
}

export interface GetSubtitleCacheMessage {
  type: 'GET_SUBTITLE_CACHE';
  payload: {
    videoUrl: string;
  };
}

/**
 * 用户明确表示该视频「只要字幕」：记录意图、取消排队中的自动导图任务，
 * 并把正在下载的字幕任务切换为仅字幕模式。
 */
export interface SetSubtitleOnlyModeMessage {
  type: 'SET_SUBTITLE_ONLY_MODE';
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
  | GetSubtitleCacheMessage
  | SetSubtitleOnlyModeMessage;

export type ContentMessage =
  | SubtitleDownloadedMessage
  | MindmapGeneratedMessage
  | TaskStatusUpdateMessage
  | SubtitleReadyMessage;
