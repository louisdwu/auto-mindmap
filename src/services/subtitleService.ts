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
    
    return {
      aid: data.data.aid,
      bvid: data.data.bvid,
      cid: data.data.cid,
      title: data.data.title,
      author: data.data.owner.name
    };
  }

  /**
   * 获取字幕列表
   */
  static async getSubtitleList(aid: number, cid: number): Promise<SubtitleInfo[]> {
    const response = await fetch(
      `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
      { credentials: 'include' }
    );
    const data = await response.json();
    if (data.code !== 0) throw new Error(data.message || '获取字幕列表失败');
    return data.data.subtitle.subtitles || [];
  }

  /**
   * 筛选中文字幕
   */
  static filterChineseSubtitles(subtitles: SubtitleInfo[]): SubtitleInfo[] {
    return subtitles.filter(sub => {
      const lang = sub.lan || sub.lan_doc;
      return ['ai-zh', 'zh-CN', 'zh', 'cn'].includes(lang);
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
    forceMode: boolean = false
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

    onProgress?.('正在获取视频信息...');
    const videoInfo = await this.getVideoInfo(videoId);

    // 优先尝试官方字幕
    onProgress?.('正在检查官方字幕...');
    const subtitles = await this.getSubtitleList(videoInfo.aid, videoInfo.cid);
    const chineseSubtitles = this.filterChineseSubtitles(subtitles);
    
    if (chineseSubtitles.length > 0) {
      onProgress?.('正在下载官方中文字幕...');
      const subtitleData = await this.downloadSubtitle(chineseSubtitles[0].subtitle_url);
      const subtitleText = this.extractPlainText(subtitleData);
      if (subtitleText?.trim()) {
        return { videoUrl, videoTitle: videoInfo.title, subtitleText, isAsr: false };
      }
    }

    // 回退到 ASR
    onProgress?.('未检测到官方字幕，尝试进行语音识别...');
    return this.handleAsrFlow(videoInfo, config, onProgress, forceMode, videoUrl);
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
    try {
      const audioUrl = await AudioService.getAudioUrl(videoInfo.bvid, videoInfo.cid);
      
      if (!forceMode) {
        onProgress?.('正在检索本地 ASR 缓存...');
        const cachedText = await StorageService.getAsrCache(videoInfo.bvid);
        if (cachedText) return { videoUrl, videoTitle: videoInfo.title, subtitleText: cachedText, isAsr: true };
      }

      const isLocal = config.settings.asrProvider === 'local';
      let text = '';

      if (isLocal) {
        onProgress?.('正在通过本地服务器识别...');
        text = await LLMService.transcribeAudio(config, audioUrl, { videoId: videoInfo.bvid }, onProgress);
      } else {
        const audioBlob = await AudioService.downloadAudioBlob(audioUrl);
        text = await LLMService.transcribeAudio(config, audioBlob, { videoId: videoInfo.bvid }, onProgress);
      }

      if (text?.trim()) {
        await StorageService.saveAsrCache(videoInfo.bvid, text);
        return { videoUrl, videoTitle: videoInfo.title, subtitleText: text, isAsr: true };
      }
      throw new Error('语音识别返回内容为空');
    } catch (e: any) {
      throw new Error(`语音识别失败: ${e.message || e}`);
    }
  }
}