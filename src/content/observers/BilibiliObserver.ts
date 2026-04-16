import { BaseObserver } from './BaseObserver';
import { GeneratorService } from '../../services/generatorService';

export class BilibiliObserver extends BaseObserver {

  start() {
    if (this.isVideoPage(window.location.href)) {
      this.triggerProcessing(window.location.href);
    }
  }

  protected onUrlChange(newUrl: string) {
    if (this.isVideoPage(newUrl)) {
      this.triggerProcessing(newUrl);
    }
  }

  private isVideoPage(url: string): boolean {
    return url.includes('bilibili.com/video/');
  }

  /**
   * 触发处理逻辑，集成 GeneratorService 进行过滤
   */
  private async triggerProcessing(url: string) {
    // 等待 DOM 加载标题 (优化点：不再盲目监听 body)
    const title = await this.waitForTitle();
    
    const result = await GeneratorService.checkEligibility(url, title);
    
    if (result.shouldProcess) {
      if (result.cachedMindmap) {
        console.log('[BilibiliObserver] 命中缓存:', result.cachedMindmap.id);
        GeneratorService.notifyUIMindmapReady(result.cachedMindmap);
      } else {
        console.log('[BilibiliObserver] 请求下载字幕');
        await GeneratorService.requestSubtitleDownload(url);
      }
    } else {
      console.log('[BilibiliObserver] 跳过处理:', result.reason);
    }
  }

  private async waitForTitle(): Promise<string> {
    return new Promise((resolve) => {
      let retryCount = 0;
      const check = () => {
        const titleEl = document.querySelector('.video-title') || document.querySelector('h1.video-title');
        const text = titleEl?.textContent?.trim();
        if (text) {
          resolve(text);
        } else if (retryCount < 10) {
          retryCount++;
          setTimeout(check, 500);
        } else {
          resolve(document.title);
        }
      };
      check();
    });
  }
}
