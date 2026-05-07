import { PluginConfig } from '../types/config';
import { VideoUtils } from '../utils/videoUtils';
import { AudioService } from './audioService';
import { LLMService } from './llmService';
import { StorageService } from './storageService';

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
  static async getVideoInfo(videoId: string): Promise<{
    aid: number;
    bvid: string;
    cid: number;
    title: string;
    author: string;
    isPaid?: boolean;
    payMessage?: string;
  }> {
    const isBvid = videoId.startsWith('BV');
    const param = isBvid ? `bvid=${videoId}` : `aid=${videoId.replace('av', '')}`;
    
    const response = await fetch(
      `https://api.bilibili.com/x/web-interface/view?${param}`,
      { credentials: 'include' }
    );
    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(data.message || '获取视频信息失败');
    }

    const isPaid = data.data?.is_upower_exclusive || data.data?.is_ugc_pay_preview || false;
    const payMessage = data.data?.preview_toast || '该视频为付费/充电专属内容，请先获取观看权限。';
    
    return {
      aid: data.data.aid,
      bvid: data.data.bvid,
      cid: data.data.cid,
      title: data.data.title,
      author: data.data.owner.name,
      isPaid,
      payMessage
    };
  }

  static async getSubtitleList(bvid: string, cid: number): Promise<SubtitleInfo[]> {
    // 策略 1：带 WBI 签名请求（需要登录态 cookie，可能在 Service Worker 中不可用）
    try {
      const keys = await AudioService.getWbiKeys();
      const params = { bvid, cid };
      const signedQuery = await AudioService.encWbi(params, keys);
      
      const response = await fetch(
        `https://api.bilibili.com/x/player/wbi/v2?${signedQuery}`,
        { credentials: 'include' }
      );
      const data = await response.json();
      if (data.code === 0) {
        const subtitles = data.data?.subtitle?.subtitles || [];
        if (subtitles.length > 0) {
          console.log('[SubtitleService] WBI 签名请求成功，找到字幕:', subtitles.length);
          return subtitles;
        }
      }
    } catch (e) {
      console.warn('[SubtitleService] WBI 签名请求失败，回退到无签名请求:', e);
    }

    // 策略 2：不带签名的普通请求（兼容 Service Worker 无 cookie 场景）
    try {
      const response = await fetch(
        `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`,
        { credentials: 'include' }
      );
      const data = await response.json();
      if (data.code === 0) {
        const subtitles = data.data?.subtitle?.subtitles || [];
        console.log('[SubtitleService] 无签名请求结果，字幕数量:', subtitles.length);
        return subtitles;
      }
    } catch (e) {
      console.warn('[SubtitleService] 无签名请求也失败:', e);
    }

    // 策略 3：使用 aid 参数重试（某些旧接口可能需要 aid）
    try {
      const viewRes = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        { credentials: 'include' }
      );
      const viewData = await viewRes.json();
      const aid = viewData.data?.aid;
      if (aid) {
        const response = await fetch(
          `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`,
          { credentials: 'include' }
        );
        const data = await response.json();
        if (data.code === 0) {
          const subtitles = data.data?.subtitle?.subtitles || [];
          console.log('[SubtitleService] aid 请求结果，字幕数量:', subtitles.length);
          return subtitles;
        }
      }
    } catch (e) {
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
  static async downloadSubtitle(subtitleUrl: string): Promise<any> {
    if (subtitleUrl.startsWith('//')) subtitleUrl = 'https:' + subtitleUrl;
    const response = await fetch(subtitleUrl);
    return await response.json();
  }

  /**
   * 提取纯文本字幕
   */
  static extractPlainText(subtitleData: any): string {
    if (!subtitleData.body || !Array.isArray(subtitleData.body)) return '';
    return subtitleData.body
      .map((item: any) => item.content)
      .filter((content: string) => content && content.trim())
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
    tabId?: number
  ): Promise<{
    videoUrl: string;
    videoTitle: string;
    subtitleText: string;
    isAsr?: boolean;
  }> {
     if (videoUrl.includes('youtube.com')) {
      throw new Error('YouTube 字幕请等待视频播放自动获取');
    }

    const videoId = VideoUtils.extractVideoId(videoUrl);
    if (!videoId) throw new Error('无法从URL中提取视频ID');

    console.log('[SubtitleService] ===== 开始字幕获取流程 =====');
    console.log('[SubtitleService] videoUrl:', videoUrl);
    console.log('[SubtitleService] videoId:', videoId);

    onProgress?.('正在获取视频信息...');
    const videoInfo = await this.getVideoInfo(videoId);
    console.log('[SubtitleService] videoInfo:', JSON.stringify(videoInfo));

    // 优先尝试官方字幕
    onProgress?.('正在检查官方字幕...');
    const subtitles = await this.getSubtitleList(videoInfo.bvid, videoInfo.cid);
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

      const subtitleData = await this.downloadSubtitle(selectedSubtitle.subtitle_url);
      const subtitleText = this.extractPlainText(subtitleData);
      console.log('[SubtitleService] 字幕文本长度:', subtitleText?.length || 0);
      
      if (subtitleText?.trim()) {
        console.log('[SubtitleService] ===== 字幕获取成功（官方字幕）=====');
        return { videoUrl, videoTitle: videoInfo.title, subtitleText, isAsr: false };
      }
    }

    // 策略 4：通过 content script 在页面上下文中获取（利用用户登录 cookie）
    if (tabId) {
      console.log('[SubtitleService] 后台策略全部失败，尝试通过 content script 获取字幕...');
      onProgress?.('正在通过页面上下文获取字幕（需要登录态）...');
      try {
        const csResponse = await chrome.tabs.sendMessage(tabId, {
          type: 'FETCH_SUBTITLES',
          payload: { bvid: videoInfo.bvid, cid: videoInfo.cid }
        });
        console.log('[SubtitleService] content script 返回:', JSON.stringify(csResponse));
        const csSubtitles = csResponse?.subtitles || [];
        if (csSubtitles.length > 0) {
          let selectedSubtitle = this.filterChineseSubtitles(csSubtitles)[0] || csSubtitles[0];
          console.log('[SubtitleService] content script 选中字幕:', JSON.stringify(selectedSubtitle));
          onProgress?.('正在下载字幕内容...');
          const subtitleData = await this.downloadSubtitle(selectedSubtitle.subtitle_url);
          const subtitleText = this.extractPlainText(subtitleData);
          if (subtitleText?.trim()) {
            console.log('[SubtitleService] ===== 字幕获取成功（content script 代理）=====');
            return { videoUrl, videoTitle: videoInfo.title, subtitleText, isAsr: false };
          }
        }
      } catch (e) {
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
    return this.handleAsrFlow(videoInfo, config, onProgress, forceMode, videoUrl);
  }

  private static asrLock: Promise<void> = Promise.resolve();

  /**
   * 获取 ASR 锁
   */
  private static async acquireAsrLock(onProgress?: (msg: string) => void): Promise<() => void> {
    let release: () => void;
    const waitPromise = new Promise<void>(resolve => { release = resolve; });

    const previousLock = this.asrLock;
    // 更新锁为下一个等待者
    this.asrLock = this.asrLock.then(() => waitPromise);

    // 如果 200ms 还没获取到锁，说明正在排队
    const queueTimeout = setTimeout(() => {
      onProgress?.('ASR 资源忙，正在进入队列排队...');
    }, 200);

    await previousLock;
    clearTimeout(queueTimeout);

    return release!;
  }

  /**
   * 处理 ASR 语音识别流程
   */
  private static async handleAsrFlow(
    videoInfo: any,
    config: PluginConfig,
    onProgress: any,
    forceMode: boolean,
    videoUrl: string
  ): Promise<any> {
    const getTime = () => `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`;
    const unlock = await this.acquireAsrLock(onProgress);
    
    try {
      onProgress?.(`${getTime()} 正在获取音频流地址...`);
      const audioUrl = await AudioService.getAudioUrl(videoInfo.bvid, videoInfo.cid);
      
      if (!forceMode) {
        onProgress?.(`${getTime()} 正在检索本地 ASR 缓存...`);
        const cachedText = await StorageService.getAsrCache(videoInfo.bvid);
        if (cachedText) return { videoUrl, videoTitle: videoInfo.title, subtitleText: cachedText, isAsr: true };
      }

      const isLocal = config.settings.asrProvider === 'local';
      
      // 构建识别参数描述
      const beamSize = config.settings.asrBeamSize || 2;
      const vad = config.settings.asrVadFilter !== false;
      const lang = config.settings.language || 'auto';
      const paramsDesc = `(beam_size=${beamSize}, vad_filter=${vad}, language=${lang})`;

      let text = '';

      if (isLocal) {
        onProgress?.(`${getTime()} 准备通过本地服务器识别... ${paramsDesc}`);
        try {
          text = await LLMService.transcribeAudio(config, audioUrl, { videoId: videoInfo.bvid }, (msg) => {
             onProgress?.(msg);
          });
        } catch (e: any) {
          console.warn('本地 ASR 通过 URL 识别失败，尝试下载音频后识别:', e);
          onProgress?.(`${getTime()} URL 识别受阻，正在下载音频文件...`);
          const audioBlob = await AudioService.downloadAudioBlob(audioUrl);
          const sizeMB = (audioBlob.size / 1024 / 1024).toFixed(2);
          onProgress?.(`${getTime()} 音频准备完成，大小: ${sizeMB} MB`);
          text = await LLMService.transcribeAudio(config, audioBlob, { videoId: videoInfo.bvid }, (msg) => {
            onProgress?.(msg);
          });
        }
      } else {
        onProgress?.(`${getTime()} 正在下载音频文件...`);
        const audioBlob = await AudioService.downloadAudioBlob(audioUrl);
        const sizeMB = (audioBlob.size / 1024 / 1024).toFixed(2);
        onProgress?.(`${getTime()} 音频下载完成 (${sizeMB} MB)，正在调用远程识别...`);
        text = await LLMService.transcribeAudio(config, audioBlob, { videoId: videoInfo.bvid }, (msg) => {
          onProgress?.(msg);
        });
      }

      if (text?.trim()) {
        await StorageService.saveAsrCache(videoInfo.bvid, text);
        return { videoUrl, videoTitle: videoInfo.title, subtitleText: text, isAsr: true };
      }
      throw new Error('语音识别返回内容为空');
    } catch (e: any) {
      throw new Error(`语音识别失败: ${e.message || e}`);
    } finally {
      unlock();
    }
  }
}