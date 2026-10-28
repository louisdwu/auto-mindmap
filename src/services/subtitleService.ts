import { PluginConfig, normalizeAsrLanguage } from '../types/config';
import { VideoUtils } from '../utils/videoUtils';
import { AudioService } from './audioService';
import { LLMService } from './llmService';
import { StorageService } from './storageService';
import { createAbortError, throwIfAborted } from '../utils/abort';

export interface SubtitleInfo {
  id: string;
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

export class SubtitleService {
  /**
   * 获取视频信息
   */
  static async getVideoInfo(videoId: string, page: number = 1, signal?: AbortSignal): Promise<{
    aid: number;
    bvid: string;
    cid: number;
    title: string;
    author: string;
    page: number;
    isPaid?: boolean;
    payMessage?: string;
  }> {
    const isBvid = videoId.startsWith('BV');
    const param = isBvid ? `bvid=${videoId}` : `aid=${videoId.replace('av', '')}`;
    
    const response = await fetch(
      `https://api.bilibili.com/x/web-interface/view?${param}`,
      { credentials: 'include', signal }
    );
    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(data.message || '获取视频信息失败');
    }

    const isPaid = data.data?.is_upower_exclusive || data.data?.is_ugc_pay_preview || false;
    const payMessage = data.data?.preview_toast || '该视频为付费/充电专属内容，请先获取观看权限。';

    // 分 P 视频：cid 与标题都必须取当前 P，否则会拿 P1 的字幕/音频生成 P2 的导图。
    // pages 缺失（旧接口/特殊稿件）时回退到顶层 cid，保持原有单 P 行为。
    const pages = Array.isArray(data.data?.pages) ? data.data.pages : [];
    const safePage = Math.min(Math.max(1, page), Math.max(1, pages.length));
    const pageInfo = pages[safePage - 1];
    const cid = pageInfo?.cid ?? data.data.cid;
    const baseTitle = data.data.title || '';
    const pageTitle = pageInfo?.part ? String(pageInfo.part).trim() : '';
    const title = pages.length > 1 && pageTitle
      ? `${baseTitle} - P${safePage} ${pageTitle}`
      : baseTitle;
    
    return {
      aid: data.data.aid,
      bvid: data.data.bvid,
      cid,
      title,
      author: data.data.owner.name,
      page: safePage,
      isPaid,
      payMessage
    };
  }

  static async getSubtitleList(bvid: string, cid: number, signal?: AbortSignal): Promise<SubtitleInfo[]> {
    // 策略 1：带 WBI 签名请求（需要登录态 cookie，可能在 Service Worker 中不可用）
    try {
      const keys = await AudioService.getWbiKeys(signal);
      const params = { bvid, cid };
      const signedQuery = await AudioService.encWbi(params, keys);
      
      const response = await fetch(
        `https://api.bilibili.com/x/player/wbi/v2?${signedQuery}`,
        { credentials: 'include', signal }
      );
      const data = await response.json();
      if (data.code === 0) {
        const subtitles = data.data?.subtitle?.subtitles || [];
        if (subtitles.length > 0) {
          console.log('[SubtitleService] WBI 签名请求成功，找到字幕:', subtitles.length);
          return subtitles;
        }
      }
    } catch (e: any) {
      if (signal?.aborted || e?.name === 'AbortError') throw createAbortError();
      console.warn('[SubtitleService] WBI 签名请求失败，回退到无签名请求:', e);
    }

    // 策略 2：不带签名的普通请求（兼容 Service Worker 无 cookie 场景）
    try {
      const response = await fetch(
        `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`,
        { credentials: 'include', signal }
      );
      const data = await response.json();
      if (data.code === 0) {
        const subtitles = data.data?.subtitle?.subtitles || [];
        console.log('[SubtitleService] 无签名请求结果，字幕数量:', subtitles.length);
        return subtitles;
      }
    } catch (e: any) {
      if (signal?.aborted || e?.name === 'AbortError') throw createAbortError();
      console.warn('[SubtitleService] 无签名请求也失败:', e);
    }

    // 策略 3：使用 aid 参数重试（某些旧接口可能需要 aid）
    try {
      const viewRes = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        { credentials: 'include', signal }
      );
      const viewData = await viewRes.json();
      const aid = viewData.data?.aid;
      if (aid) {
        const response = await fetch(
          `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`,
          { credentials: 'include', signal }
        );
        const data = await response.json();
        if (data.code === 0) {
          const subtitles = data.data?.subtitle?.subtitles || [];
          console.log('[SubtitleService] aid 请求结果，字幕数量:', subtitles.length);
          return subtitles;
        }
      }
    } catch (e: any) {
      if (signal?.aborted || e?.name === 'AbortError') throw createAbortError();
      console.warn('[SubtitleService] aid 请求也失败:', e);
    }

