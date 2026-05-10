/**
 * Runtime 工具类，处理扩展运行时的兼容性与安全性
 */
export class RuntimeUtils {
  /**
   * 检查当前扩展上下文是否有效
   */
  static isContextValid(): boolean {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  }

  /**
   * 安全地发送消息到 background
   */
  static async sendMessage(message: any): Promise<any> {
    if (!this.isContextValid()) {
      console.warn('[RuntimeUtils] Extension context invalidated, message not sent:', message.type);
      throw new Error('Extension context invalidated');
    }

    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error: any) {
      const errMsg = String(error?.message || error);
      if (errMsg.includes('context invalidated')) {
        console.warn('[RuntimeUtils] Detected context invalidation during sendMessage');
      }
      throw error;
    }
  }
}
