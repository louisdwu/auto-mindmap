import { TaskManager } from './taskManager';
import { MessageHandler } from './messageHandler';
import { DEFAULT_CONFIG } from '../types/config';
import { StorageService } from '../services/storageService';

// 初始化配置
async function initConfig() {
  const config = await StorageService.getConfig();
  if (!config) {
    await StorageService.saveConfig(DEFAULT_CONFIG);
  }
}

// 更新图标 badge 状态
async function updateBadgeState() {
  const isPaused = await StorageService.isPaused();
  
  if (isPaused) {
    // 暂停状态：显示红色 "||" 标记
    await chrome.action.setBadgeText({ text: '||' });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
    await chrome.action.setTitle({ title: '自动思维导图（已暂停）- 点击恢复' });
  } else {
    // 运行状态：清除 badge
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: '自动思维导图（运行中）- 点击暂停' });
  }
}

// 切换暂停状态
async function togglePauseState() {
  const newPausedState = await StorageService.togglePaused();
  console.log('[Background] Pause state toggled:', newPausedState ? 'PAUSED' : 'RUNNING');
  await updateBadgeState();
  return newPausedState;
}

// 初始化
initConfig().then(async () => {
  console.log('[Background] Plugin initialized');
  
  // 初始化任务管理器
  const taskManager = new TaskManager();
  
  // 初始化消息处理器（确保实例化以注册消息监听器）
  new MessageHandler(taskManager);
  
  // 初始化 badge 状态
  await updateBadgeState();
  
  // 监听扩展图标点击事件
  chrome.action.onClicked.addListener(async (_tab) => {
    console.log('[Background] Extension icon clicked');
    await togglePauseState();
  });
  
  // 监听扩展安装事件
  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('[Background] Extension installed');
      // 安装时初始化 badge 状态
      await updateBadgeState();
    } else if (details.reason === 'update') {
      console.log('[Background] Extension updated');
      // 更新时也更新 badge 状态
      await updateBadgeState();
    }
  });
  
  // 定期清理过期任务（每小时一次）
  setInterval(() => {
    taskManager.cleanupExpiredTasks().catch(console.error);
  }, 60 * 60 * 1000);
  
  console.log('[Background] Service worker ready');
}).catch(console.error);