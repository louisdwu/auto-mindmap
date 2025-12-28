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

// 初始化
initConfig().then(async () => {
  console.log('[Background] Plugin initialized');
  
  // 初始化任务管理器
  const taskManager = new TaskManager();
  
  // 初始化消息处理器（确保实例化以注册消息监听器）
  new MessageHandler(taskManager);
  
  // 监听扩展安装事件
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('[Background] Extension installed');
    } else if (details.reason === 'update') {
      console.log('[Background] Extension updated');
    }
  });
  
  // 定期清理过期任务（每小时一次）
  setInterval(() => {
    taskManager.cleanupExpiredTasks().catch(console.error);
  }, 60 * 60 * 1000);
  
  console.log('[Background] Service worker ready');
}).catch(console.error);