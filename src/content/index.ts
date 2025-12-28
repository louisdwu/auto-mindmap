import { initEventListener } from './eventListener';
import { initFloatingBall } from './floatingBall';
import './styles.css';

// 初始化
console.log('[Content] Script loaded');

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