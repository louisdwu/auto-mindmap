import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types/mindmap';
import { SubtitleService } from '../services/subtitleService';
import { LLMService } from '../services/llmService';
import { StorageService } from '../services/storageService';
import { FileService } from '../services/fileService';
import { LoggerService } from '../services/loggerService';
import { VideoUtils } from '../utils/videoUtils';
import { StatsService } from '../services/statsService';
import { normalizeAsrLanguage } from '../types/config';

const TASKS_STORAGE_KEY = 'active_tasks';
// 用户主动选择「仅获取字幕」后，短时间内抑制同一视频的自动导图流程
const SUBTITLE_ONLY_MODE_KEY = 'subtitle_only_mode';
const SUBTITLE_ONLY_MODE_TTL = 10 * 60 * 1000;

/** 任务结束多久后仍允许 UI 看到结果 */
const RECENT_COMPLETED_MS = 30 * 1000;
const RECENT_FAILED_MS = 60 * 60 * 1000;
const TASK_RETENTION_MS = 24 * 60 * 60 * 1000;

/** 服务端长任务期间保活：Chrome 会在 SW 空闲 ~30s 后回收，扩展 API 调用可重置计时 */
const HEARTBEAT_INTERVAL_MS = 20 * 1000;

interface TaskInput {
  subtitleText: string;
  videoTitle?: string;
}

/**
 * 任务管理器（v2）
 *
 * 设计原则：
 * 1. 内存里保存完整任务（含字幕/导图），持久化时剥离大字段，避免每次进度更新
 *    都把整篇字幕写进 chrome.storage.local，造成写放大与配额风险。
 * 2. 调度与执行分离：processQueue 同步「认领」任务并置为 running，再异步执行，
 *    避免并发窗口内重复启动同一任务或突破并发上限。
 * 3. 状态变更才是持久化时机；进度只广播给 UI，不落盘。
 * 4. 任务的身份统一使用 utils/media.ts 的 cacheId，B 站分 P 不会互相命中。
 */
