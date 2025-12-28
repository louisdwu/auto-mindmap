import { StorageService } from '../services/storageService';

// 防止重复请求的状态
let pendingUrls = new Set<string>();
let processedUrls = new Set<string>();
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

// 提取视频ID用于去重
function extractVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function initEventListener() {
  // 检测当前页面是否是B站视频播放页，如果是则自动开始
  if (isBilibiliVideoPage(window.location.href)) {
    console.log('[Content] Detected Bilibili video page, auto-starting...');
    scheduleDownload(window.location.href);
  }

  // 监听URL变化（单页应用）
  let lastUrl = window.location.href;
  
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      const newUrl = window.location.href;
      console.log('[Content] URL changed:', lastUrl, '->', newUrl);
      lastUrl = newUrl;
      
      // URL变化时重置已处理的URL集合
      processedUrls.clear();
      
      if (isBilibiliVideoPage(newUrl)) {
        console.log('[Content] Detected Bilibili video page, auto-starting...');
        scheduleDownload(newUrl);
      }
    }
  });

  // 同时监听 popstate 事件（B站前端路由使用）
  window.addEventListener('popstate', () => {
    const newUrl = window.location.href;
    console.log('[Content] Popstate event, URL:', newUrl);
    if (isBilibiliVideoPage(newUrl)) {
      scheduleDownload(newUrl);
    }
  });

  // 监听 body 变化
  urlObserver.observe(document.body, { childList: true, subtree: true });
  
  // 额外监听 document 和 window 的导航事件
  document.addEventListener('spf.navigate', () => {
    console.log('[Content] SPF navigate event');
    const newUrl = window.location.href;
    if (isBilibiliVideoPage(newUrl)) {
      scheduleDownload(newUrl);
    }
  });
}

// 调度下载任务，使用防抖和去重
function scheduleDownload(videoUrl: string) {
  const videoId = extractVideoId(videoUrl);
  
  // 如果没有有效的视频ID，跳过
  if (!videoId) {
    console.log('[Content] 无法提取视频ID，跳过:', videoUrl);
    return;
  }
  
  // 如果该视频已经处理过或正在处理中，跳过
  if (processedUrls.has(videoId) || pendingUrls.has(videoId)) {
    console.log('[Content] 视频已处理或正在处理中，跳过:', videoId);
    return;
  }
  
  // 标记为待处理
  pendingUrls.add(videoId);
  
  // 清除之前的定时器
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
  }
  
  // 延迟执行，合并短时间内的多次请求
  pendingTimeout = setTimeout(async () => {
    // Check for exclusion keywords
    try {
      const config = await StorageService.getConfig();
      const keywords = config?.exclusionKeywords || [];

      if (keywords.length > 0) {
        // Get video title
        const titleElement = document.querySelector('.video-title') || document.querySelector('h1');
        const title = titleElement?.textContent?.trim() || document.title;

        if (title) {
          const matchedKeyword = keywords.find(k => title.includes(k));
          if (matchedKeyword) {
            console.log(`[Content] Video title "${title}" matches exclusion keyword "${matchedKeyword}", skipping auto-generation.`);
            pendingUrls.clear();
            return;
          }
        }
      }
    } catch (error) {
      console.error('[Content] Failed to check exclusion keywords:', error);
    }

    // 获取所有待处理的URL
    const urlsToProcess = Array.from(pendingUrls);
    pendingUrls.clear();
    
    for (const id of urlsToProcess) {
      if (!processedUrls.has(id)) {
        processedUrls.add(id);
        await downloadSubtitle(videoUrl);
      }
    }
  }, 2000);
}

function isBilibiliVideoPage(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'www.bilibili.com' &&
           urlObj.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

async function downloadSubtitle(videoUrl: string) {
  console.log('[Content] Downloading subtitle for:', videoUrl);
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_SUBTITLE',
      payload: { videoUrl }
    });

    console.log('[Content] Download task created:', response.taskId);
  } catch (error) {
    console.error('[Content] Download failed:', error);
  }
}
