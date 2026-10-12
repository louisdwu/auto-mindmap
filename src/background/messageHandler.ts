import { TaskManager } from './taskManager';
import { StorageService } from '../services/storageService';
import { VideoUtils } from '../utils/videoUtils';
import { ExtensionMessage } from '../types/messages';

export class MessageHandler {
  constructor(private taskManager: TaskManager) {
    this.init();
  }

  private init() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(sendResponse)
        .catch(error => {
          console.error('[MessageHandler] Error:', error);
          sendResponse({ error: error.message });
        });

      return true; // 保持消息通道开放
    });
  }

  private async handleMessage(
    message: ExtensionMessage,
    sender?: chrome.runtime.MessageSender
  ): Promise<any> {
    const tabId = sender?.tab?.id;

    switch (message?.type) {
      case 'DOWNLOAD_SUBTITLE':
        return await this.handleDownloadSubtitle(message.payload, tabId);

      case 'GENERATE_MINDMAP_DIRECT':
        return await this.handleGenerateMindmapDirect(message.payload, tabId);

      case 'GET_LATEST_MINDMAP':
        return await this.handleGetLatestMindmap();
      
      case 'GET_LATEST_MINDMAP_BY_URL':
        return await this.handleGetLatestMindmapByUrl(message.payload);
      
      case 'GET_CURRENT_TASK':
        return await this.handleGetCurrentTask(message.payload);
      
      case 'CLEAR_MINDMAPS':
        return await this.handleClearMindmaps();
      
      case 'GET_SUBTITLE_CACHE':
        return await this.handleGetSubtitleCache(message.payload);
      
      default:
        // 处理未知消息类型
        return { error: 'Unknown message type' };
    }
  }

  private async handleDownloadSubtitle(payload: { videoUrl: string, force?: boolean }, tabId?: number) {
    const isForce = payload.force === true;

    // 如果不是强制模式且启用了缓存，检查已有的思维导图
    const config = await StorageService.getConfig();
    if (!isForce && config?.settings.enableCache) {
      const cachedMindmap = await StorageService.getLatestMindmapByUrl(payload.videoUrl);
      if (cachedMindmap) {
        console.log('[MessageHandler] 找到缓存的思维导图，跳过下载字幕:', cachedMindmap.id);
        return { taskId: null, cached: true, mindmap: cachedMindmap };
      }
    }
    
    // 如果是强制模式，显式删除 ASR 缓存 (如果是本地 ASR)
    if (isForce) {
      const videoId = VideoUtils.extractVideoId(payload.videoUrl);
      if (videoId) {
        console.log('[MessageHandler] 强制模式：正在清除 ASR 缓存, ID:', videoId);
        await StorageService.deleteAsrCache(videoId);
      }
    }

    const task = await this.taskManager.createDownloadTask(payload.videoUrl, tabId, isForce);
    return { taskId: task.id };
  }

  private async handleGetLatestMindmap() {
    console.log('[MessageHandler] GET_LATEST_MINDMAP 请求');
    
    // 检查缓存开关
    const config = await StorageService.getConfig();
    console.log('[MessageHandler] 当前配置:', config);
    
    if (!config?.settings.enableCache) {
      console.log('[MessageHandler] 缓存已禁用');
      return { mindmap: null };
    }
    
    const mindmap = await StorageService.getLatestMindmap();
    console.log('[MessageHandler] 获取到的思维导图:', mindmap ? `ID: ${mindmap.id}, 标题: ${mindmap.videoTitle}` : 'null');
    return { mindmap };
  }

  private async handleGetLatestMindmapByUrl(payload: { videoUrl: string }) {
    console.log('[MessageHandler] GET_LATEST_MINDMAP_BY_URL 请求, URL:', payload.videoUrl);
    
    // 检查缓存开关
    const config = await StorageService.getConfig();
    console.log('[MessageHandler] 当前配置:', config);
    
    if (!config?.settings.enableCache) {
      console.log('[MessageHandler] 缓存已禁用');
      return { mindmap: null };
    }
    
    const mindmap = await StorageService.getLatestMindmapByUrl(payload.videoUrl);
    console.log('[MessageHandler] 获取到的思维导图:', mindmap ? `ID: ${mindmap.id}, 标题: ${mindmap.videoTitle}` : 'null');
    return { mindmap };
  }

  private async handleClearMindmaps() {
    await StorageService.clearMindmaps();
    return { success: true };
  }

  private async handleGetCurrentTask(payload?: { videoUrl?: string }) {
    const task = this.taskManager.getCurrentTask(payload?.videoUrl);
    return { task };
  }

  private async handleGenerateMindmapDirect(payload: { videoUrl: string, subtitleText: string, videoTitle: string, force?: boolean }, tabId?: number) {
    // 双重保险：在后台也检查缓存
    const config = await StorageService.getConfig();
    if (payload.force !== true && config?.settings.enableCache) {
      const cachedMindmap = await StorageService.getLatestMindmapByUrl(payload.videoUrl);
      if (cachedMindmap) {
        console.log('[MessageHandler] 找到缓存的思维导图，跳过生成:', cachedMindmap.id);
        return { taskId: null, cached: true, mindmap: cachedMindmap };
      }
    }
    
    const task = await this.taskManager.createMindmapTask(payload.videoUrl, payload.subtitleText, payload.videoTitle, tabId);
    return { taskId: task.id };
  }

  private async handleGetSubtitleCache(payload?: { videoUrl?: string }) {
    if (!payload?.videoUrl) {
      return { subtitleText: null };
    }
    const { videoUrl } = payload;
    const videoId = VideoUtils.extractVideoId(videoUrl);

    // 1. 检查当前或最近任务中的 subtitleText
    const task = this.taskManager.getCurrentTask(videoUrl);
    if (task?.data?.subtitleText) {
      return { subtitleText: task.data.subtitleText };
    }
    if (task?.result?.subtitleText) {
      return { subtitleText: task.result.subtitleText };
    }

    // 2. 检查 StorageService 的通用字幕缓存
    if (videoId) {
      const cachedSub = await StorageService.getSubtitleCache(videoId);
      if (cachedSub) {
        return { subtitleText: cachedSub };
      }
    }

    // 3. 检查 ASR 缓存
    if (videoId) {
      const asrSub = await StorageService.getAsrCache(videoId);
      if (asrSub) {
        return { subtitleText: asrSub };
      }
    }

    // 4. 检查已有的思维导图数据
    const mindmap = await StorageService.getLatestMindmapByUrl(videoUrl);
    if (mindmap?.subtitleText) {
      return { subtitleText: mindmap.subtitleText };
    }

    return { subtitleText: null };
  }
}