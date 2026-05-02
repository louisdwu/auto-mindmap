/**
 * LLM 适配器基类，提供通用逻辑
 */
export abstract class BaseAdapter {
  /**
   * 带有指数退避重试机制的请求
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit,
    timeout: number,
    maxRetries: number = 3
  ): Promise<Response> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), timeout);

      try {
        if (attempt > 0) {
          console.log(`[BaseAdapter] 正在进行第 ${attempt} 次重试: ${url}`);
        }

        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        // 劫持响应体的读取，确保超时控制覆盖完整的数据传输
        const originalText = response.text.bind(response);
        response.text = async () => {
          try { return await originalText(); } finally { clearTimeout(timerId); }
        };
        const originalJson = response.json.bind(response);
        response.json = async () => {
          try { return await originalJson(); } finally { clearTimeout(timerId); }
        };

        // 检查是否需要重试
        if (response.ok) {
          return response;
        }

        const retryAfter = this.getRetryAfter(response);
        if (this.shouldRetry(response) && attempt < maxRetries) {
          const delay = retryAfter > 0 ? retryAfter : Math.pow(2, attempt) * 1000;
          console.warn(`[BaseAdapter] 请求失败 (HTTP ${response.status})，${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return response;
      } catch (error: any) {
        clearTimeout(timerId);
        lastError = error;

        const isTimeout = error.name === 'AbortError';
        const isNetworkError = error.message?.includes('fetch') || error.message?.includes('Network');

        if ((isTimeout || isNetworkError) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`[BaseAdapter] ${isTimeout ? '请求超时' : '网络错误'}，${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * 判断是否应该重试
   */
  private shouldRetry(response: Response): boolean {
    // 429 Too Many Requests 或 5xx Server Errors 值得重试
    return response.status === 429 || (response.status >= 500 && response.status <= 599);
  }

  /**
   * 尝试从响应头获取 retry-after
   */
  private getRetryAfter(response: Response): number {
    const retryAfter = response.headers.get('retry-after');
    if (!retryAfter) return 0;
    
    // 如果是秒数
    if (/^\d+$/.test(retryAfter)) {
      return parseInt(retryAfter, 10) * 1000;
    }
    
    // 如果是日期
    const date = Date.parse(retryAfter);
    if (!isNaN(date)) {
      return Math.max(0, date - Date.now());
    }
    
    return 0;
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
