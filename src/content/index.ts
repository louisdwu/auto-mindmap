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
chrome.runtime.onMessage.addListener((message) => {
  console.log('[Content] Received message:', message);
  
  switch (message.type) {
    case 'MINDMAP_GENERATED':
      // 显示悬浮球红点
      showFloatingBallNotification();
      break;
  }
});

function showFloatingBallNotification() {
  const event = new CustomEvent('mindmap-generated');
  window.dispatchEvent(event);
}