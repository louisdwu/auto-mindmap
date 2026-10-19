import { BaseObserver } from './BaseObserver';
import { GeneratorService } from '../../services/generatorService';
import { YouTubeUtils } from '../../utils/youtubeUtils';
import { YouTubeSubtitleCache } from '../youtubeSubtitleCache';

export class YouTubeObserver extends BaseObserver {
  start() {
    console.log('[YouTubeObserver] Starting YouTube message listener');
    window.addEventListener('message', (event) => this.handleMessage(event));
  }

  protected onUrlChange(_newUrl?: string, _oldUrl?: string) {
    // YouTube 是 SPA，导航不会重新注入 content script / interceptor，
    // 切换视频时必须清理缓存，避免上一个视频的字幕/音频地址污染当前视频判断
    YouTubeSubtitleCache.clearCache();
  }

  private async handleMessage(event: MessageEvent) {
    const type = event?.data?.type;
    if (type === 'YOUTUBE_CAPTION_TRACKS') {
      // main world 推送的字幕轨道列表，缓存以便手动点击悬浮球时主动获取
      const payload = event.data.payload || {};
      YouTubeSubtitleCache.setCaptionTracks(payload.tracks, payload.videoTitle);
      return;
    }
    if (type === 'YOUTUBE_SUBTITLE_DATA') {
      const payload = event.data.payload;
      if (payload?.url && YouTubeUtils.isSubtitleUrl(payload.url)) {
        // 缓存字幕请求 URL，手动点击时可复用重新 fetch 完整轨道
        YouTubeSubtitleCache.setSubtitleUrl(payload.url);
        await this.processYouTubeSubtitle(payload);
      }
    }
  }

  private async processYouTubeSubtitle(payload: any) {
    const videoUrl = window.location.href;
    const title = YouTubeSubtitleCache.getVideoTitle();
    
    const result = await GeneratorService.checkEligibility(videoUrl, title);
    
    if (result.shouldProcess) {
       if (result.cachedMindmap) {
         GeneratorService.notifyUIMindmapReady(result.cachedMindmap);
       } else {
         // 解析并生成
         const subtitleText = await this.fetchAndParseSubtitle(payload.url);
         if (subtitleText) {
           // 缓存已解析文本，手动点击悬浮球时可直接复用，避免重复 fetch
           YouTubeSubtitleCache.setSubtitleText(subtitleText);
           await GeneratorService.requestDirectGeneration({
             videoUrl,
             subtitleText,
             videoTitle: title
           });
         }
       }
    }
  }

  private async fetchAndParseSubtitle(url: string): Promise<string | null> {
    try {
      const urlObj = new URL(url);
      urlObj.searchParams.delete('sq');
      urlObj.searchParams.set('fmt', 'json3');
      
      const response = await fetch(urlObj.toString());
      const data = await response.json();
      return YouTubeUtils.parseSubtitle(data);
    } catch (e) {
      console.error('[YouTubeObserver] Failed to fetch subtitle:', e);
      return null;
    }
  }
}
