import { TaskManager } from './taskManager';
import { StorageService } from '../services/storageService';
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
        return await this.handleGetCurrentTask();
      
      case 'CLEAR_MINDMAPS':
        return await this.handleClearMindmaps();
      
      default:
        // 处理未知消息类型
        return { error: 'Unknown message type' };
    }
  }

  private async handleDownloadSubtitle(payload: { videoUrl: string }, tabId?: number) {
    const task = await this.taskManager.createDownloadTask(payload.videoUrl, tabId);
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

  private async handleGetCurrentTask() {
    const task = this.taskManager.getCurrentTask();
    return { task };
  }

  private async handleGenerateMindmapDirect(payload: { videoUrl: string, subtitleText: string, videoTitle: string }, tabId?: number) {
    const task = await this.taskManager.createMindmapTask(payload.videoUrl, payload.subtitleText, payload.videoTitle, tabId);
    return { taskId: task.id };
  }
}