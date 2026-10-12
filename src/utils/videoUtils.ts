/**
 * 视频相关通用工具函数
 */
export const VideoUtils = {
  /**
   * 从视频 URL 中提取唯一标识符 (Video ID)
   * 支持平台：
   * - Bilibili (BV号, av号)
   * - YouTube (标准参数, 短链接, 嵌入式链接)
   */
  extractVideoId(url: string | undefined | null): string | null {
    if (!url) return null;
    
    try {
      // 确保是合法的 URL
      let urlStr = url.trim();
      if (!urlStr.startsWith('http')) {
        urlStr = 'https://' + urlStr;
      }
      
      const urlObj = new URL(urlStr);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname;

      // 1. Bilibili 逻辑
      if (hostname.includes('bilibili.com')) {
        // 匹配 /video/BV... 或 /video/av...
        const biliMatch = pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
        if (biliMatch) return biliMatch[1];
        
        // 匹配单视频参数 (bvid)
        const bvid = urlObj.searchParams.get('bvid');
        if (bvid) return bvid;
        const aid = urlObj.searchParams.get('aid');
        if (aid) return aid.startsWith('av') ? aid : 'av' + aid;
      }

      // 2. YouTube 逻辑
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        // 标准 URL: youtube.com/watch?v=VIDEO_ID
        const v = urlObj.searchParams.get('v');
        if (v) return v;

        const pathParts = pathname.split('/').filter(Boolean);
        
        // 短链接: youtu.be/VIDEO_ID
        if (hostname === 'youtu.be') return pathParts[0];
        
        // 嵌入链接: youtube.com/embed/VIDEO_ID
        if (pathParts[0] === 'embed') return pathParts[1];
        
        // 旧版链接: youtube.com/v/VIDEO_ID
        if (pathParts[0] === 'v') return pathParts[1];
        
        // Shorts 链接: youtube.com/shorts/VIDEO_ID
        if (pathParts[0] === 'shorts') return pathParts[1];
      }

      return null;
    } catch (e) {
      console.warn('[VideoUtils] Failed to extract video ID from:', url, e);
      return null;
    }
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
