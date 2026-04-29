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
        num_predict: llmConfig.maxTokens ?? 4096,
        num_ctx: llmConfig.num_ctx || 4096
      }
    };

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (llmConfig.apiKey && llmConfig.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${llmConfig.apiKey.trim()}`;
    }

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    }, timeout);

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

    const content = data.message?.content || data.response;
    if (!content) throw new Error('Ollama API 未返回有效内容');
    return content;
  }
}
