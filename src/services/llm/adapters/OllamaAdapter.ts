import { ILLMAdapter } from '../base';
import { LLMConfig, PluginConfig } from '../../../types/config';

export class OllamaAdapter implements ILLMAdapter {
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number
  ): Promise<Response> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`请求超时（${timeout / 1000}秒），请检查网络连接或API服务是否正常`));
      }, timeout);
    });

    const response = await Promise.race([
      fetch(url, options),
      timeoutPromise
    ]);
    return response as Response;
  }

  async generateMindmap(
    config: PluginConfig,
    llmConfig: LLMConfig,
    prompt: string,
    timeout: number
  ): Promise<string> {
    let url = llmConfig.apiUrl.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    
    if (!url.endsWith('/chat') && !url.endsWith('/generate')) {
      url = `${url}/chat`;
    }

    const messages: any[] = [];
    if (config.prompt.systemPrompt && config.prompt.systemPrompt.trim()) {
      messages.push({ role: 'system', content: config.prompt.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    const requestBody = {
      model: llmConfig.model.trim(),
      messages: messages,
      stream: false,
      options: {
        temperature: llmConfig.temperature ?? 0.7,
        num_predict: llmConfig.maxTokens ?? 4096
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
