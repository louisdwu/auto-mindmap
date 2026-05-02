import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types/mindmap';
import { SubtitleService } from '../services/subtitleService';
import { LLMService } from '../services/llmService';
import { StorageService } from '../services/storageService';
import { FileService } from '../services/fileService';
import { LoggerService } from '../services/loggerService';
import { VideoUtils } from '../utils/videoUtils';

const TASKS_STORAGE_KEY = 'active_tasks';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private isScheduling: boolean = false;

  constructor() {
    // 从 storage 恢复任务状态，并在恢复完成后继续处理队列
    this.restoreTasks().then(() => {
      this.processQueue();
    });
  }

  /**
   * 从 storage 恢复任务状态
   */
  private async restoreTasks() {
    try {
      const result = await chrome.storage.local.get(TASKS_STORAGE_KEY);
      const storedTasks = result[TASKS_STORAGE_KEY] || [];

      for (const task of storedTasks) {
        // 恢复未完成的任务
        if (task.status === 'pending') {
          this.tasks.set(task.id, task);
        } else if (task.status === 'running') {
          // 如果重启时发现任务处于 running 状态，说明上次由于 Service Worker 被强制关闭而中断
          // 我们将其设为 failed 状态，并提示用户重试，避免由于自动重启进入死循环（特别是 LLM 响应极慢导致 SW 频繁关闭时）
          task.status = 'failed';
          task.error = '任务由于浏览器后台服务中断而停止，建议调大超时时间并重试。';
          task.updatedAt = Date.now();
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
  async createDownloadTask(videoUrl: string, tabId?: number, force: boolean = false): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      type: 'download_subtitle',
      status: 'pending',
      data: { videoUrl, force },
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
  async createMindmapTask(videoUrl: string, subtitleText: string, videoTitle: string, tabId?: number, force?: boolean): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      type: 'generate_mindmap',
      status: 'pending',
      data: { videoUrl, subtitleText, videoTitle, force },
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
   * 处理任务队列 (核心调度逻辑)
   */
  private async processQueue() {
    if (this.isScheduling) return;
    this.isScheduling = true;

    try {
      const config = await StorageService.getConfig();
      const concurrencyLimit = config?.settings?.concurrencyLimit || 3;

      const allTasks = Array.from(this.tasks.values());
      const runningTasks = allTasks.filter(t => t.status === 'running');
      const pendingTasks = allTasks
        .filter(t => t.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt);

      if (runningTasks.length >= concurrencyLimit || pendingTasks.length === 0) {
        return;
      }

      const availableSlots = concurrencyLimit - runningTasks.length;
      const tasksToStart = pendingTasks.slice(0, availableSlots);

      console.log(`[TaskManager] Starting ${tasksToStart.length} tasks. Total running: ${runningTasks.length}/${concurrencyLimit}`);

      for (const task of tasksToStart) {
        // 非阻塞启动任务线程
        this.runTask(task);
      }
    } catch (error) {
      console.error('[TaskManager] Scheduling loop failed:', error);
    } finally {
      this.isScheduling = false;
    }
  }

  /**
   * 线程化执行任务，确保单个任务失败不影响调度
   */
  private async runTask(task: Task) {
    // 开启心跳，防止 Service Worker 在长耗时任务（如长视频 LLM 生成）中被 Chrome 杀死
    const heartbeatId = setInterval(() => {
      chrome.storage.local.get(['last_heartbeat']);
    }, 10000);

    try {
      await this.executeTask(task);
    } catch (error) {
      console.error(`[TaskManager] Task ${task.id} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      task.status = 'failed';
      task.error = errorMessage;
      task.updatedAt = Date.now();
      await this.saveTasks();
      
      // 必须通过 LoggerService 记录，否则用户的日志面板里看不到报错信息
      await LoggerService.error('TaskManager', `任务执行失败 (${task.type})`, error, task.id);
    } finally {
      clearInterval(heartbeatId);
      // 任务结束，尝试启动后续排队任务
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

    await LoggerService.info('TaskManager', `开始执行任务: ${task.type}`, { taskId: task.id }, task.id);

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

    // 如果是 YouTube 视频，跳过下载步骤
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      console.log('[TaskManager] YouTube video detected, skipping manual download task.');
      return;
    }

    const config = await StorageService.getConfig();
    if (!config) throw new Error('配置未初始化');

    const result = await SubtitleService.downloadChineseSubtitle(
      videoUrl, 
      config,
      async (msg) => {
        task.statusMessage = msg;
        task.updatedAt = Date.now();
        await this.saveTasks();
      },
      task.data.force === true
    );

    task.result = result;
    task.statusMessage = '字幕获取成功，即将开始生成思维导图';

    // 下载完成后，自动创建生成思维导图任务
    await this.createMindmapTask(videoUrl, result.subtitleText, result.videoTitle, task.tabId);
  }

  /**
   * 执行生成思维导图任务
   */
  private async executeMindmapTask(task: Task) {
    const { videoUrl, subtitleText, videoTitle, force } = task.data;
    const videoId = VideoUtils.extractVideoId(videoUrl);

    if (videoId && force) {
      await StorageService.deletePhase1Cache(videoId);
    }

    // 获取配置
    const config = await StorageService.getConfig();
    if (!config) {
      throw new Error('配置未初始化');
    }

    // 验证配置
    const llmConfigs = await StorageService.getLLMConfigs();
    const selectedId = config.selectedLLMConfigId || 'default';
    const llmConfig = llmConfigs.find(c => c.id === selectedId) || llmConfigs[0];
    
    if (!llmConfig) throw new Error('未找到有效的 LLM 配置');

    const validation = LLMService.validateConfig(llmConfig, config);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 尝试加载 Phase 1 缓存
    let cachedInitialMindmap: string | undefined = undefined;
    if (videoId && config.settings.enableReflection) {
      const cache = await StorageService.getPhase1Cache(videoId);
      if (cache) {
        cachedInitialMindmap = cache;
        await LoggerService.info('TaskManager', `检测到阶段 1 缓存 (从浏览器存储读取)，跳过初版生成。`, undefined, task.id);
      } else {
        await LoggerService.debug('TaskManager', `未检测到阶段 1 缓存，准备开始全新生成。`, undefined, task.id);
      }
    }

    // 调用大模型生成思维导图
    const { result: mindmapMarkdown, initialResult: initialMindmapMarkdown } = await LLMService.generateMindmap(
      config, 
      subtitleText,
      async (msg) => {
        task.statusMessage = msg;
        task.updatedAt = Date.now();
        await this.saveTasks();
      },
      async (initialMindmap) => {
        if (videoId) {
          await StorageService.savePhase1Cache(videoId, initialMindmap);
          await LoggerService.debug('TaskManager', `阶段 1 初稿已存入浏览器内置存储 (用于断点续传)`, undefined, task.id);
        }
        // 移除阶段 1 的本地文件保存，统一由任务结束时的 saveFilesToCacheDirectory 处理，避免重复下载
      },
      cachedInitialMindmap,
      task.id
    );

    // 成功完成全部生成，清除 Phase 1 缓存，以免下次影响全新生成
    if (videoId) {
      await StorageService.deletePhase1Cache(videoId);
    }

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

    await LoggerService.info('TaskManager', '思维导图生成成功，正在保存并通知 UI', undefined, task.id);
    await StorageService.saveMindmap(mindmapData);

    // 如果用户指定了缓存目录，保存最终文件到本地（注意阶段1如果已经保存，这里只保存最终版即可，但为了完整性，这里调用原方法覆盖或者跳过，我们这里修改 saveFilesToCacheDirectory 使其不再重复保存字幕）
    if (FileService.hasCacheDirectory(config)) {
      await this.saveFilesToCacheDirectory(mindmapData, initialMindmapMarkdown, config.settings.cacheDirectory);
    }

    task.result = mindmapData;

    // 通知content script，传递任务的 tabId
    this.notifyContentScript(mindmapData, task.tabId);
  }

  /**
   * 保存文件到用户指定的缓存目录 (这里保存最终结果)
   */
  private async saveFilesToCacheDirectory(mindmapData: any, initialMindmapMarkdown: string | undefined, cacheDirectory: string): Promise<void> {
    try {
      // 字幕和初始总结可能在 Phase 1 已经保存过，但为了非反思模式或补充保存，这里也保存
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

      // 保存初步总结文件（仅在开启反思模式时有值）
      if (initialMindmapMarkdown) {
        const initialMindmapFileName = FileService.generateInitialMindmapFileName(mindmapData.videoTitle);
        await FileService.saveMindmapFile(
          initialMindmapMarkdown,
          initialMindmapFileName,
          cacheDirectory
        );
      }

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