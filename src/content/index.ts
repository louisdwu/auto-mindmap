import { initEventListener } from './eventListener';
import { initFloatingBall } from './floatingBall';
import { StorageService } from '../services/storageService';
import { NotificationUtils } from '../utils/notificationUtils';
import { YouTubeSubtitleCache } from './youtubeSubtitleCache';
import './styles.css';

// 初始化
console.log('[Content] Script loaded (v2.1: youtube subtitle html-fallback + asr)');

// 注入 YouTube 拦截器
if (window.location.hostname.includes('youtube.com')) {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/content/youtubeInterceptor.js');
  (document.head || document.documentElement).appendChild(script);
  console.log('[Content] YouTube interceptor injected');
}

// 初始化事件监听
initEventListener();

// 初始化悬浮球
initFloatingBall();

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Content] Received message:', message);
  
  switch (message.type) {
    case 'MINDMAP_GENERATED':
      // 显示悬浮球红点
      showFloatingBallNotification();
      // 播放提示音
      checkAndPlayDing();
      break;

    case 'FETCH_SUBTITLES':
      // 在页面上下文中获取字幕（利用用户的登录 cookie）
      fetchSubtitlesInPageContext(message.payload)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true; // 保持消息通道开放

    case 'FETCH_AUDIO_BLOB':
      // 在页面上下文中下载音频并转为 Base64 返回
      fetchAudioBlobInPageContext(message.payload)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true; // 保持消息通道开放

    case 'FETCH_YOUTUBE_SUBTITLE':
      // 在页面上下文中主动获取 YouTube 字幕（手动点击悬浮球时由 background 调用）
      fetchYouTubeSubtitleForBackground()
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true; // 保持消息通道开放

    case 'FETCH_YOUTUBE_AUDIO_URL':
      // 获取 YouTube 音频流地址（无字幕时回退 ASR 用，由 background 调用）
      fetchYouTubeAudioUrlForBackground()
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true; // 保持消息通道开放
  }
});
/**
 * 在页面上下文中下载音频数据，以绕过 Service Worker 中的 Referer 和 Cookie 限制
 */
async function fetchAudioBlobInPageContext(payload: { url: string }): Promise<any> {
  try {
    console.log('[Content] 开始在页面上下文中下载音频...');
    const response = await fetch(payload.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    
    const blob = await response.blob();
    console.log(`[Content] 音频下载成功，大小: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    
    // 转为 base64 发送回 background
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({ base64Data: reader.result });
      };
      reader.onerror = () => {
        reject(new Error('将音频转为 Base64 失败'));
      };
      reader.readAsDataURL(blob);
    });
  } catch (error: any) {
    console.error('[Content] 音频下载失败:', error);
    throw new Error(`Content Script 音频下载失败: ${error.message || error}`);
  }
}


/**
 * 在页面上下文中获取字幕列表
 * 因为 content script 的 fetch 天然携带页面的登录 cookie，
 * 可以获取到需要登录才能看到的 AI 字幕
 */
async function fetchSubtitlesInPageContext(payload: { bvid: string; cid: number }): Promise<any> {
  const { bvid, cid } = payload;
  console.log('[Content] 正在页面上下文中获取字幕, bvid:', bvid, 'cid:', cid);

  // 直接用 bvid + cid 请求（页面上下文有 cookie，不需要 WBI 签名）
  try {
    const response = await fetch(
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`,
      { credentials: 'include' }
    );
    const data = await response.json();
    console.log('[Content] 字幕 API 返回 login_mid:', data.data?.login_mid, 'need_login_subtitle:', data.data?.need_login_subtitle);

    if (data.code === 0) {
      const subtitles = data.data?.subtitle?.subtitles || [];
      console.log('[Content] 获取到字幕数量:', subtitles.length);
      if (subtitles.length > 0) {
        return { subtitles };
      }
    }
  } catch (e: any) {
    console.warn('[Content] 页面上下文字幕请求失败:', e);
  }

  // 回退：尝试从页面 DOM 中提取字幕信息
  try {
    const initialState = (window as any).__INITIAL_STATE__;
    if (initialState?.videoData?.subtitle?.list?.length > 0) {
      console.log('[Content] 从 __INITIAL_STATE__ 中提取到字幕');
      return { subtitles: initialState.videoData.subtitle.list };
    }
  } catch (e) {
    console.warn('[Content] __INITIAL_STATE__ 提取失败:', e);
  }

  return { subtitles: [] };
}

function showFloatingBallNotification() {
  const event = new CustomEvent('mindmap-generated');
  window.dispatchEvent(event);
}

/**
 * 响应 background 的 FETCH_YOUTUBE_SUBTITLE 请求
 * 通过 YouTubeSubtitleCache 主动获取字幕文本（多级回退，含 fetch HTML 兜底）：
 *   1. observer 已拦截并解析的字幕文本
 *   2. observer 拦截到的字幕 URL（重新 fetch 完整轨道）
 *   3. main world 推送的 captionTracks（任选一条 fetch）
 *   4. 直接 fetch 当前页面 HTML 提取 captionTracks（最可靠兜底）
 * 返回 { subtitleText, videoTitle } 或 { error }
 * 注意：返回 error 时，background 会回退到 ASR 语音识别流程，因此这里的提示
 * 文案不要写成“请确认有字幕”，而是让 background 自行决定回退。
 */
async function fetchYouTubeSubtitleForBackground(): Promise<any> {
  console.log('[Content] 收到 FETCH_YOUTUBE_SUBTITLE 请求，开始主动获取 YouTube 字幕');
  const result = await YouTubeSubtitleCache.fetchSubtitle();
  if (result && result.subtitleText && result.subtitleText.trim()) {
    console.log('[Content] YouTube 字幕获取成功，长度:', result.subtitleText.length);
    return {
      subtitleText: result.subtitleText,
      videoTitle: result.videoTitle
    };
  }
  // 返回空结果而非 error，让 background 判断为“无字幕”并回退 ASR
  return { subtitleText: null, videoTitle: YouTubeSubtitleCache.getVideoTitle() };
}

/**
 * 响应 background 的 FETCH_YOUTUBE_AUDIO_URL 请求
 * 获取 YouTube 音频流地址（用于无字幕时回退 ASR）
 * 返回 { audioUrl, videoTitle } 或 { error }
 */
async function fetchYouTubeAudioUrlForBackground(): Promise<any> {
  console.log('[Content] 收到 FETCH_YOUTUBE_AUDIO_URL 请求，开始获取 YouTube 音频流地址');
  const audioUrl = await YouTubeSubtitleCache.fetchAudioUrl();
  if (audioUrl) {
    console.log('[Content] YouTube 音频流地址获取成功');
    return { audioUrl, videoTitle: YouTubeSubtitleCache.getVideoTitle() };
  }
  return { error: '无法从页面提取 YouTube 音频流地址（可能是受签名保护的内容），暂不支持语音识别。' };
}

async function checkAndPlayDing() {
  const config = await StorageService.getConfig();
  if (config?.settings?.enableSoundNotification !== false) {
    const volume = config?.settings?.soundNotificationVolume ?? 0.8;
    NotificationUtils.playDing(volume);
  }
}