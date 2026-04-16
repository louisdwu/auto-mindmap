import { StorageService } from './storageService';
import { VideoUtils } from '../utils/videoUtils';

export interface CheckResult {
  shouldProcess: boolean;
  reason?: string;
  cachedMindmap?: any;
}

/**
 * 核心生成业务逻辑服务
 * 负责解析规则过滤、状态验证及任务分发
 */
export class GeneratorService {
  /**
   * 检查视频是否符合自动处理条件
   */
  static async checkEligibility(url: string, title?: string): Promise<CheckResult> {
    const videoId = VideoUtils.extractVideoId(url);
    if (!videoId) {
      return { shouldProcess: false, reason: '无法提取视频ID' };
    }

    // 1. 检查暂停状态
    if (await StorageService.isPaused()) {
      return { shouldProcess: false, reason: '插件已暂停' };
    }

    // 2. 检查配置与关键词过滤
    const config = await StorageService.getConfig();
    if (config?.exclusionKeywords && config.exclusionKeywords.length > 0 && title) {
      const matched = config.exclusionKeywords.find(k => title.includes(k));
      if (matched) {
        return { shouldProcess: false, reason: `标题匹配排除词: ${matched}` };
      }
    }

    // 3. 检查缓存 (如果启用)
    if (config?.settings.enableCache) {
      const cached = await StorageService.getLatestMindmapByUrl(url);
      if (cached) {
        return { shouldProcess: true, cachedMindmap: cached, reason: '命中缓存' };
      }
    }

    return { shouldProcess: true };
  }

  /**
   * 发起字幕下载任务 (B站)
   */
  static async requestSubtitleDownload(videoUrl: string): Promise<any> {
    return chrome.runtime.sendMessage({
      type: 'DOWNLOAD_SUBTITLE',
      payload: { videoUrl }
    });
  }

  /**
   * 直接发起生成任务 (YouTube 等已获取字幕的情况)
   */
  static async requestDirectGeneration(payload: {
    videoUrl: string;
    subtitleText: string;
    videoTitle: string;
  }): Promise<any> {
    return chrome.runtime.sendMessage({
      type: 'GENERATE_MINDMAP_DIRECT',
      payload
    });
  }

  /**
   * 通知 UI 层发现缓存或生成完成
   */
  static notifyUIMindmapReady(mindmapData: any) {
    window.dispatchEvent(new CustomEvent('mindmap-generated', {
      detail: { mindmapData }
    }));
  }
}
