import { initEventListener } from './eventListener';
import { initFloatingBall } from './floatingBall';
import './styles.css';

// 初始化
console.log('[Content] Script loaded');

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
      break;

    case 'FETCH_SUBTITLES':
      // 在页面上下文中获取字幕（利用用户的登录 cookie）
      fetchSubtitlesInPageContext(message.payload)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true; // 保持消息通道开放
  }
});

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