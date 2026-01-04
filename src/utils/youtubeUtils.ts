export const YouTubeUtils = {
  /**
   * 从 URL 中提取视频 ID
   */
  extractVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('v');
    } catch {
      return null;
    }
  },

  /**
   * 判断是否为字幕请求 URL
   */
  isSubtitleUrl(url: string): boolean {
    return url.includes('timedtext');
  },

  /**
   * 解析 YouTube 字幕 JSON 数据
   */
  parseSubtitle(data: any): string {
    if (!data || !data.events) {
      return '';
    }

    return data.events
      .filter((event: any) => event.segs && event.segs.length > 0)
      .map((event: any) => event.segs.map((seg: any) => seg.utf8).join(''))
      .join('\n')
      .replace(/\n+/g, '\n')
      .trim();
  },

  /**
   * 检查是否为完整字幕轨道（非片段）
   * 通常片段请求包含 'sq' 参数
   */
  isFullTrack(url: string): boolean {
    try {
      // 如果 URL 是完整的绝对路径
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        return !urlObj.searchParams.has('sq');
      }
      // 如果是相对路径或不完整的 URL，尝试简单的字符串匹配
      return !url.includes('sq=');
    } catch {
      return false;
    }
  }
};