export interface SubtitleInfo {
  id: string;
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

export class SubtitleService {
  /**
   * 从视频URL中提取bvid或aid
   */
  static extractVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      // 处理 /video/BVxxx 格式
      if (pathParts[0] === 'video' && pathParts[1]) {
        return pathParts[1];
      }
      
      // 处理 /video/avxxx 格式
      if (pathParts[0] === 'video' && pathParts[1]?.startsWith('av')) {
        return pathParts[1];
      }
      
      return null;
    } catch {
      return null;
    }
  }

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
   * 完整的字幕下载流程
   */
  static async downloadChineseSubtitle(videoUrl: string): Promise<{
    videoUrl: string;
    videoTitle: string;
    subtitleText: string;
  }> {
    // 1. 提取视频ID
    const videoId = this.extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error('无法从URL中提取视频ID');
    }

    // 2. 获取视频信息
    const videoInfo = await this.getVideoInfo(videoId);

    // 3. 获取字幕列表
    const subtitles = await this.getSubtitleList(videoInfo.aid, videoInfo.cid);
    
    if (subtitles.length === 0) {
      throw new Error('该视频没有字幕');
    }

    // 4. 筛选中文字幕
    const chineseSubtitles = this.filterChineseSubtitles(subtitles);
    
    if (chineseSubtitles.length === 0) {
      throw new Error('该视频没有中文字幕');
    }

    // 5. 下载第一个中文字幕
    const subtitleData = await this.downloadSubtitle(chineseSubtitles[0].subtitle_url);

    // 6. 提取纯文本
    const subtitleText = this.extractPlainText(subtitleData);

    return {
      videoUrl,
      videoTitle: videoInfo.title,
      subtitleText
    };
  }
}