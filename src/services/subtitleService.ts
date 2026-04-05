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
    
    if (isBvid) {
      const response = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`,
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
    } else {
      const aid = parseInt(videoId.replace('av', ''));
      const response = await fetch(
        `https://api.bilibili.com/x/web-interface/view?aid=${aid}`,
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
    
    if (data.code !== 0) {
      throw new Error(data.message || '获取字幕列表失败');
    }
    
    return data.data.subtitle.subtitles || [];
  }

  /**
   * 筛选中文字幕
   */
  static filterChineseSubtitles(subtitles: SubtitleInfo[]): SubtitleInfo[] {
    return subtitles.filter(sub => {
      const lang = sub.lan || sub.lan_doc;
      return lang === 'ai-zh' || 
             lang === 'zh-CN' || 
             lang === 'zh' || 
             lang === 'cn';
    });
  }

  /**
   * 下载字幕内容
   */
  static async downloadSubtitle(subtitleUrl: string): Promise<any> {
    if (subtitleUrl.startsWith('//')) {
      subtitleUrl = 'https:' + subtitleUrl;
    }
    
    const response = await fetch(subtitleUrl);
    return await response.json();
  }

  /**
   * 提取纯文本字幕（去除时间轴）
   */
  static extractPlainText(subtitleData: any): string {
    if (!subtitleData.body || !Array.isArray(subtitleData.body)) {
      return '';
    }
    
    return subtitleData.body
      .map((item: any) => item.content)
      .filter((content: string) => content && content.trim())
      .join('\n');
  }

  /**
   * 完整的字幕获取流程（支持 Bilibili）
   * 增加 ASR 回退机制：如果没有字幕，则尝试语音识别
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

    // 1. 提取视频ID
    const videoId = VideoUtils.extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error('无法从URL中提取视频ID');
    }

    // 2. 获取视频信息
    onProgress?.('正在获取视频信息...');
    const videoInfo = await this.getVideoInfo(videoId);

    // 3. 尝试获取官方字幕列表
    onProgress?.('正在检查官方字幕...');
    const subtitles = await this.getSubtitleList(videoInfo.aid, videoInfo.cid);
    
    // 4. 如果有官方字幕，优先使用
    const chineseSubtitles = this.filterChineseSubtitles(subtitles);
    if (chineseSubtitles.length > 0) {
      onProgress?.('正在下载官方中文字幕...');
      const subtitleData = await this.downloadSubtitle(chineseSubtitles[0].subtitle_url);
      const subtitleText = this.extractPlainText(subtitleData);
      
      if (subtitleText && subtitleText.trim()) {
        return {
          videoUrl,
          videoTitle: videoInfo.title,
          subtitleText,
          isAsr: false
        };
      }
    }

    // 5. 如果没有官方字幕，进入 ASR 流程
    onProgress?.('未检测到官方字幕，尝试进行语音识别...');
    
    try {
      onProgress?.('正在抓取音频流地址 (DASH)...');
      const audioUrl = await AudioService.getAudioUrl(videoInfo.bvid, videoInfo.cid);
      
      const isLocal = config.settings.asrProvider === 'local';
      let transcribedText = '';

      // 5.1 检查 ASR 缓存 (仅在非强制模式下)
      if (!forceMode) {
        onProgress?.('正在检索本地 ASR 缓存...');
        const cachedText = await StorageService.getAsrCache(videoInfo.bvid);
        if (cachedText) {
          onProgress?.('找到匹配的 ASR 缓存，直接使用');
          return {
            videoUrl,
            videoTitle: videoInfo.title,
            subtitleText: cachedText,
            isAsr: true
          };
        }
      }

      if (isLocal) {
        // 本地 ASR 模式：直接把 URL 丢给后端 Python 下载，避开浏览器 Referer 限制
        onProgress?.('正在通过本地服务器下载并识别 (2080ti)...');
        transcribedText = await LLMService.transcribeAudio(config, audioUrl, onProgress);
      } else {
        // 远程 ASR 模式：尝试在浏览器端下载音频并上传
        onProgress?.('正在下载视频音频...');
        const audioBlob = await AudioService.downloadAudioBlob(audioUrl);
        onProgress?.('正在通过云端 Whisper 识别语音...');
        transcribedText = await LLMService.transcribeAudio(config, audioBlob, onProgress);
      }

      if (transcribedText && transcribedText.trim().length > 0) {
        // 识别成功，存入缓存
        await StorageService.saveAsrCache(videoInfo.bvid, transcribedText);
      }

      if (!transcribedText || transcribedText.trim().length === 0) {
        throw new Error('语音识别返回内容为空');
      }

      return {
        videoUrl,
        videoTitle: videoInfo.title,
        subtitleText: transcribedText,
        isAsr: true
      };
    } catch (asrError: any) {
      console.error('[SubtitleService] ASR failed:', asrError);
      throw new Error(`该视频没有字幕，且语音识别失败: ${asrError.message || asrError}`);
    }
  }
}