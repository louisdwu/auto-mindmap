import { MediaRef, getCacheId, isSameMedia, parseMediaRef } from './media';

/**
 * 视频相关通用工具函数
 *
 * 视频身份判定统一委托给 utils/media.ts：它同时处理 B 站分 P、av/BV 与
 * YouTube 各种链接形态。本文件只保留「时间戳 / 跳转」等播放器相关工具。
 */
export const VideoUtils = {
  /**
   * 从视频 URL 中提取平台原生 Video ID（不含分 P 信息）。
   * 需要区分分 P 时请使用 getCacheId 或 parseMediaRef。
   */
  extractVideoId(url: string | undefined | null): string | null {
    return parseMediaRef(url)?.videoId ?? null;
  },

  /** 解析完整媒体标识（含平台、分 P、缓存键） */
  parseMediaRef(url: string | undefined | null): MediaRef | null {
    return parseMediaRef(url);
  },

  /** 缓存 / 任务使用的稳定标识（B 站 P2 为 BV..._p2） */
  getCacheId(url: string | undefined | null): string | null {
    return getCacheId(url);
  },

  /** 两个 URL 是否指向同一视频的同一分 P */
  isSameVideo(urlA: string | undefined | null, urlB: string | undefined | null): boolean {
    return isSameMedia(urlA, urlB);
  },

  /**
   * 将秒数格式化为时间戳字符串 (mm:ss 或 hh:mm:ss)
   */
  formatSecondsToTimestamp(seconds: number): string {
    const totalSec = Math.max(0, Math.floor(seconds));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    if (h > 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  },

  /**
   * 将时间戳文本 (mm:ss 或 hh:mm:ss) 解析为秒数
   */
  parseTimestampToSeconds(ts: string): number | null {
    if (!ts) return null;
    const parts = ts.trim().split(':').map(Number);
    if (parts.some(isNaN)) return null;

    if (parts.length === 2) {
      const [m, s] = parts;
      return m * 60 + s;
    } else if (parts.length === 3) {
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    }
    return null;
  },

  /**
   * 在当前页面中查找视频元素并跳转到指定秒数
   */
  seekVideoTo(seconds: number): boolean {
    try {
      const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
      if (videos.length === 0) {
        console.warn('[VideoUtils] 未找到任何 video 元素');
        return false;
      }

      // 优先选取有效时长或正在播放的视频
      const targetVideo = videos.find(v => !isNaN(v.duration) && v.duration > 0) || videos[0];
      if (targetVideo) {
        targetVideo.currentTime = seconds;
        targetVideo.play().catch(() => {});
        return true;
      }
      return false;
    } catch (e) {
      console.error('[VideoUtils] 跳转视频位置失败:', e);
      return false;
    }
  }
};
