import { BilibiliObserver } from './observers/BilibiliObserver';
import { YouTubeObserver } from './observers/YouTubeObserver';

/**
 * 内容脚本主控制器
 * 负责平台识别与观察者生命周期管理
 */
export function initEventListener() {
  const hostname = window.location.hostname;
  
  console.log(`[ContentController] Initializing for ${hostname}`);

  if (hostname.includes('bilibili.com')) {
    const biliObserver = new BilibiliObserver();
    biliObserver.start();
  } else if (hostname.includes('youtube.com')) {
    const ytObserver = new YouTubeObserver();
    ytObserver.start();
  }
}