export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  /** 直接生成任务的字幕原文只放在内存/字幕缓存，不写进 active_tasks */
  private taskInputs: Map<string, TaskInput> = new Map();
  private runningTaskIds: Set<string> = new Set();
  private isScheduling = false;
  private scheduleAgain = false;
  private concurrencyLimit = 3;

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 初始化（配置读取 + 任务恢复）完成信号；创建任务必须等它就绪 */
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    try {
      const config = await StorageService.getConfig();
      this.concurrencyLimit = this.clampConcurrency(config?.settings?.concurrencyLimit);
    } catch {
      this.concurrencyLimit = 3;
    }

    await this.restoreTasks();
    this.updateHeartbeat();
    this.schedule();
  }

  private clampConcurrency(value?: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 3;
    return Math.min(20, Math.max(1, Math.floor(n)));
  }

  // ------------------------------------------------------------------ //
  // 持久化
  // ------------------------------------------------------------------ //

  /**
   * 从 storage 恢复任务状态。
   * running 状态说明上一次 Service Worker 被浏览器回收，无法安全续跑，标记失败；
   * pending 任务可以继续排队；completed 不恢复（UI 通过导图缓存读取）。
   */
  private async restoreTasks(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(TASKS_STORAGE_KEY);
      const storedTasks: Task[] = Array.isArray(result[TASKS_STORAGE_KEY])
        ? result[TASKS_STORAGE_KEY]
        : [];

      for (const task of storedTasks) {
        if (!task?.id || !task.data?.videoUrl) continue;

        if (task.status === 'pending') {
          this.tasks.set(task.id, task);
          continue;
        }

        if (task.status === 'running') {
          task.status = 'failed';
          task.error = '任务由于浏览器后台服务中断而停止，建议调大超时时间并重试。';
          task.updatedAt = Date.now();
          if (this.shouldKeepFailedTask(task)) this.tasks.set(task.id, task);
          continue;
        }

        if (task.status === 'failed' && this.shouldKeepFailedTask(task)) {
          this.tasks.set(task.id, task);
        }
      }

      console.log('[TaskManager] Restored tasks:', this.tasks.size);
      await this.flushPersist();
    } catch (error) {
      console.error('[TaskManager] Failed to restore tasks:', error);
    }
  }

  private shouldKeepFailedTask(task: Task): boolean {
    const isRecent = Date.now() - (task.updatedAt || task.createdAt || 0) < RECENT_FAILED_MS;
    if (!isRecent) return false;
    return task.type === 'generate_mindmap'
      || (task.type === 'download_subtitle' && task.data?.subtitleOnly === true);
  }

  /**
   * 剥离字幕与导图大字段后再落盘。
   * 这些内容已经分别保存在字幕缓存 / 导图存储中，任务表只保留状态与定位信息。
   */
  private serializeTask(task: Task): Task {
    const serialized: Task = {
      ...task,
      data: { ...task.data },
      result: task.result ? { ...task.result } : undefined
    };

    if (serialized.result) {
      delete serialized.data.subtitleText;
      delete serialized.result.subtitleText;
      delete serialized.result.mindmapMarkdown;
      delete serialized.result.initialMindmapMarkdown;
      if (serialized.result.mindmapData) {
        const { mindmapMarkdown, subtitleText, initialMindmapMarkdown, ...rest } = serialized.result.mindmapData;
        void mindmapMarkdown;
        void subtitleText;
        void initialMindmapMarkdown;
        serialized.result.mindmapData = rest;
      }
    }

    return serialized;
  }

  /** 合并短时间内的多次落盘请求，并按调用顺序串行执行，避免旧快照覆盖新快照 */
  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersist();
    }, 250);
  }

  private async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    const snapshot = Array.from(this.tasks.values()).map(task => this.serializeTask(task));
    this.persistChain = this.persistChain.then(async () => {
      try {
        await chrome.storage.local.set({ [TASKS_STORAGE_KEY]: snapshot });
      } catch (error) {
        console.error('[TaskManager] Failed to save tasks:', error);
      }
    });

    await this.persistChain;
  }

  // ------------------------------------------------------------------ //
  // 视频身份与意图
  // ------------------------------------------------------------------ //

  private isSameVideo(urlA?: string, urlB?: string): boolean {
    return VideoUtils.isSameVideo(urlA, urlB);
  }

  async markSubtitleOnlyMode(videoUrl: string): Promise<void> {
    const videoId = VideoUtils.getCacheId(videoUrl);
    if (!videoId) return;

    const result = await chrome.storage.local.get(SUBTITLE_ONLY_MODE_KEY);
    const modes: Record<string, number> = result[SUBTITLE_ONLY_MODE_KEY] || {};
    const now = Date.now();

    for (const [key, expiresAt] of Object.entries(modes)) {
      if (!expiresAt || expiresAt <= now) delete modes[key];
    }
    modes[videoId] = now + SUBTITLE_ONLY_MODE_TTL;
    await chrome.storage.local.set({ [SUBTITLE_ONLY_MODE_KEY]: modes });
  }

  async isSubtitleOnlyMode(videoUrl: string): Promise<boolean> {
    const videoId = VideoUtils.getCacheId(videoUrl);
    if (!videoId) return false;

    const result = await chrome.storage.local.get(SUBTITLE_ONLY_MODE_KEY);
    const modes: Record<string, number> = result[SUBTITLE_ONLY_MODE_KEY] || {};
    const expiresAt = modes[videoId];
    return typeof expiresAt === 'number' && expiresAt > Date.now();
  }

  async clearSubtitleOnlyMode(videoUrl: string): Promise<void> {
    const videoId = VideoUtils.getCacheId(videoUrl);
    if (!videoId) return;

    const result = await chrome.storage.local.get(SUBTITLE_ONLY_MODE_KEY);
    const modes: Record<string, number> = result[SUBTITLE_ONLY_MODE_KEY] || {};
    if (!(videoId in modes)) return;

    delete modes[videoId];
    await chrome.storage.local.set({ [SUBTITLE_ONLY_MODE_KEY]: modes });
  }

  async cancelPendingMindmapTasks(videoUrl: string): Promise<number> {
    await this.ready;
    const pending = Array.from(this.tasks.values()).filter(t =>
      t.type === 'generate_mindmap' &&
      t.status === 'pending' &&
      this.isSameVideo(t.data?.videoUrl, videoUrl)
    );
    if (pending.length === 0) return 0;

    for (const task of pending) {
      this.tasks.delete(task.id);
      this.taskInputs.delete(task.id);
      this.broadcastTaskUpdate(task);
    }
    await this.flushPersist();
    console.log('[TaskManager] 已取消排队中的导图任务:', pending.map(t => t.id));
    return pending.length;
  }

  /**
   * 将正在排队/执行的普通字幕任务切换为「仅获取字幕」。
   * 复用该任务可避免重复下载/重复 ASR。
   */
  async promoteToSubtitleOnly(videoUrl: string): Promise<Task | undefined> {
    await this.ready;
    const task = Array.from(this.tasks.values()).find(t =>
      t.type === 'download_subtitle' &&
      (t.status === 'pending' || t.status === 'running') &&
      t.data?.subtitleOnly !== true &&
      this.isSameVideo(t.data?.videoUrl, videoUrl)
    );
    if (!task) return undefined;

    task.data = { ...task.data, subtitleOnly: true };
    task.updatedAt = Date.now();
    await this.flushPersist();
    this.broadcastTaskUpdate(task);
    console.log('[TaskManager] 进行中的下载任务已切换为仅字幕模式:', task.id);
    return task;
  }

  private findActiveTask(videoUrl: string, type: Task['type']): Task | undefined {
    return Array.from(this.tasks.values()).find(task => {
      if (task.type !== type) return false;
      if (task.status !== 'pending' && task.status !== 'running') return false;
      return this.isSameVideo(task.data?.videoUrl, videoUrl);
    });
  }

  // ------------------------------------------------------------------ //
  // 创建任务
  // ------------------------------------------------------------------ //

  async createDownloadTask(
    videoUrl: string,
    tabId?: number,
    force: boolean = false,
    subtitleOnly: boolean = false,
    videoTitle?: string,
    forceAsr: boolean = false
  ): Promise<Task> {
    await this.ready;
    const runningTask = force ? undefined : this.findActiveTask(videoUrl, 'download_subtitle');
    if (runningTask) {
      if (subtitleOnly && runningTask.data?.subtitleOnly !== true) {
        runningTask.data = { ...runningTask.data, subtitleOnly: true };
        runningTask.updatedAt = Date.now();
        await this.flushPersist();
        this.broadcastTaskUpdate(runningTask);
        console.log('[TaskManager] 复用并切换进行中的字幕任务为仅字幕:', runningTask.id);
      } else {
        console.log('[TaskManager] 复用进行中的字幕任务:', runningTask.id);
      }
      return runningTask;
    }

    const task: Task = {
      id: uuidv4(),
      type: 'download_subtitle',
      status: 'pending',
      data: { videoUrl, force, subtitleOnly, videoTitle, forceAsr },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabId
    };

    this.tasks.set(task.id, task);
    await this.flushPersist();
    this.broadcastTaskUpdate(task);
    this.schedule();
    return task;
  }

  async createMindmapTask(
    videoUrl: string,
    subtitleText: string,
    videoTitle: string,
    tabId?: number,
    force?: boolean
  ): Promise<Task> {
    await this.ready;
    const cacheId = VideoUtils.getCacheId(videoUrl);
    if (cacheId && subtitleText) {
      await StorageService.saveSubtitleCache(cacheId, subtitleText).catch(err => {
        console.warn('[TaskManager] Failed to save subtitle cache:', err);
      });
    }

    if (force !== true) {
      const activeTask = this.findActiveTask(videoUrl, 'generate_mindmap');
      if (activeTask) {
        console.log('[TaskManager] 复用进行中的导图任务:', activeTask.id);
        return activeTask;
      }
    }

    const task: Task = {
      id: uuidv4(),
      type: 'generate_mindmap',
      status: 'pending',
      data: { videoUrl, videoTitle, force },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabId
    };

    // 直接生成时字幕来自页面，先落字幕缓存：任务表不保存原文，
    // 但 SW 重启或 LLM 失败后仍能通过 GET_SUBTITLE_CACHE 找回。
    this.taskInputs.set(task.id, { subtitleText, videoTitle });

    this.tasks.set(task.id, task);
    await this.flushPersist();
    this.broadcastTaskUpdate(task);
    this.schedule();
    return task;
  }

  // ------------------------------------------------------------------ //
  // 调度与执行
  // ------------------------------------------------------------------ //

  /**
   * 调度队列：先同步认领空位（置 running），再异步执行。
   * 这样即使 executeTask 内部有 await，也不会被下一次 schedule 重复启动。
   */
  private schedule(): void {
    if (this.isScheduling) {
      this.scheduleAgain = true;
      return;
    }
    this.isScheduling = true;

    void (async () => {
      try {
        const config = await StorageService.getConfig();
        this.concurrencyLimit = this.clampConcurrency(config?.settings?.concurrencyLimit);

        // 以内存状态为准重建运行集合，防止异常路径遗漏
        this.runningTaskIds = new Set(
          Array.from(this.tasks.values())
            .filter(t => t.status === 'running')
            .map(t => t.id)
        );

        const availableSlots = this.concurrencyLimit - this.runningTaskIds.size;
        if (availableSlots <= 0) return;

        const pendingTasks = Array.from(this.tasks.values())
          .filter(t => t.status === 'pending')
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(0, availableSlots);

        for (const task of pendingTasks) {
          task.status = 'running';
          task.updatedAt = Date.now();
          this.runningTaskIds.add(task.id);
          this.broadcastTaskUpdate(task);
          void this.runTask(task);
        }

        if (pendingTasks.length > 0) {
          console.log(`[TaskManager] Started ${pendingTasks.length} tasks. Running: ${this.runningTaskIds.size}/${this.concurrencyLimit}`);
          this.updateHeartbeat();
          this.persistSoon();
        }
      } catch (error) {
        console.error('[TaskManager] Scheduling loop failed:', error);
      } finally {
        this.isScheduling = false;
        if (this.scheduleAgain) {
          this.scheduleAgain = false;
          this.schedule();
        }
      }
    })();
  }

  /**
   * 长任务期间保活：定时调用扩展 API 重置 Service Worker 空闲计时。
   * 没有运行中任务时必须停掉，避免无意义唤醒。
   */
  private updateHeartbeat(): void {
    if (this.runningTaskIds.size > 0) {
      if (this.heartbeatTimer) return;
      this.heartbeatTimer = setInterval(() => {
        chrome.runtime.getPlatformInfo().catch(() => {
          // 扩展上下文失效时静默
        });
      }, HEARTBEAT_INTERVAL_MS);
      return;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private broadcastTaskUpdate(task: Task): void {
    const payload = { task: this.serializeTask(task) };
    if (task.tabId) {
      chrome.tabs.sendMessage(task.tabId, { type: 'TASK_UPDATE', payload }).catch(() => {
        // 标签页关闭或 content script 未注入时忽略
      });
      return;
    }
    chrome.runtime.sendMessage({ type: 'TASK_UPDATE', payload }).catch(() => {
      // 没有接收者时忽略
    });
  }

  private async runTask(task: Task): Promise<void> {
    try {
      await this.executeTask(task);
      task.status = 'completed';
      task.updatedAt = Date.now();
    } catch (error: any) {
      console.error(`[TaskManager] Task ${task.id} failed:`, error);
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      task.updatedAt = Date.now();

      if (task.type === 'generate_mindmap') {
        const videoId = VideoUtils.getCacheId(task.data.videoUrl);
        const config = await StorageService.getConfig();
        const selectedId = config?.selectedLLMConfigId || 'default';
        await StatsService.recordGeneration({
          videoId,
          modelId: selectedId,
          isReflectionEnabled: config?.settings.enableReflection || false,
          isSuccess: false
        });
      }

      await LoggerService.error('TaskManager', `任务执行失败 (${task.type})`, error, task.id);
    } finally {
      this.runningTaskIds.delete(task.id);
      if (task.status === 'failed') {
        this.taskInputs.delete(task.id);
      }
      this.updateHeartbeat();
      this.broadcastTaskUpdate(task);
      await this.flushPersist();
      this.schedule();
    }
  }

  private async executeTask(task: Task): Promise<void> {
    task.statusMessage = '开始执行...';
    task.updatedAt = Date.now();
    this.broadcastTaskUpdate(task);
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

    task.updatedAt = Date.now();
  }

  private reportProgress(task: Task, message: string): void {
    task.statusMessage = message;
    task.updatedAt = Date.now();
    // 进度只广播，不落盘：任务表落盘只发生在状态迁移时。
    this.broadcastTaskUpdate(task);
  }

  private async executeDownloadTask(task: Task): Promise<void> {
    const { videoUrl, subtitleOnly } = task.data;
    const videoId = VideoUtils.getCacheId(videoUrl);
    const config = await StorageService.getConfig();

    if (subtitleOnly && videoId && task.data.force !== true) {
      this.reportProgress(task, '正在检索已缓存的字幕...');

      const subtitleCache = await StorageService.getSubtitleCache(videoId);
      const asrCache = subtitleCache
        ? null
        : await StorageService.getAsrCache(videoId, normalizeAsrLanguage(config?.settings.asrLanguage));
      const cachedText = subtitleCache || asrCache;
      if (cachedText && /\[\d{1,2}:\d{2}/.test(cachedText)) {
        console.log('[TaskManager] 命中字幕缓存，直接返回（仅字幕模式）:', videoId);
        await this.finishSubtitleOnlyTask(task, {
          videoUrl,
          videoTitle: task.data.videoTitle || '视频字幕',
          subtitleText: cachedText,
          isAsr: asrCache !== null,
          fromCache: true
        });
        return;
      }
    }

    // 普通流程也优先复用已有字幕：用户之前右键「仅获取字幕」或上次 ASR 已完成时，
    // 不必重新下载/重新识别一遍，直接进入导图生成。
    if (!subtitleOnly && videoId && task.data.force !== true && task.data.forceAsr !== true) {
      const cachedSubtitle = await StorageService.getSubtitleCache(videoId);
      if (cachedSubtitle && /\[\d{1,2}:\d{2}/.test(cachedSubtitle)) {
        const videoTitle = task.data.videoTitle || '视频';
        task.result = { videoUrl, videoTitle, subtitleText: cachedSubtitle, isAsr: false };
        this.reportProgress(task, '复用已缓存字幕，正在生成思维导图...');
        await this.createMindmapTask(videoUrl, cachedSubtitle, videoTitle, task.tabId);
        return;
      }
    }

    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      console.log('[TaskManager] YouTube video detected, delegating to content script for subtitle.');
      await this.executeYouTubeDownloadTask(task, videoUrl);
      return;
    }

    if (!config) throw new Error('配置未初始化');

    const result = await SubtitleService.downloadChineseSubtitle(
      videoUrl,
      config,
      (msg) => this.reportProgress(task, msg),
      task.data.force === true,
      task.tabId,
      task.data.forceAsr === true
    );

    // 读取最新 data：右键可能已把进行中的普通下载任务切换为仅字幕模式
    if (task.data.subtitleOnly === true) {
      await this.finishSubtitleOnlyTask(task, { ...result, fromCache: false });
      return;
    }

    task.result = result;
    this.reportProgress(task, '字幕获取成功，正在生成思维导图...');

    await this.createMindmapTask(videoUrl, result.subtitleText, result.videoTitle, task.tabId);
  }

  /**
   * YouTube 字幕获取：content script 代理 → 无 CC 时回退 ASR。
   */
  private async executeYouTubeDownloadTask(task: Task, videoUrl: string): Promise<void> {
    const tabId = task.tabId;
    if (!tabId) {
      throw new Error('YouTube 字幕获取失败：缺少标签页上下文。请刷新视频页面后再次点击悬浮球。');
    }

    const cacheId = VideoUtils.getCacheId(videoUrl);
    let videoTitle = 'YouTube 视频';
    let subtitleText: string | null = null;
    let isAsr = false;
    const forceAsr = task.data.forceAsr === true;

    if (!forceAsr) {
      this.reportProgress(task, '正在通过页面上下文获取 YouTube 字幕...');
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: 'FETCH_YOUTUBE_SUBTITLE' });
        if (resp?.subtitleText && String(resp.subtitleText).trim()) {
          subtitleText = String(resp.subtitleText);
        }
        if (resp?.videoTitle) videoTitle = resp.videoTitle;
      } catch (e: any) {
        console.warn('[TaskManager] FETCH_YOUTUBE_SUBTITLE 失败，将尝试 ASR 回退:', e?.message || e);
      }
    }

    if (!subtitleText) {
      const config = await StorageService.getConfig();
      if (!config) throw new Error('配置未初始化');

      this.reportProgress(task, forceAsr
        ? '正在重新语音识别（跳过官方字幕与缓存）...'
        : '未检测到 YouTube 字幕，准备下载音频进行语音识别...');

      let audioUrl: string | null = null;
      try {
        const audioResp = await chrome.tabs.sendMessage(tabId, { type: 'FETCH_YOUTUBE_AUDIO_URL' });
        audioUrl = audioResp?.audioUrl || null;
        if (audioResp?.videoTitle) videoTitle = audioResp.videoTitle;
      } catch (e: any) {
        throw new Error(`YouTube 音频流地址获取失败：无法与页面通信（${e?.message || e}）。请刷新视频页面后重试。`);
      }
      if (!audioUrl) {
        throw new Error('无法从页面提取 YouTube 音频流地址（可能是受签名保护的内容），暂不支持语音识别。');
      }

      const asrResult = await SubtitleService.runAsrFlow({
        audioUrl,
        videoId: cacheId || videoUrl,
        videoTitle,
        videoUrl,
        config,
        onProgress: (msg) => this.reportProgress(task, msg),
        forceMode: task.data.force === true,
        tabId
      });
      subtitleText = asrResult.subtitleText;
      isAsr = true;
    }

    if (!subtitleText || !subtitleText.trim()) {
      throw new Error('YouTube 字幕与语音识别均未能获取到文本，请稍后重试。');
    }

    if (task.data.subtitleOnly === true) {
      await this.finishSubtitleOnlyTask(task, { videoUrl, videoTitle, subtitleText, isAsr, fromCache: false });
      return;
    }

    if (cacheId) {
      StorageService.saveSubtitleCache(cacheId, subtitleText).catch(err => {
        console.warn('[TaskManager] Failed to save YouTube subtitle cache:', err);
      });
    }

    task.result = { videoUrl, videoTitle, subtitleText, isAsr };
    this.reportProgress(task, '字幕获取成功，正在生成思维导图...');
    await this.createMindmapTask(videoUrl, subtitleText, videoTitle, task.tabId);
  }

  /**
   * 收尾「仅获取字幕」任务：缓存字幕、按需落盘、通知 content script。
   */
  private async finishSubtitleOnlyTask(
    task: Task,
    result: {
      videoUrl: string;
      videoTitle: string;
      subtitleText: string;
      isAsr?: boolean;
      fromCache?: boolean;
    }
  ): Promise<void> {
    const { videoUrl, videoTitle, subtitleText, isAsr, fromCache } = result;
    const videoId = VideoUtils.getCacheId(videoUrl);

    if (videoId) {
      StorageService.saveSubtitleCache(videoId, subtitleText).catch(err => {
        console.warn('[TaskManager] Failed to save subtitle-only cache:', err);
      });
    }

    let savedToFile = false;
    try {
      const config = await StorageService.getConfig();
      if (!fromCache && config && FileService.hasCacheDirectory(config)) {
        await FileService.saveSubtitleFile(
          subtitleText,
          FileService.generateSubtitleFileName(videoTitle),
          config.settings.cacheDirectory
        );
        savedToFile = true;
      }
    } catch (e) {
      console.warn('[TaskManager] 仅字幕模式保存文件失败（不影响结果交付）:', e);
    }

    task.result = {
      videoUrl,
      videoTitle,
      subtitleText,
      isAsr: isAsr === true,
      subtitleOnly: true,
      fromCache: fromCache === true,
      savedToFile
    };
    task.statusMessage = fromCache ? '已复用缓存字幕' : '字幕获取完成';
    task.updatedAt = Date.now();
    this.broadcastTaskUpdate(task);
    await this.notifySubtitleReady(task);
  }

  private async notifySubtitleReady(task: Task): Promise<void> {
    const tabId = task.tabId;
    const result = task.result;
    if (!tabId || !result?.subtitleText) {
      console.log('[TaskManager] 仅字幕任务缺少标签页上下文，结果已保存在存储中');
      return;
    }

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'SUBTITLE_READY',
        payload: {
          taskId: task.id,
          videoUrl: result.videoUrl,
          videoTitle: result.videoTitle,
          subtitleText: result.subtitleText,
          isAsr: result.isAsr === true,
          savedToFile: result.savedToFile === true
        }
      });
      console.log('[TaskManager] 已通知 content script 字幕就绪 (tabId:', tabId, ')');
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.includes('Receiving end does not exist') || message.includes('No tab with id')) {
        console.log('[TaskManager] 目标标签页不可用，字幕结果已保存在存储中');
      } else {
        console.error('[TaskManager] 通知字幕结果失败:', error);
      }
    }
  }

  private async resolveSubtitleText(task: Task): Promise<string | null> {
    const input = this.taskInputs.get(task.id);
    if (input?.subtitleText) return input.subtitleText;

    const videoId = VideoUtils.getCacheId(task.data.videoUrl);
    if (!videoId) return null;

    const subtitle = await StorageService.getSubtitleCache(videoId);
    if (subtitle) return subtitle;

    const config = await StorageService.getConfig();
    return StorageService.getAsrCache(videoId, normalizeAsrLanguage(config?.settings.asrLanguage));
  }

  private async executeMindmapTask(task: Task): Promise<void> {
    const { videoUrl, videoTitle, force } = task.data;
    const videoId = VideoUtils.getCacheId(videoUrl);

    const subtitleText = await this.resolveSubtitleText(task);
    if (!subtitleText) {
      throw new Error('字幕已失效，请重新获取字幕后重试。');
    }

    if (videoId && force) {
      await StorageService.deletePhase1Cache(videoId);
    }

    const config = await StorageService.getConfig();
    if (!config) throw new Error('配置未初始化');

    const llmConfigs = await StorageService.getLLMConfigs();
    const selectedId = config.selectedLLMConfigId || 'default';
    const llmConfig = llmConfigs.find(c => c.id === selectedId) || llmConfigs[0];
    if (!llmConfig) throw new Error('未找到有效的 LLM 配置');

    const validation = LLMService.validateConfig(llmConfig, config);
    if (!validation.valid) throw new Error(validation.error);

    let cachedInitialMindmap: string | undefined;
    if (videoId && config.settings.enableReflection) {
      const cache = await StorageService.getPhase1Cache(videoId);
      if (cache) {
        cachedInitialMindmap = cache;
        await LoggerService.info('TaskManager', '检测到阶段 1 缓存 (从浏览器存储读取)，跳过初版生成。', undefined, task.id);
      }
    }

    const { result: mindmapMarkdown, initialResult: initialMindmapMarkdown, reflectionSuccess } = await LLMService.generateMindmap(
      config,
      subtitleText,
      (msg) => this.reportProgress(task, msg),
      async (initialMindmap) => {
        if (videoId) {
          await StorageService.savePhase1Cache(videoId, initialMindmap);
          await LoggerService.debug('TaskManager', '阶段 1 初稿已存入浏览器内置存储 (用于断点续传)', undefined, task.id);
        }
      },
      cachedInitialMindmap,
      task.id
    );

    await StatsService.recordGeneration({
      videoId,
      modelId: selectedId,
      isReflectionEnabled: config.settings.enableReflection,
      reflectionSuccess,
      isSuccess: true
    });

    if (videoId) {
      await StorageService.deletePhase1Cache(videoId);
    }

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
    this.taskInputs.delete(task.id);

    if (FileService.hasCacheDirectory(config)) {
      await this.saveFilesToCacheDirectory(mindmapData, initialMindmapMarkdown, config.settings.cacheDirectory);
    }

    task.result = mindmapData;
    this.notifyContentScript(mindmapData, task.tabId);
  }

  private async saveFilesToCacheDirectory(
    mindmapData: any,
    initialMindmapMarkdown: string | undefined,
    cacheDirectory: string
  ): Promise<void> {
    try {
      await FileService.saveSubtitleFile(
        mindmapData.subtitleText,
        FileService.generateSubtitleFileName(mindmapData.videoTitle),
        cacheDirectory
      );

      await FileService.saveMindmapFile(
        mindmapData.mindmapMarkdown,
        FileService.generateMindmapFileName(mindmapData.videoTitle),
        cacheDirectory
      );

      if (initialMindmapMarkdown) {
        await FileService.saveMindmapFile(
          initialMindmapMarkdown,
          FileService.generateInitialMindmapFileName(mindmapData.videoTitle),
          cacheDirectory
        );
      }

      console.log(`[TaskManager] 文件已保存到: ${cacheDirectory}`);
    } catch (error) {
      console.error('[TaskManager] 保存文件到缓存目录失败:', error);
    }
  }

  private async notifyContentScript(mindmapData: any, tabId?: number): Promise<void> {
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'MINDMAP_GENERATED',
          payload: { mindmapId: mindmapData.id, mindmapData }
        });
        console.log('[TaskManager] 已通知 content script 思维导图生成完成 (tabId:', tabId, ')');
        return;
      } catch (error: any) {
        if (error?.message?.includes('Receiving end does not exist') ||
            error?.message?.includes('No tab with id')) {
          console.log('[TaskManager] 目标标签页不可用，思维导图已保存到存储中');
        } else {
          console.error('[TaskManager] 通知 content script 失败:', error);
        }
        return;
      }
    }

    const videoUrl = mindmapData.videoUrl;
    if (!videoUrl) return;

    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && VideoUtils.isSameVideo(tab.url, videoUrl)) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'MINDMAP_GENERATED',
              payload: { mindmapId: mindmapData.id, mindmapData }
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

    console.log('[TaskManager] 未找到可通知的标签页，思维导图已保存到存储中');
  }

  // ------------------------------------------------------------------ //
  // 查询与清理
  // ------------------------------------------------------------------ //

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getCurrentTask(videoUrl?: string): Task | undefined {
    const allTasks = Array.from(this.tasks.values());

    if (videoUrl) {
      const matching = allTasks.filter(t => this.isSameVideo(t.data?.videoUrl, videoUrl));

      const runningTask = matching.find(t => t.status === 'running');
      if (runningTask) return runningTask;

      const pendingTask = matching
        .filter(t => t.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (pendingTask) return pendingTask;

      const now = Date.now();
      return matching
        .filter(t => {
          const timeDiff = now - (t.updatedAt || 0);
          if (t.status === 'completed') return timeDiff < RECENT_COMPLETED_MS;
          if (t.status === 'failed') return timeDiff < RECENT_FAILED_MS;
          return false;
        })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    }

    const runningTask = allTasks.find(t => t.status === 'running');
    if (runningTask) return runningTask;

    const pendingTask = allTasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (pendingTask) return pendingTask;

    const now = Date.now();
    return allTasks
      .filter(t => {
        const timeDiff = now - (t.updatedAt || 0);
        if (t.status === 'completed') return timeDiff < RECENT_COMPLETED_MS;
        if (t.status === 'failed') return timeDiff < RECENT_FAILED_MS;
        return false;
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }

  async cleanupExpiredTasks(): Promise<void> {
    const now = Date.now();

    for (const [id, task] of this.tasks) {
      if (now - task.createdAt > TASK_RETENTION_MS) {
        this.tasks.delete(id);
        this.taskInputs.delete(id);
      }
    }

    await this.flushPersist();
  }
}