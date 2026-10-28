import { createAbortError, isAbortError } from '../../utils/abort';

/**
 * LLM 适配器基类，提供通用逻辑
 */
export abstract class BaseAdapter {
  /**
   * 带回退重试与取消能力的请求。
   *
   * 超时与外部取消共用同一个内部 AbortController：
   * - 超时：按指数退避重试；
   * - 外部取消（用户点「取消任务」）：立即抛 AbortError，不重试。
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit,
    timeout: number,
    maxRetries: number = 3,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    if (externalSignal?.aborted) throw createAbortError();

    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (externalSignal?.aborted) throw createAbortError();

      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), timeout);
      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timerId);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      };

      try {
        if (attempt > 0) {
          console.log(`[BaseAdapter] 正在进行第 ${attempt} 次重试: ${url}`);
        }

        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        // 劫持响应体读取，确保超时/取消控制覆盖完整的数据传输
        const originalText = response.text.bind(response);
        response.text = async () => {
          try { return await originalText(); } finally { cleanup(); }
        };
        const originalJson = response.json.bind(response);
        response.json = async () => {
          try { return await originalJson(); } finally { cleanup(); }
        };

        if (externalSignal?.aborted) throw createAbortError();

        if (response.ok) {
          return response;
        }

        const retryAfter = this.getRetryAfter(response);
        if (this.shouldRetry(response) && attempt < maxRetries) {
          const delay = retryAfter > 0 ? retryAfter : Math.pow(2, attempt) * 1000;
          console.warn(`[BaseAdapter] 请求失败 (HTTP ${response.status})，${delay}ms 后重试...`);
          cleanup();
          await this.sleep(delay, externalSignal);
          continue;
        }

        // 错误响应留给调用方读取 text()；包装器会负责清理计时器
        return response;
      } catch (error: any) {
        cleanup();

        if (externalSignal?.aborted) throw createAbortError();

        lastError = error;
        const isTimeout = isAbortError(error);
        const isNetworkError = error?.message?.includes('fetch') || error?.message?.includes('Network');

        if ((isTimeout || isNetworkError) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`[BaseAdapter] ${isTimeout ? '请求超时' : '网络错误'}，${delay}ms 后重试...`);
          await this.sleep(delay, externalSignal);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /** 可取消的退避等待 */
  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await new Promise(resolve => setTimeout(resolve, ms));
      return;
    }
    if (signal.aborted) throw createAbortError();

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(createAbortError());
      };
      timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * 判断是否应该重试
   */
  private shouldRetry(response: Response): boolean {
    return response.status === 429 || (response.status >= 500 && response.status <= 599);
  }

  /**
   * 尝试从响应头获取 retry-after
   */
  private getRetryAfter(response: Response): number {
    const retryAfter = response.headers.get('retry-after');
    if (!retryAfter) return 0;

    if (/^\d+$/.test(retryAfter)) {
      return parseInt(retryAfter, 10) * 1000;
    }

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
