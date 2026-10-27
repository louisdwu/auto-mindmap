import { StorageService } from './storageService';
import { VideoUtils } from '../utils/videoUtils';
import { RuntimeUtils } from '../utils/runtimeUtils';

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
    const media = VideoUtils.parseMediaRef(url);
    if (!media) {
      return { shouldProcess: false, reason: '无法识别视频页面' };
    }
    const videoId = media.cacheId;

    // 1. 检查暂停状态
    if (await StorageService.isPaused()) {
      return { shouldProcess: false, reason: '插件已暂停' };
    }

    // 2. 检查配置与关键词过滤
    const config = await StorageService.getConfig();
    if (config?.exclusionKeywords && config.exclusionKeywords.length > 0 && title) {
      const matched = config.exclusionKeywords.find((k: string) => title.includes(k));
      if (matched) {
        return { shouldProcess: false, reason: `标题匹配排除词: ${matched}` };
      }
    }

    // 3. 检查缓存 (如果启用)
    if (config?.settings.enableCache) {
      const cached = await StorageService.getLatestMindmapByUrl(url);
      if (cached) {
        // 关键逻辑：校验缓存是否包含时间戳，无时间戳的旧缓存自动失效并重新生成
        const hasTimestamps = /\[\d{1,2}:\d{2}/.test(cached.subtitleText || '');
        if (hasTimestamps) {
          return { shouldProcess: true, cachedMindmap: cached, reason: '命中缓存' };
        } else {
          console.log('[GeneratorService] 发现旧版无时间戳缓存，自动清理并重新提取生成');
          await StorageService.deleteMindmapByUrl(url);
          if (videoId) {
            await StorageService.deleteSubtitleCache(videoId);
            await StorageService.deleteAsrCache(videoId);
            await StorageService.deletePhase1Cache(videoId);
          }
        }
      }
    }

    return { shouldProcess: true };
  }

  /**
   * 发起字幕下载任务 (B站)
   */
  static async requestSubtitleDownload(videoUrl: string, videoTitle?: string): Promise<any> {
    return RuntimeUtils.sendMessage({
      type: 'DOWNLOAD_SUBTITLE',
      payload: { videoUrl, videoTitle, origin: 'auto' }
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
    return RuntimeUtils.sendMessage({
      type: 'GENERATE_MINDMAP_DIRECT',
      payload: { ...payload, origin: 'auto' }
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