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
    // 已经带着明确处置建议的错误（例如 Gemini 的地区限制提示）直接透传，
    // 不要让下面的通用规则把它覆盖成泛泛的「鉴权失败」。
    if (errorMessage.includes('服务范围')) {
      return errorMessage;
    }

    if (/HTTP 40[13]\b|Unauthorized|Forbidden|invalid[_ ]?api[_ ]?key|incorrect api key/i.test(errorMessage)) {
      return `鉴权失败：API 密钥无效、已过期，或该密钥无权访问这个模型。请到「大模型配置」重新填写密钥，并用「测试连接」按钮验证。原始错误：${errorMessage}`;
    }

    if (/HTTP 404|not[_ ]?found|model route not found|model not found|does not exist/i.test(errorMessage)) {
      return `模型路由不存在（HTTP 404）：上游没有找到这个模型的调用路径，通常是「API 地址」或「模型名称」与服务商文档不一致。请检查：① API 地址是否为文档给出的基址（商汤 SenseNova 为 https://token.sensenova.cn/v1，漏掉 /v1 就会 404）；② 模型标识是否与文档一字不差（如 sensenova-6.8-flash-lite）；③ 该模型是否已在当前账户/套餐中开通。可在「大模型配置」点击「测试连接」快速验证。原始错误：${errorMessage}`;
    }

    return errorMessage;
  }
}
