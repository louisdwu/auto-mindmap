import { ILLMAdapter, GenerateContext } from '../base';
import { BaseAdapter } from '../BaseAdapter';
import { LLMConfig, PluginConfig } from '../../../types/config';

export class OllamaAdapter extends BaseAdapter implements ILLMAdapter {
  /**
   * 获取完整的 API 请求 URL (Ollama)
   */
  getFullUrl(llmConfig: LLMConfig): string {
    let url = this.normalizeUrl(llmConfig.apiUrl);
    
    // 如果没有指定具体 endpoint，默认使用 /api/chat
    if (!url.endsWith('/chat') && !url.endsWith('/generate') && !url.endsWith('/api/chat') && !url.endsWith('/api/generate')) {
      url = url.includes('/api') ? `${url}/chat` : `${url}/api/chat`;
    }
    return url;
  }

  /**
   * 由 api 基址推出模型列表地址（Ollama 的模型清单在 /api/tags）
   */
  getTagsUrl(llmConfig: LLMConfig): string {
    const url = this.normalizeUrl(llmConfig.apiUrl).replace(/\/(chat|generate)$/, '');
    return url.includes('/api') ? `${url}/tags` : `${url}/api/tags`;
  }

  /**
   * 列出本地/云端已安装的模型，用于连通性测试时给出可替换项
   */
  async listModels(llmConfig: LLMConfig, timeout: number): Promise<string[]> {
    const response = await this.fetchWithRetry(
      this.getTagsUrl(llmConfig),
      { method: 'GET', headers: { Accept: 'application/json' } },
      timeout
    );
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`获取模型列表失败 (HTTP ${response.status}): ${responseText.slice(0, 200)}`);
    }

    let data: any;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error('模型列表响应不是合法 JSON');
    }

    const list = Array.isArray(data?.models) ? data.models : [];
    return list
      .map((item: any) => item?.name || item?.model)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  }

  async generateMindmap(
    config: PluginConfig,
    llmConfig: LLMConfig,
    prompt: string,
    timeout: number,
    context?: GenerateContext
  ): Promise<string> {
    const url = this.getFullUrl(llmConfig);

    const messages: any[] = [];
    const sysPrompt = context?.systemPrompt !== undefined ? context.systemPrompt : config.prompt.systemPrompt;
    if (sysPrompt && sysPrompt.trim()) {
      messages.push({ role: 'system', content: sysPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    const requestBody = {
      model: llmConfig.model.trim(),
      messages: messages,
      stream: false,
      options: {
        temperature: llmConfig.temperature ?? 0.7,
        num_predict: llmConfig.maxTokens ?? 8192,
        num_ctx: llmConfig.num_ctx || 16384
      }
    };

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (llmConfig.apiKey && llmConfig.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${llmConfig.apiKey.trim()}`;
    }

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    }, timeout, 3, context?.signal);

    const responseText = await response.text();
    let data: any;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      throw new Error(`Ollama API 响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      throw new Error(`Ollama API 错误 (HTTP ${response.status}): ${data.error || responseText}`);
    }

    if (typeof data.prompt_eval_count === 'number' || typeof data.eval_count === 'number') {
      context?.onUsage?.({
        inputTokens: Number(data.prompt_eval_count) || 0,
        outputTokens: Number(data.eval_count) || 0
      });
    }

    const content = data.message?.content || data.response;
    if (!content) throw new Error('Ollama API 未返回有效内容');
    return content;
  }
}