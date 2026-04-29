export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  module: string;
  message: string;
  data?: any;
}

const LOGS_STORAGE_KEY = 'run_logs';
const MAX_LOGS = 500;

export class LoggerService {
  /**
   * 记录日志
   */
  static async log(level: LogLevel, module: string, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      module,
      message,
      data: this.sanitizeData(data)
    };

    console.log(`[${module}] [${level.toUpperCase()}] ${message}`, data || '');

    try {
      const result = await chrome.storage.local.get(LOGS_STORAGE_KEY);
      const logs: LogEntry[] = result[LOGS_STORAGE_KEY] || [];
      
      logs.unshift(entry);
      
      if (logs.length > MAX_LOGS) {
        logs.splice(MAX_LOGS);
      }

      await chrome.storage.local.set({ [LOGS_STORAGE_KEY]: logs });
      
      // 通知 UI 更新 (如果有监听者)
      chrome.runtime.sendMessage({ type: 'LOG_ADDED', payload: entry }).catch(() => {
        // 忽略没有接收者的错误
      });
    } catch (error) {
      console.error('Failed to save log:', error);
    }
  }

  static async info(module: string, message: string, data?: any) {
    return this.log('info', module, message, data);
  }

  static async warn(module: string, message: string, data?: any) {
    return this.log('warn', module, message, data);
  }

  static async error(module: string, message: string, data?: any) {
    return this.log('error', module, message, data);
  }

  static async debug(module: string, message: string, data?: any) {
    return this.log('debug', module, message, data);
  }

  /**
   * 获取所有日志
   */
  static async getLogs(): Promise<LogEntry[]> {
    const result = await chrome.storage.local.get(LOGS_STORAGE_KEY);
    return result[LOGS_STORAGE_KEY] || [];
  }

  /**
   * 清除日志
   */
  static async clearLogs() {
    await chrome.storage.local.remove(LOGS_STORAGE_KEY);
  }

  /**
   * 简单清洗数据，防止存储过大或循环引用
   */
  private static sanitizeData(data: any): any {
    if (!data) return undefined;
    try {
      const str = JSON.stringify(data);
      if (str.length > 2000) {
        return str.substring(0, 2000) + '... (truncated)';
      }
      return JSON.parse(str);
    } catch {
      return String(data);
    }
  }
}
