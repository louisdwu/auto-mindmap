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
  }
};