    console.log('[SubtitleService] 所有字幕获取策略均未返回结果');
    return [];
  }

  /**
   * 筛选中文字幕
   */
  static filterChineseSubtitles(subtitles: SubtitleInfo[]): SubtitleInfo[] {
    return subtitles.filter(sub => {
      const lang = (sub.lan || sub.lan_doc || '').toLowerCase();
      // B站字幕代码可能是 zh-Hans, zh-CN, ai-zh, zh-Hant 等
      return lang.includes('zh') || lang.includes('cn');
    });
  }

  /**
   * 下载字幕内容
   */
  static async downloadSubtitle(subtitleUrl: string, signal?: AbortSignal): Promise<any> {
    if (subtitleUrl.startsWith('//')) subtitleUrl = 'https:' + subtitleUrl;
    const response = await fetch(subtitleUrl, { signal });
    return await response.json();
  }

  /**
   * 提取带时间戳的字幕文本
   * 格式: [mm:ss] 字幕内容
   */
  static extractPlainText(subtitleData: any): string {
    if (!subtitleData.body || !Array.isArray(subtitleData.body)) return '';
    return subtitleData.body
      .filter((item: any) => item.content && item.content.trim())
      .map((item: any) => {
        const timeStr = VideoUtils.formatSecondsToTimestamp(Number(item.from) || 0);
        return `[${timeStr}] ${item.content.trim()}`;
      })
      .join('\n');
  }

  /**
   * 完整的字幕获取流程
   */
  static async downloadChineseSubtitle(
    videoUrl: string, 
    config: PluginConfig,
    onProgress?: (task: string) => void,
    forceMode: boolean = false,
    tabId?: number,
    forceAsr: boolean = false,
    signal?: AbortSignal
  ): Promise<{
    videoUrl: string;
    videoTitle: string;
    subtitleText: string;
    isAsr?: boolean;
  }> {
     throwIfAborted(signal);
     if (videoUrl.includes('youtube.com')) {
      throw new Error('YouTube 字幕请等待视频播放自动获取');
    }

    const media = VideoUtils.parseMediaRef(videoUrl);
    const videoId = media?.videoId || VideoUtils.extractVideoId(videoUrl);
    if (!videoId) throw new Error('无法从URL中提取视频ID');
    // cacheId 区分 B 站分 P：P1 仍是裸 BV 号，旧缓存继续有效；P2+ 使用 BV..._p2。
    const cacheId = media?.cacheId || videoId;
    const page = media?.page || 1;

    console.log('[SubtitleService] ===== 开始字幕获取流程 =====');
    console.log('[SubtitleService] videoUrl:', videoUrl);
    console.log('[SubtitleService] videoId:', videoId, 'page:', page, 'cacheId:', cacheId);

    onProgress?.(page > 1 ? `正在获取视频信息（P${page}）...` : '正在获取视频信息...');
    const videoInfo = await this.getVideoInfo(videoId, page, signal);
    console.log('[SubtitleService] videoInfo:', JSON.stringify(videoInfo));

    // 用户点了「重新语音识别」：官方字幕一律不用（哪怕存在），
    // 直接对音频重新做 ASR —— 这正是「字幕不准想换一份」的场景。
    if (forceAsr) {
      console.log('[SubtitleService] forceAsr=true，跳过官方字幕策略，直接语音识别');
      onProgress?.('已选择「重新语音识别」，跳过官方字幕，直接进行语音识别...');
      return this.handleAsrFlow(videoInfo, config, onProgress, true, videoUrl, tabId, cacheId, signal);
    }

    // 优先尝试官方字幕
    onProgress?.('正在检查官方字幕...');
    const subtitles = await this.getSubtitleList(videoInfo.bvid, videoInfo.cid, signal);
    console.log('[SubtitleService] 找到的官方字幕列表:', JSON.stringify(subtitles));
    
    if (subtitles && subtitles.length > 0) {
      let selectedSubtitle = this.filterChineseSubtitles(subtitles)[0];
      
      // 如果没有明确标明是中文的字幕，就无脑取第一个（大模型可以直接处理英文/日文字幕并生成中文导图）
      if (!selectedSubtitle) {
        console.log('[SubtitleService] 未匹配到中文字幕，使用第一个字幕:', JSON.stringify(subtitles[0]));
        onProgress?.('未检测到明确的中文字幕，将使用默认字幕...');
        selectedSubtitle = subtitles[0];
      } else {
        console.log('[SubtitleService] 匹配到中文字幕:', JSON.stringify(selectedSubtitle));
        onProgress?.('正在下载官方中文字幕...');
      }

      const subtitleData = await this.downloadSubtitle(selectedSubtitle.subtitle_url, signal);
      const subtitleText = this.extractPlainText(subtitleData);
      console.log('[SubtitleService] 字幕文本长度:', subtitleText?.length || 0);
      
      if (subtitleText?.trim()) {
        console.log('[SubtitleService] ===== 字幕获取成功（官方字幕）=====');
        await StorageService.saveSubtitleCache(cacheId, subtitleText);
        return { videoUrl, videoTitle: videoInfo.title, subtitleText, isAsr: false };
      }
    }

    // 策略 4：通过 content script 在页面上下文中获取（利用用户登录 cookie）
    if (tabId) {
      console.log('[SubtitleService] 后台策略全部失败，尝试通过 content script 获取字幕...');
      onProgress?.('正在通过页面上下文获取字幕（需要登录态）...');
      try {
        throwIfAborted(signal);
        const csResponse = await chrome.tabs.sendMessage(tabId, {
          type: 'FETCH_SUBTITLES',
          payload: { bvid: videoInfo.bvid, cid: videoInfo.cid }
        });
        throwIfAborted(signal);
        console.log('[SubtitleService] content script 返回:', JSON.stringify(csResponse));
        const csSubtitles = csResponse?.subtitles || [];
        if (csSubtitles.length > 0) {
          let selectedSubtitle = this.filterChineseSubtitles(csSubtitles)[0] || csSubtitles[0];
          console.log('[SubtitleService] content script 选中字幕:', JSON.stringify(selectedSubtitle));
          onProgress?.('正在下载字幕内容...');
          const subtitleData = await this.downloadSubtitle(selectedSubtitle.subtitle_url, signal);
          const subtitleText = this.extractPlainText(subtitleData);
          if (subtitleText?.trim()) {
            console.log('[SubtitleService] ===== 字幕获取成功（content script 代理）=====');
            await StorageService.saveSubtitleCache(cacheId, subtitleText);
            return { videoUrl, videoTitle: videoInfo.title, subtitleText, isAsr: false };
          }
        }
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') throw createAbortError();
        console.warn('[SubtitleService] content script 字幕获取失败:', e);
      }
    }

    console.log('[SubtitleService] ===== 没有可用的官方字幕，进入 ASR 流程 =====');
    
    // 如果是付费视频且走到了这一步，说明确实没法拿到字幕
    if (videoInfo.isPaid) {
      throw new Error(`无法获取字幕：${videoInfo.payMessage} (付费/充电视频暂不支持直接抓取字幕)`);
    }

    // 回退到 ASR (只有在完全没有任何字幕时才执行)
    onProgress?.('未检测到任何官方字幕，尝试进行语音识别...');
    return this.handleAsrFlow(videoInfo, config, onProgress, forceMode, videoUrl, tabId, cacheId, signal);
  }

  private static asrLock: Promise<void> = Promise.resolve();

  /**
   * 获取 ASR 锁
   */
  private static async acquireAsrLock(
    onProgress?: (msg: string) => void,
    signal?: AbortSignal
  ): Promise<() => void> {
    let release: () => void;
    const waitPromise = new Promise<void>(resolve => { release = resolve; });

    const previousLock = this.asrLock;
    // 更新锁为下一个等待者
    this.asrLock = this.asrLock.then(() => waitPromise);

    // 如果 200ms 还没获取到锁，说明正在排队
    const queueTimeout = setTimeout(() => {
      onProgress?.('ASR 资源忙，正在进入队列排队...');
    }, 200);

    try {
      if (signal?.aborted) throw createAbortError();
      if (signal) {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            signal.removeEventListener('abort', onAbort);
            clearTimeout(queueTimeout);
          };
          const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(createAbortError());
          };
          signal.addEventListener('abort', onAbort, { once: true });
          previousLock.then(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          }, (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          });
        });
      } else {
        await previousLock;
        clearTimeout(queueTimeout);
      }
    } catch (error) {
      clearTimeout(queueTimeout);
      // 已经排入 asrLock 链，取消时必须释放，否则后续任务会永久等待
      release!();
      throw error;
    }

    return release!;
  }

  /**
   * 处理 ASR 语音识别流程（B 站）
   * 获取 B 站音频流地址后，委托给通用的 runAsrFlow
   */
  private static async handleAsrFlow(
    videoInfo: any,
    config: PluginConfig,
    onProgress: any,
    forceMode: boolean,
    videoUrl: string,
    tabId: number | undefined,
    cacheId: string,
    signal?: AbortSignal
  ): Promise<any> {
    const getTime = () => `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`;
    onProgress?.(`${getTime()} 正在获取音频流地址...`);
    throwIfAborted(signal);
    const audioUrl = await AudioService.getAudioUrl(videoInfo.bvid, videoInfo.cid, signal);
    return this.runAsrFlow({
      audioUrl,
      videoId: cacheId,
      videoTitle: videoInfo.title,
      videoUrl,
      config,
      onProgress,
      forceMode,
      tabId,
      signal
    });
  }

  /**
   * 通用 ASR 语音识别流程（B 站与 YouTube 共用）
   * 给定音频流地址，按本地/远程 provider 下载并识别，结果带时间戳并缓存。
   * YouTube 无字幕时由 TaskManager 调用本方法回退到语音识别。
   */
  static async runAsrFlow(opts: {
    audioUrl: string;
    videoId: string;
    videoTitle: string;
    videoUrl: string;
    config: PluginConfig;
    onProgress?: (msg: string) => void;
    forceMode?: boolean;
    tabId?: number;
    signal?: AbortSignal;
  }): Promise<{ videoUrl: string; videoTitle: string; subtitleText: string; isAsr: true }> {
    const { audioUrl, videoId, videoTitle, videoUrl, config, onProgress, forceMode, tabId, signal } = opts;
    throwIfAborted(signal);
    const getTime = () => `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`;
    // 识别语言：'auto' 表示让引擎自动检测源语言（输出原语言原文）。
    // 缓存也按语言分档，切换语言不会命中另一种语言的旧结果。
    const asrLanguage = normalizeAsrLanguage(config.settings.asrLanguage);
    // 强制模式（重新语音识别）必须让服务端跳过字幕文本缓存，否则同一视频会瞬发旧文本
    const asrOptions = { videoId, noCache: forceMode === true, signal };
    const unlock = await this.acquireAsrLock(onProgress, signal);

    try {
      if (!forceMode) {
        onProgress?.(`${getTime()} 正在检索本地 ASR 缓存...`);
        const cachedText = await StorageService.getAsrCache(videoId, asrLanguage);
        if (cachedText && /\[\d{1,2}:\d{2}/.test(cachedText)) {
          return { videoUrl, videoTitle, subtitleText: cachedText, isAsr: true };
        } else if (cachedText) {
          console.log('[SubtitleService] 发现旧版无时间戳 ASR 缓存，自动作废并重新识别');
          await StorageService.deleteAsrCache(videoId);
        }
        throwIfAborted(signal);
      }

      const isLocal = config.settings.asrProvider === 'local';

      // 构建识别参数描述
      const beamSize = config.settings.asrBeamSize || 2;
      const vad = config.settings.asrVadFilter !== false;
      const paramsDesc = `(beam_size=${beamSize}, vad_filter=${vad}, language=${asrLanguage})`;

      let text = '';

      if (isLocal) {
        onProgress?.(`${getTime()} 准备通过本地服务器识别... ${paramsDesc}`);
        try {
          text = await LLMService.transcribeAudio(config, audioUrl, asrOptions, (msg) => {
             onProgress?.(msg);
          });
        } catch (e: any) {
          console.warn('本地 ASR 通过 URL 识别失败，尝试下载音频后识别:', e);
          onProgress?.(`${getTime()} URL 识别受阻，正在下载音频文件...`);
          const audioBlob = await AudioService.downloadAudioWithFallback(audioUrl, tabId, (msg) => {
            onProgress?.(`${getTime()} ${msg}`);
          }, signal);
          const sizeMB = (audioBlob.size / 1024 / 1024).toFixed(2);
          onProgress?.(`${getTime()} 音频准备完成，大小: ${sizeMB} MB`);
          throwIfAborted(signal);
          text = await LLMService.transcribeAudio(config, audioBlob, asrOptions, (msg) => {
            onProgress?.(msg);
          });
        }
      } else {
        onProgress?.(`${getTime()} 正在下载音频文件...`);
        const audioBlob = await AudioService.downloadAudioWithFallback(audioUrl, tabId, (msg) => {
          onProgress?.(`${getTime()} ${msg}`);
        }, signal);
        const sizeMB = (audioBlob.size / 1024 / 1024).toFixed(2);
        onProgress?.(`${getTime()} 音频下载完成 (${sizeMB} MB)，正在调用远程识别...`);
        throwIfAborted(signal);
        text = await LLMService.transcribeAudio(config, audioBlob, asrOptions, (msg) => {
          onProgress?.(msg);
        });
      }

      throwIfAborted(signal);
      if (text?.trim()) {
        await StorageService.saveAsrCache(videoId, text, asrLanguage);
        await StorageService.saveSubtitleCache(videoId, text);
        return { videoUrl, videoTitle, subtitleText: text, isAsr: true };
      }
      throw new Error('语音识别返回内容为空');
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      throw new Error(`语音识别失败: ${e.message || e}`);
    } finally {
      unlock();
    }
  }
}