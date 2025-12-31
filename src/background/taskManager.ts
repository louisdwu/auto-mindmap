import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types/mindmap';
import { SubtitleService } from '../services/subtitleService';
import { LLMService } from '../services/llmService';
import { StorageService } from '../services/storageService';
import { FileService } from '../services/fileService';

const TASKS_STORAGE_KEY = 'active_tasks';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private isProcessing: boolean = false;

  constructor() {
    // 从 storage 恢复任务状态
    this.restoreTasks();
  }

  /**
   * 从 storage 恢复任务状态
   */
  private async restoreTasks() {
    try {
      const result = await chrome.storage.local.get(TASKS_STORAGE_KEY);
      const storedTasks = result[TASKS_STORAGE_KEY] || [];

      for (const task of storedTasks) {
        // 只恢复未完成的任务
        if (task.status !== 'completed' && task.status !== 'failed') {
          task.status = 'pending';
          this.tasks.set(task.id, task);
        }
      }

      console.log('[TaskManager] Restored tasks:', this.tasks.size);
    } catch (error) {
      console.error('[TaskManager] Failed to restore tasks:', error);
    }
  }

  /**
   * 保存任务到 storage
   */
  private async saveTasks() {
    try {
      const tasksArray = Array.from(this.tasks.values());
      await chrome.storage.local.set({
        [TASKS_STORAGE_KEY]: tasksArray
      });
    } catch (error) {
      console.error('[TaskManager] Failed to save tasks:', error);
    }
  }

  /**
   * 创建下载字幕任务
   */
  async createDownloadTask(videoUrl: string, tabId?: number): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      type: 'download_subtitle',
      status: 'pending',
      data: { videoUrl },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabId
    };

    this.tasks.set(task.id, task);
    await this.saveTasks();
    this.processQueue();

    return task;
  }

  /**
   * 创建生成思维导图任务
   */
  async createMindmapTask(videoUrl: string, subtitleText: string, videoTitle: string, tabId?: number): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      type: 'generate_mindmap',
      status: 'pending',
      data: { videoUrl, subtitleText, videoTitle },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabId
    };

    this.tasks.set(task.id, task);
    await this.saveTasks();
    this.processQueue();

    return task;
  }

  /**
   * 处理任务队列
   */
  private async processQueue() {
    if (this.isProcessing) {
      return;
    }

    const pendingTask = Array.from(this.tasks.values())
      .find(t => t.status === 'pending');

    if (!pendingTask) {
      return;
    }

    this.isProcessing = true;

    try {
      await this.executeTask(pendingTask);
    } catch (error) {
      console.error('[TaskManager] Task execution failed:', error);
      pendingTask.status = 'failed';
      pendingTask.error = error instanceof Error ? error.message : 'Unknown error';
      pendingTask.updatedAt = Date.now();
    } finally {
      this.isProcessing = false;
      this.processQueue();
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: Task) {
    task.status = 'running';
    task.updatedAt = Date.now();
    await this.saveTasks();

    switch (task.type) {
      case 'download_subtitle':
        await this.executeDownloadTask(task);
        break;
      case 'generate_mindmap':
        await this.executeMindmapTask(task);
        break;
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }

    task.status = 'completed';
    task.updatedAt = Date.now();
    await this.saveTasks();
  }

  /**
   * 执行下载字幕任务
   */
  private async executeDownloadTask(task: Task) {
    const { videoUrl } = task.data;

    const result = await SubtitleService.downloadChineseSubtitle(videoUrl);

    task.result = result;

    // 下载完成后，自动创建生成思维导图任务，传递原始任务的 tabId
    await this.createMindmapTask(videoUrl, result.subtitleText, result.videoTitle, task.tabId);
  }

  /**
   * 执行生成思维导图任务
   */
  private async executeMindmapTask(task: Task) {
    const { videoUrl, subtitleText, videoTitle } = task.data;

    // 获取配置
    const config = await StorageService.getConfig();
    if (!config) {
      throw new Error('配置未初始化');
    }

    // 验证配置
    const validation = LLMService.validateConfig(config);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 调用大模型生成思维导图
    const mindmapMarkdown = await LLMService.generateMindmap(config, subtitleText);

    // 保存思维导图到内存/存储
    const mindmapData = {
      id: uuidv4(),
      videoUrl,
      videoTitle: videoTitle || 'Unknown',
      subtitleText,
      mindmapMarkdown,
      createdAt: Date.now(),
      status: 'completed' as const
    };

    await StorageService.saveMindmap(mindmapData);

    // 如果用户指定了缓存目录，保存文件到本地
    if (FileService.hasCacheDirectory(config)) {
      await this.saveFilesToCacheDirectory(mindmapData, config.settings.cacheDirectory);
    }

    task.result = mindmapData;

    // 通知content script，传递任务的 tabId
    this.notifyContentScript(mindmapData, task.tabId);
  }

  /**
   * 保存文件到用户指定的缓存目录
   */
  private async saveFilesToCacheDirectory(mindmapData: any, cacheDirectory: string): Promise<void> {
    try {
      // 保存字幕文件
      const subtitleFileName = FileService.generateSubtitleFileName(mindmapData.videoTitle);
      await FileService.saveSubtitleFile(
        mindmapData.subtitleText,
        subtitleFileName,
        cacheDirectory
      );

      // 保存思维导图文件
      const mindmapFileName = FileService.generateMindmapFileName(mindmapData.videoTitle);
      await FileService.saveMindmapFile(
        mindmapData.mindmapMarkdown,
        mindmapFileName,
        cacheDirectory
      );

      console.log(`[TaskManager] 文件已保存到: ${cacheDirectory}`);
    } catch (error) {
      console.error('[TaskManager] 保存文件到缓存目录失败:', error);
      // 保存文件失败不应该影响主流程，只记录日志
    }
  }

  /**
   * 通知content script有新的思维导图
   */
  private async notifyContentScript(mindmapData: any, tabId?: number) {
    // 如果有 tabId，直接发送到该标签页
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'MINDMAP_GENERATED',
          payload: {
            mindmapId: mindmapData.id,
            mindmapData
          }
        });
        console.log('[TaskManager] 已通知 content script 思维导图生成完成 (tabId:', tabId, ')');
        return;
      } catch (error: any) {
        // 如果目标标签页不存在或已关闭，忽略错误
        if (error?.message?.includes('Receiving end does not exist') ||
            error?.message?.includes('No tab with id')) {
          console.log('[TaskManager] 目标标签页不可用，思维导图已保存到存储中');
        } else {
          console.error('[TaskManager] 通知 content script 失败:', error);
        }
        return;
      }
    }

    // 如果没有 tabId（兼容旧任务），回退到查找匹配 URL 的标签页
    const videoUrl = mindmapData.videoUrl;
    if (videoUrl) {
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id && tab.url && tab.url.includes(videoUrl.split('?')[0])) {
            try {
              await chrome.tabs.sendMessage(tab.id, {
                type: 'MINDMAP_GENERATED',
                payload: {
                  mindmapId: mindmapData.id,
                  mindmapData
                }
              });
              console.log('[TaskManager] 已通知匹配URL的标签页 (tabId:', tab.id, ')');
              return;
            } catch {
              // 继续尝试其他标签页
            }
          }
        }
      } catch (error) {
        console.error('[TaskManager] 查找匹配标签页失败:', error);
      }
    }

    console.log('[TaskManager] 未找到可通知的标签页，思维导图已保存到存储中');
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getCurrentTask(): Task | undefined {
    // 优先返回正在运行的任务
    const runningTask = Array.from(this.tasks.values())
      .find(t => t.status === 'running');
    if (runningTask) return runningTask;

    // 否则返回最早等待的任务
    const pendingTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);

    if (pendingTasks.length > 0) return pendingTasks[0];

    // 最后返回最近完成的任务（30秒内），给用户一点反馈时间
    const now = Date.now();
    const recentCompletedTask = Array.from(this.tasks.values())
      .filter(t => (t.status === 'completed' || t.status === 'failed') && (now - (t.updatedAt || 0) < 30000))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

    return recentCompletedTask;
  }
  /**
   * 清理过期任务
   */
  async cleanupExpiredTasks() {
    const now = Date.now();
    const expireTime = 24 * 60 * 60 * 1000; // 24小时

    for (const [id, task] of this.tasks) {
      if (now - task.createdAt > expireTime) {
        this.tasks.delete(id);
      }
    }

    await this.saveTasks();
  }
}