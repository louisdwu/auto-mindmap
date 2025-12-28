import { MindmapData, Task } from './mindmap';

// Content -> Background
export interface DownloadSubtitleMessage {
  type: 'DOWNLOAD_SUBTITLE';
  payload: {
    videoUrl: string;
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
  | GenerateMindmapDirectMessage;

export type ContentMessage =
  | SubtitleDownloadedMessage
  | MindmapGeneratedMessage
  | TaskStatusUpdateMessage;