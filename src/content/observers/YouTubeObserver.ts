import { BaseObserver } from './BaseObserver';
import { GeneratorService } from '../../services/generatorService';
import { YouTubeUtils } from '../../utils/youtubeUtils';

export class YouTubeObserver extends BaseObserver {
  start() {
    console.log('[YouTubeObserver] Starting YouTube message listener');
    window.addEventListener('message', (event) => this.handleMessage(event));
  }

  protected onUrlChange() {
    // YouTube 的 logic 依赖于 interceptor 发出的消息，URL 变化通常伴随着新的消息
  }

  private async handleMessage(event: MessageEvent) {
    if (event.data.type === 'YOUTUBE_SUBTITLE_DATA') {
      const payload = event.data.payload;
      if (payload?.url && YouTubeUtils.isSubtitleUrl(payload.url)) {
        await this.processYouTubeSubtitle(payload);
      }
    }
  }

  private async processYouTubeSubtitle(payload: any) {
    const videoUrl = window.location.href;
    const title = document.title.replace(' - YouTube', '');
    
    const result = await GeneratorService.checkEligibility(videoUrl, title);
    
    if (result.shouldProcess) {
       if (result.cachedMindmap) {
         GeneratorService.notifyUIMindmapReady(result.cachedMindmap);
       } else {
         // 解析并生成
         const subtitleText = await this.fetchAndParseSubtitle(payload.url);
         if (subtitleText) {
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
