/**
 * LLM 适配器基类，提供通用逻辑
 */
export abstract class BaseAdapter {
  /**
   * 带有超时控制的 fetch 请求
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      // 劫持 text 和 json 方法，确保在读取完响应体后才清除超时定时器
      // 这样可以防止服务端建立连接后一直不返回数据（流挂起）导致的无尽等待
      const originalText = response.text.bind(response);
      response.text = async () => {
        try { return await originalText(); } finally { clearTimeout(id); }
      };

      const originalJson = response.json.bind(response);
      response.json = async () => {
        try { return await originalJson(); } finally { clearTimeout(id); }
      };

      return response;
    } catch (error: any) {
      clearTimeout(id);
      if (error.name === 'AbortError') {
        throw new Error(`请求超时（${timeout / 1000}秒），请检查网络连接或API服务是否正常`);
      }
      throw error;
    }
  }

  /**
   * 标准化 URL，确保没有多余的斜杠
   */
  protected normalizeUrl(url: string): string {
    let result = url.trim();
    if (result.endsWith('/')) {
      result = result.slice(0, -1);
    }
    return result;
  }

  /**
   * 默认的 Prompt 预处理（子类可重写）
   */
  preprocessPrompt(prompt: string): string {
    return prompt;
  }
}
