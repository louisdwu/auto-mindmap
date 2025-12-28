import { PluginConfig } from '../types/config';

/**
 * 文件服务 - 处理文件下载到用户指定目录
 *
 * Chrome 扩展的限制：
 * - downloads API 只能写入默认下载目录
 * - 不能直接写入任意绝对路径
 *
 * 解决方案：
 * - 使用 downloads API 保存文件
 * - 文件保存到 Chrome 默认下载目录
 */
export class FileService {
  // 子目录名称
  private static readonly SUBDIR = 'bilibili_mindmap';

  /**
   * 检查是否设置了缓存目录
   */
  static hasCacheDirectory(config: PluginConfig): boolean {
    return !!config.settings.cacheDirectory && 
           config.settings.cacheDirectory.trim().length > 0;
  }

  /**
   * 保存字幕文件到指定目录
   */
  static async saveSubtitleFile(
    content: string,
    fileName: string,
    _cacheDirectory: string
  ): Promise<void> {
    await this.saveFile(content, fileName);
  }

  /**
   * 保存思维导图文件到指定目录
   */
  static async saveMindmapFile(
    content: string,
    fileName: string,
    _cacheDirectory: string
  ): Promise<void> {
    await this.saveFile(content, fileName);
  }

  /**
   * 保存文件
   * 注意：background service worker 没有 DOM API，使用 data URL
   */
  private static async saveFile(content: string, fileName: string): Promise<void> {
    // 使用 data URL 替代 Blob URL（background worker 中可用）
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;

    try {
      // 清理文件名，确保安全
      const safeName = fileName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_.\-]/g, '_');
      
      // 先尝试保存到子目录
      const subdirPath = `${this.SUBDIR}/${safeName}`;
      console.log('[FileService] 尝试保存到子目录:', subdirPath);
      
      try {
        await this.downloadFile(dataUrl, subdirPath);
        console.log('[FileService] 子目录保存成功');
        return;
      } catch (subdirError) {
        console.warn('[FileService] 子目录保存失败，尝试保存到根目录:', subdirError);
        // 如果子目录失败，尝试保存到根目录
        await this.downloadFile(dataUrl, safeName);
        console.log('[FileService] 根目录保存成功');
        return;
      }
    } catch (error) {
      console.error('[FileService] 所有保存方法都失败:', error);
      throw error;
    }
  }

  /**
   * 执行下载
   */
  private static async downloadFile(url: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false,
        conflictAction: 'uniquify'
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (!downloadId) {
          reject(new Error('下载ID无效'));
          return;
        }
        
        console.log('[FileService] 下载已启动, id:', downloadId, '文件名:', filename);
        
        // 监听下载完成
        const timeout = setTimeout(() => {
          chrome.downloads.onChanged.removeListener(listener);
          reject(new Error('下载超时 (30秒)'));
        }, 30000);

        const listener = (downloadDelta: any) => {
          if (downloadDelta.id === downloadId) {
            if (downloadDelta.state?.current === 'complete') {
              clearTimeout(timeout);
              chrome.downloads.onChanged.removeListener(listener);
              console.log('[FileService] 下载完成, id:', downloadId);
              resolve();
            } else if (downloadDelta.state?.current === 'interrupted') {
              clearTimeout(timeout);
              chrome.downloads.onChanged.removeListener(listener);
              const errorMsg = downloadDelta.error?.current || '未知错误';
              console.error('[FileService] 下载被中断:', errorMsg);
              reject(new Error('下载被中断: ' + errorMsg));
            }
          }
        };

        chrome.downloads.onChanged.addListener(listener);
      });
    });
  }

  /**
   * 生成字幕文件名
   */
  static generateSubtitleFileName(videoTitle: string, index?: number): string {
    const safeTitle = videoTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 50);
    const suffix = index !== undefined ? `_${index}` : '';
    return `${safeTitle}_字幕${suffix}.txt`;
  }

  /**
   * 生成思维导图文件名
   */
  static generateMindmapFileName(videoTitle: string, index?: number): string {
    const safeTitle = videoTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 50);
    const suffix = index !== undefined ? `_${index}` : '';
    return `${safeTitle}_思维导图${suffix}.md`;
  }

  /**
   * 获取子目录名称（供 UI 显示用）
   */
  static getSubDirectoryName(): string {
    return this.SUBDIR;
  }
}