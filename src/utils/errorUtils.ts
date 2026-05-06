export class ErrorUtils {
  /**
   * 区分错误类型并返回友好的错误信息
   */
  static parseError(error: any): string {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('fetch') || errorMessage.includes('网络') || errorMessage.includes('Failed to fetch')) {
      return `网络错误：无法连接到 API 服务器 (${errorMessage})，请检查网络连接、API 地址或 CORS 设置。系统已尝试自动重试，但未能成功。`;
    }
    if (errorMessage.includes('超时') || errorMessage.includes('timeout') || errorMessage.includes('AbortError')) {
      return `请求超时，请检查服务状态或在设置中调大超时时间。系统已尝试重试，但请求仍未在预定时间内完成。`;
    }
    if (errorMessage.includes('exceeds the available context size') || errorMessage.includes('try increasing it')) {
      const match = errorMessage.match(/request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/i);
      if (match) {
        return `上下文长度超限：当前请求需要 ${match[1]} tokens，但本地模型仅允许 ${match[2]} tokens。请在 LM Studio 的 Server Configuration 中调大 "Context Length" 并重新加载模型。`;
      }
      return `上下文长度超限：当前发送的内容过多。请在本地大模型服务（如 LM Studio）中调大上下文窗口长度 (Context Length) 并重新加载模型。`;
    }
    return errorMessage;
  }
}
