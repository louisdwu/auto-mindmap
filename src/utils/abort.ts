/**
 * 统一的任务取消错误。
 *
 * 使用 DOMException('...', 'AbortError') 是为了让 fetch / 各适配器与浏览器
 * 原生的取消语义保持一致：调用方只需检查 name === 'AbortError'。
 */
export function createAbortError(message: string = '任务已取消'): DOMException {
  return new DOMException(message, 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as any).name === 'AbortError';
}

/** 在不可中断的 await 边界后补一次取消检查 */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw createAbortError();
}
