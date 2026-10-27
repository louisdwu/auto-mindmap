import { BaseObserver } from './BaseObserver';
import { GeneratorService } from '../../services/generatorService';
import { YouTubeUtils } from '../../utils/youtubeUtils';
import { YouTubeSubtitleCache } from '../youtubeSubtitleCache';

/**
 * YouTube 观察者
 *
 * YouTube 是 SPA：切视频不会重新注入 content script，也不会一定重新发字幕请求。
 * 因此这里做两件事：
 *  1. 接收 main world 拦截到的字幕数据（实时路径）；
 *  2. 导航后主动尝试从页面数据/HTML 提取一次字幕（兜底路径），
 *     否则「没开字幕按钮」的视频永远不会自动生成。
 * 兜底只处理已存在的 CC 字幕，不会自动触发耗时的 ASR。
 */
export class YouTubeObserver extends BaseObserver {
  private autoAttemptTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAutoAttemptUrl: string | null = null;

  start() {
    console.log('[YouTubeObserver] Starting YouTube message listener');
    window.addEventListener('message', (event) => this.handleMessage(event));
    this.scheduleAutoAttempt();
  }

  protected onUrlChange(_newUrl?: string, _oldUrl?: string) {
    // 切换视频时必须清理缓存，避免上一个视频的字幕/音频地址污染当前视频判断
    YouTubeSubtitleCache.clearCache();
    this.scheduleAutoAttempt();
  }

  private scheduleAutoAttempt() {
    if (!this.isWatchPage()) return;
    if (this.autoAttemptTimer) clearTimeout(this.autoAttemptTimer);
    this.autoAttemptTimer = setTimeout(() => {
      this.autoAttemptTimer = null;
      void this.autoAttempt();
    }, 1500);
  }

  private isWatchPage(): boolean {
    return window.location.pathname === '/watch';
  }

  /**
   * 导航后主动获取一次字幕。失败静默：用户仍可点击悬浮球手动重试。
   */
  private async autoAttempt() {
    const videoUrl = window.location.href;
    if (!this.isWatchPage()) return;
    if (this.lastAutoAttemptUrl === videoUrl) return;
    this.lastAutoAttemptUrl = videoUrl;

    try {
      const subtitle = await YouTubeSubtitleCache.fetchSubtitle();
      if (!subtitle?.subtitleText?.trim()) return;
      if (window.location.href !== videoUrl) return;

      const title = subtitle.videoTitle || YouTubeSubtitleCache.getVideoTitle();
      const result = await GeneratorService.checkEligibility(videoUrl, title);
      if (!result.shouldProcess) {
        if (result.cachedMindmap) GeneratorService.notifyUIMindmapReady(result.cachedMindmap);
        return;
      }
      if (result.cachedMindmap) {
        GeneratorService.notifyUIMindmapReady(result.cachedMindmap);
        return;
      }

      YouTubeSubtitleCache.setSubtitleText(subtitle.subtitleText);
      await GeneratorService.requestDirectGeneration({
        videoUrl,
        subtitleText: subtitle.subtitleText,
        videoTitle: title
      });
    } catch (e) {
      console.warn('[YouTubeObserver] 主动获取字幕失败，等待用户手动触发:', e);
    }
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
