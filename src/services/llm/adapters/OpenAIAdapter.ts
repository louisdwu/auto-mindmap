import { ILLMAdapter } from '../base';
import { LLMConfig, PluginConfig } from '../../../types/config';

export class OpenAIAdapter implements ILLMAdapter {
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

  private buildOpenAIUrl(url: string, provider: string): string {
    if (!url) return '';
    let apiUrl = url.trim();
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    
    if ((provider === 'openai' || provider === 'lmstudio') && !apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl + '/chat/completions';
    }
    return apiUrl;
  }

  async generateMindmap(
    config: PluginConfig,
    llmConfig: LLMConfig,
    prompt: string,
    timeout: number
  ): Promise<string> {
    const apiUrl = this.buildOpenAIUrl(llmConfig.apiUrl, llmConfig.provider);
    
    const messages: any[] = [];
    if (config.prompt.systemPrompt && config.prompt.systemPrompt.trim()) {
      messages.push({ role: 'system', content: config.prompt.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    const requestBody = {
      model: llmConfig.model.trim(),
      messages: messages,
      temperature: llmConfig.temperature ?? 0.7,
      max_tokens: llmConfig.maxTokens ?? 2000
    };

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (llmConfig.apiKey && llmConfig.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${llmConfig.apiKey.trim()}`;
    }

    const response = await this.fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    }, timeout);

    const responseText = await response.text();
    let data: any;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      throw new Error(`API 响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      const errorCode = response.status;
      let serverErrorMsg = data.error?.message || data.message || data.detail || responseText;
      throw new Error(`HTTP ${errorCode}: ${serverErrorMsg}`);
    }

    let content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text;
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content;

    if (!content || content.trim().length === 0) {
      if (reasoningContent && (reasoningContent.includes('#') || reasoningContent.includes('- '))) {
        content = reasoningContent;
      } else {
        throw new Error('API返回的数据格式不正确：模型未返回有效的思维导图内容。');
      }
    }

    return content;
  }

  async transcribeAudio(
    config: PluginConfig,
    llmConfig: LLMConfig,
    audioData: Blob | string,
    timeout: number,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const isLocal = config.settings.asrProvider === 'local';
    const apiUrl = isLocal 
      ? config.settings.localAsrUrl 
      : this.buildOpenAIUrl(llmConfig.apiUrl, llmConfig.provider).replace('/chat/completions', '/audio/transcriptions');

    onProgress?.('正在上传音频并识别中 (可能需要 15-60s)...');

    const formData = new FormData();
    if (typeof audioData === 'string') {
      formData.append('audio_url', audioData);
    } else {
      formData.append('file', audioData, 'audio.mp3');
    }
    
    formData.append('model', isLocal ? 'large-v2' : 'whisper-1');
    formData.append('response_format', 'json');
    
    if (isLocal) {
      if (config.settings.asrBeamSize) formData.append('beam_size', config.settings.asrBeamSize.toString());
      if (config.settings.asrVadFilter !== undefined) formData.append('vad_filter', config.settings.asrVadFilter.toString());
    }

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (!isLocal && llmConfig.apiKey) {
      headers['Authorization'] = `Bearer ${llmConfig.apiKey.trim()}`;
    }

    const response = await this.fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers,
      body: formData
    }, timeout);

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`识别失败 (HTTP ${response.status}): ${responseText}`);
    }

    const data = await response.json();
    return data.text || '';
  }
}
