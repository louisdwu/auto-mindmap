import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types/mindmap';
import { SubtitleService } from '../services/subtitleService';
import { LLMService } from '../services/llmService';
import { StorageService } from '../services/storageService';
import { FileService } from '../services/fileService';
import { LoggerService } from '../services/loggerService';
import { VideoUtils } from '../utils/videoUtils';
import { StatsService } from '../services/statsService';

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
        } else if (task.status === 'failed') {
          // 保留 generate_mindmap 失败任务（其字幕可供用户复制/查看报错）
          // 以及用户主动触发的「仅获取字幕」失败任务（用户需要看到失败原因）
          // 普通 download_subtitle 失败任务无字幕价值，字幕获取逻辑已多次迭代，
          // 保留旧失败任务会误导用户以为新代码仍有问题，故 Service Worker 重启时丢弃
          const isRecentFailure = Date.now() - (task.updatedAt || task.createdAt || 0) < 3600000;
          const shouldKeep = isRecentFailure && (
            task.type === 'generate_mindmap' ||
            (task.type === 'download_subtitle' && task.data?.subtitleOnly === true)
          );
          if (shouldKeep) {
            this.tasks.set(task.id, task);
          }
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
   * 判断两个视频 URL 是否指向同一视频
   */
  private isSameVideo(urlA?: string, urlB?: string): boolean {
    if (!urlA || !urlB) return false;
    const idA = VideoUtils.extractVideoId(urlA);
    const idB = VideoUtils.extractVideoId(urlB);
    if (idA && idB) return idA === idB;
    return urlA === urlB;
  }

  /**
   * 将正在排队/执行的普通字幕任务切换为「仅获取字幕」。
   *
   * 典型场景：打开视频后自动流程已在下载字幕，用户此时右键悬浮球表示
   * 只想要字幕。复用该任务可避免重复下载/重复 ASR，同时保证后续不再生成导图。
   */
  async promoteToSubtitleOnly(videoUrl: string): Promise<Task | undefined> {
    const task = Array.from(this.tasks.values()).find(t =>
      t.type === 'download_subtitle' &&
      (t.status === 'pending' || t.status === 'running') &&
      t.data?.subtitleOnly !== true &&
      this.isSameVideo(t.data?.videoUrl, videoUrl)
    );
    if (!task) return undefined;

    task.data = { ...task.data, subtitleOnly: true };
    task.updatedAt = Date.now();
    await this.saveTasks();
    console.log('[TaskManager] 进行中的下载任务已切换为仅字幕模式:', task.id);
    return task;
  }

  /**
   * 查找同类正在排队/执行中的任务，避免重复点击时重复下载字幕或重复 ASR
   */
  private findActiveTask(videoUrl: string, type: Task['type'], subtitleOnly: boolean): Task | undefined {
    return Array.from(this.tasks.values()).find(task => {
      if (task.type !== type) return false;
      if (task.status !== 'pending' && task.status !== 'running') return false;
      if ((task.data?.subtitleOnly === true) !== subtitleOnly) return false;
      return this.isSameVideo(task.data?.videoUrl, videoUrl);
    });
  }

  /**
   * 创建下载字幕任务
   * @param subtitleOnly true = 仅获取字幕，不生成思维导图
   */
  async createDownloadTask(
    videoUrl: string,
    tabId?: number,
    force: boolean = false,
    subtitleOnly: boolean = false,
    videoTitle?: string
  ): Promise<Task> {
    const runningTask = this.findActiveTask(videoUrl, 'download_subtitle', subtitleOnly);
    if (runningTask) {
      console.log('[TaskManager] 复用进行中的字幕任务:', runningTask.id);
      return runningTask;
    }

    const task: Task = {
      id: uuidv4(),
      type: 'download_subtitle',
      status: 'pending',
      data: { videoUrl, force, subtitleOnly, videoTitle },
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
    // 同一视频已有排队/执行中的导图任务时直接复用，避免连点或自动/手动流程叠加
    if (force !== true) {
      const activeTask = Array.from(this.tasks.values()).find(t =>
        t.type === 'generate_mindmap' &&
        (t.status === 'pending' || t.status === 'running') &&
        this.isSameVideo(t.data?.videoUrl, videoUrl)
      );
      if (activeTask) {
        console.log('[TaskManager] 复用进行中的导图任务:', activeTask.id);
        return activeTask;
      }
    }

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

    // 异步缓存原始字幕，保障即使 LLM 调用失败也能通过视频 ID 检索到字幕原文本
    const videoId = VideoUtils.extractVideoId(videoUrl);
    if (videoId && subtitleText) {
      StorageService.saveSubtitleCache(videoId, subtitleText).catch(err => {
        console.warn('[TaskManager] Failed to save subtitle cache:', err);
      });
    }

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

      // 记录失败统计
      if (task.type === 'generate_mindmap') {
        const videoUrl = task.data.videoUrl;
        const videoId = VideoUtils.extractVideoId(videoUrl);
        const config = await StorageService.getConfig();
        const selectedId = config?.selectedLLMConfigId || 'default';
        await StatsService.recordGeneration({
          videoId,
          modelId: selectedId,
          isReflectionEnabled: config?.settings.enableReflection || false,
          isSuccess: false
        });
      }
      
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
   *
   * 常规模式：获取字幕后自动创建思维导图任务；
   * 仅字幕模式（subtitleOnly）：只缓存并交付字幕，绝不触发 LLM。
   */
  private async executeDownloadTask(task: Task) {
    const { videoUrl, subtitleOnly } = task.data;
    const videoId = VideoUtils.extractVideoId(videoUrl);

    // 仅字幕模式优先复用已有字幕缓存，避免重复下载/重复 ASR
    if (subtitleOnly && videoId && task.data.force !== true) {
      task.statusMessage = '正在检索已缓存的字幕...';
      task.updatedAt = Date.now();
      await this.saveTasks();

      const subtitleCache = await StorageService.getSubtitleCache(videoId);
      const asrCache = subtitleCache ? null : await StorageService.getAsrCache(videoId);
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

    // YouTube 视频：Service Worker 中无法直接拿到字幕，需通过 content script 代理获取
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      console.log('[TaskManager] YouTube video detected, delegating to content script for subtitle.');
      await this.executeYouTubeDownloadTask(task, videoUrl);
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
      task.data.force === true,
      task.tabId
    );

    // 读取任务数据而不是启动时的快照：右键可能已把进行中的普通下载任务切换为仅字幕模式
    if (task.data.subtitleOnly === true) {
      await this.finishSubtitleOnlyTask(task, { ...result, fromCache: false });
      return;
    }

    task.result = result;
    task.statusMessage = '字幕获取成功，即将开始生成思维导图';

    // 下载完成后，自动创建生成思维导图任务
    await this.createMindmapTask(videoUrl, result.subtitleText, result.videoTitle, task.tabId);
  }

  /**
   * 执行 YouTube 字幕获取任务（通过 content script 代理）
   * YouTube 字幕只能在页面上下文中读取，故由 background 向对应标签页发送
   * FETCH_YOUTUBE_SUBTITLE 消息，content script 利用已缓存的字幕轨道/拦截到的
   * 字幕请求主动获取并解析，返回带时间戳的纯文本后再走标准思维导图生成流程。
   *
   * 若该视频没有可用字幕（无 CC 字幕），则回退到 ASR 语音识别流程：
   *   1. 通过 FETCH_YOUTUBE_AUDIO_URL 获取音频流地址
   *   2. 调用 SubtitleService.runAsrFlow 下载并识别
   * 这与 B 站“无字幕 → 下载音频 → ASR”的流程保持一致。
   */
  private async executeYouTubeDownloadTask(task: Task, videoUrl: string) {
    const tabId = task.tabId;
    if (!tabId) {
      throw new Error('YouTube 字幕获取失败：缺少标签页上下文。请刷新视频页面后再次点击悬浮球。');
    }

    const videoId = VideoUtils.extractVideoId(videoUrl);
    let videoTitle = 'YouTube 视频';
    let subtitleText: string | null = null;
    let isAsr = false;

    // === 阶段 1：尝试获取 CC 字幕 ===
    task.statusMessage = '正在通过页面上下文获取 YouTube 字幕...';
    task.updatedAt = Date.now();
    await this.saveTasks();

    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'FETCH_YOUTUBE_SUBTITLE' });
      if (resp?.subtitleText && String(resp.subtitleText).trim()) {
        subtitleText = String(resp.subtitleText);
      }
      if (resp?.videoTitle) videoTitle = resp.videoTitle;
    } catch (e: any) {
      console.warn('[TaskManager] FETCH_YOUTUBE_SUBTITLE 失败，将尝试 ASR 回退:', e?.message || e);
    }

    // === 阶段 2：无 CC 字幕，回退 ASR 语音识别 ===
    if (!subtitleText) {
      const config = await StorageService.getConfig();
      if (!config) throw new Error('配置未初始化');

      task.statusMessage = '未检测到 YouTube 字幕，准备下载音频进行语音识别...';
      task.updatedAt = Date.now();
      await this.saveTasks();

      // 2.1 获取音频流地址
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

      // 2.2 调用通用 ASR 流程（复用 B 站的锁、缓存、transcribe 逻辑）
      const asrResult = await SubtitleService.runAsrFlow({
        audioUrl,
        videoId: videoId || videoUrl,
        videoTitle,
        videoUrl,
        config,
        onProgress: async (msg) => {
          task.statusMessage = msg;
          task.updatedAt = Date.now();
          await this.saveTasks();
        },
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
      await this.finishSubtitleOnlyTask(task, {
        videoUrl,
        videoTitle,
        subtitleText,
        isAsr,
        fromCache: false
      });
      return;
    }

    // 缓存字幕，保障 LLM 失败后也能通过 GET_SUBTITLE_CACHE 取回字幕原文本
    if (videoId) {
      StorageService.saveSubtitleCache(videoId, subtitleText).catch(err => {
        console.warn('[TaskManager] Failed to save YouTube subtitle cache:', err);
      });
    }

    task.result = { videoUrl, videoTitle, subtitleText, isAsr };
    task.statusMessage = '字幕获取成功，即将开始生成思维导图';
    await this.saveTasks();

    // 与 B 站流程保持一致：获取到字幕后自动创建生成思维导图任务
    await this.createMindmapTask(videoUrl, subtitleText, videoTitle, task.tabId);
  }

  /**
   * 收尾「仅获取字幕」任务：缓存字幕、按需落盘、通知 content script。
   * 该流程不创建 generate_mindmap 任务，因此不会消耗任何 LLM 调用。
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
    const videoId = VideoUtils.extractVideoId(videoUrl);

    if (videoId) {
      StorageService.saveSubtitleCache(videoId, subtitleText).catch(err => {
        console.warn('[TaskManager] Failed to save subtitle-only cache:', err);
      });
    }

    // 用户开启了「本地文件缓存」时，仅字幕模式也直接把 .txt 落到下载目录。
    // 缓存命中的场景不重复落盘，避免反复右键产生重复文件。
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
    await this.saveTasks();

    await this.notifySubtitleReady(task);
  }

  /**
   * 通知发起任务的标签页：仅字幕结果已就绪
   */
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
    const { result: mindmapMarkdown, initialResult: initialMindmapMarkdown, reflectionSuccess } = await LLMService.generateMindmap(
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
      },
      cachedInitialMindmap,
      task.id
    );

    // 记录成功统计
    await StatsService.recordGeneration({
      videoId,
      modelId: selectedId,
      isReflectionEnabled: config.settings.enableReflection,
      reflectionSuccess,
      isSuccess: true
    });

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

  getCurrentTask(videoUrl?: string): Task | undefined {
    const allTasks = Array.from(this.tasks.values());
    
    // 1. 如果指定了 videoUrl，优先返回与该 URL 匹配的任务
    if (videoUrl) {
      const matchUrl = (t: Task) => {
        const taskUrl = t.data?.videoUrl;
        if (!taskUrl) return false;
        
        // 尝试提取 ID 匹配
        const id1 = VideoUtils.extractVideoId(videoUrl);
        const id2 = VideoUtils.extractVideoId(taskUrl);
        if (id1 && id2) return id1 === id2;
        
        // 否则 fallback 到字符串包含判断（处理一些非标准 URL）
        return videoUrl.includes(taskUrl) || taskUrl.includes(videoUrl);
      };

      // 优先返回匹配的正在运行的任务
      const runningTask = allTasks.find(t => t.status === 'running' && matchUrl(t));
      if (runningTask) return runningTask;

      // 否则返回匹配的等待中的任务
      const pendingTask = allTasks
        .filter(t => t.status === 'pending' && matchUrl(t))
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (pendingTask) return pendingTask;

      // 最后返回匹配的最近完成任务或失败任务
      const now = Date.now();
      const recentTask = allTasks
        .filter(t => {
          if (!matchUrl(t)) return false;
          const timeDiff = now - (t.updatedAt || 0);
          if (t.status === 'completed') return timeDiff < 30000;
          if (t.status === 'failed') return timeDiff < 3600000; // 失败任务保留 1 小时，确保用户能复制已提取的字幕
          return false;
        })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      if (recentTask) return recentTask;
    }

    // 2. 如果没提供 videoUrl 或没找到匹配，回退到全局逻辑
    
    // 优先返回正在运行的任务
    const runningTask = allTasks.find(t => t.status === 'running');
    if (runningTask) return runningTask;

    // 否则返回最早等待的任务
    const pendingTasks = allTasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);

    if (pendingTasks.length > 0) return pendingTasks[0];

    // 最后返回最近完成或失败的任务
    const now = Date.now();
    const recentCompletedTask = allTasks
      .filter(t => {
        const timeDiff = now - (t.updatedAt || 0);
        if (t.status === 'completed') return timeDiff < 30000;
        if (t.status === 'failed') return timeDiff < 3600000;
        return false;
      })
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