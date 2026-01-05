import { StorageService } from '../services/storageService';
import { YouTubeUtils } from '../utils/youtubeUtils';

// 防止重复请求的状态
let pendingUrls = new Set<string>();
let processedUrls = new Set<string>();
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let processedYouTubeUrls = new Set<string>();

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
  // 监听 YouTube 字幕消息
  window.addEventListener('message', async (event) => {
    if (event.data.type === 'YOUTUBE_SUBTITLE_DATA') {
      // 检查是否是当前视频的有效字幕请求
      const payload = event.data.payload;
      if (payload && payload.url && YouTubeUtils.isSubtitleUrl(payload.url)) {
        console.log('[Content] Received YouTube subtitle data');
        // 使用防抖处理 YouTube 字幕
        debouncedHandleYouTubeSubtitle(payload);
      }
    }
  });

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
    // 首先检查是否处于暂停状态
    try {
      const isPaused = await StorageService.isPaused();
      if (isPaused) {
        console.log('[Content] 插件已暂停，跳过自动生成思维导图');
        pendingUrls.clear();
        return;
      }
    } catch (error) {
      console.error('[Content] Failed to check pause state:', error);
    }

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

// YouTube 字幕处理防抖
let youtubeSubtitleTimeout: ReturnType<typeof setTimeout> | null = null;
const YOUTUBE_DEBOUNCE_TIME = 2000;

function debouncedHandleYouTubeSubtitle(payload: { url: string, data: any }) {
  if (youtubeSubtitleTimeout) {
    clearTimeout(youtubeSubtitleTimeout);
  }

  youtubeSubtitleTimeout = setTimeout(() => {
    handleYouTubeSubtitle(payload);
  }, YOUTUBE_DEBOUNCE_TIME);
}

// 处理 YouTube 字幕数据
async function handleYouTubeSubtitle(payload: { url: string, data: any }) {
  try {
    // 检查是否暂停
    const isPaused = await StorageService.isPaused();
    if (isPaused) {
      console.log('[Content] 插件已暂停，跳过 YouTube 字幕处理');
      return;
    }

    const currentVideoUrl = window.location.href;
    const videoId = YouTubeUtils.extractVideoId(currentVideoUrl);
    
    if (!videoId) {
      console.log('[Content] Cannot extract video ID from current URL');
      return;
    }

    // 检查是否已经处理过该视频
    if (processedYouTubeUrls.has(videoId)) {
      console.log('[Content] YouTube video already processed:', videoId);
      return;
    }

    const videoTitle = document.title.replace(' - YouTube', '');
    
    // 构造请求完整字幕的 URL
    // 去除 'sq' 参数（分片序号），强制 'fmt=json3'
    let fullSubtitleUrl = payload.url;
    try {
      const urlObj = new URL(payload.url);
      urlObj.searchParams.delete('sq');
      urlObj.searchParams.set('fmt', 'json3');
      fullSubtitleUrl = urlObj.toString();
      console.log('[Content] Constructed full subtitle URL:', fullSubtitleUrl);
    } catch (e) {
      console.warn('[Content] Failed to construct full subtitle URL, using original:', e);
    }

    // 重新请求完整字幕
    console.log('[Content] Fetching full subtitle...');
    const response = await fetch(fullSubtitleUrl);
    const fullData = await response.json();

    // 解析字幕
    const subtitleText = YouTubeUtils.parseSubtitle(fullData);

    if (!subtitleText) {
        console.log('[Content] Parsed subtitle text is empty');
        return;
    }

    console.log('[Content] Parsed YouTube subtitle, length:', subtitleText.length);

    // 标记为已处理
    processedYouTubeUrls.add(videoId);

    // 直接触发生成思维导图
    const responseMsg = await chrome.runtime.sendMessage({
      type: 'GENERATE_MINDMAP_DIRECT',
      payload: {
        videoUrl: currentVideoUrl,
        subtitleText: subtitleText,
        videoTitle: videoTitle
      }
    });
    
    console.log('[Content] Mindmap generation task created:', responseMsg.taskId);

  } catch (error) {
    console.error('[Content] Error handling YouTube subtitle:', error);
  }
}
