import { ILLMAdapter } from '../base';
import { BaseAdapter } from '../BaseAdapter';
import { LLMConfig, PluginConfig } from '../../../types/config';

export class OpenAIAdapter extends BaseAdapter implements ILLMAdapter {
  /**
   * 获取完整的 API 请求 URL
   */
  getFullUrl(llmConfig: LLMConfig): string {
    let apiUrl = this.normalizeUrl(llmConfig.apiUrl);
    const provider = llmConfig.provider;
    
    if ((provider === 'openai' || provider === 'lmstudio' || provider === 'custom') && !apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl + '/chat/completions';
    }
    return apiUrl;
  }

  /**
   * 针对不同提供商预处理 Prompt
   */
  override preprocessPrompt(prompt: string): string {
    // 逻辑原先在 LLMService 中，现在下沉到 Adapter
    // 针对 LM Studio 的特殊补丁，防止其输出推理过程
    if (prompt.includes('lmstudio')) { // 注意：这里的判断逻辑可能需要由外部传入 provider 信息，或者 Adapter 实例化时已知
       // 在 generateMindmap 中处理更准确
    }
    return prompt;
  }

  async generateMindmap(
    config: PluginConfig,
    llmConfig: LLMConfig,
    prompt: string,
    timeout: number
  ): Promise<string> {
    const apiUrl = this.getFullUrl(llmConfig);
    
    // 如果是 LM Studio，添加防推理补丁
    let finalPrompt = prompt;
    if (llmConfig.provider === 'lmstudio') {
      finalPrompt += "\n\nIMPORTANT: Please output the mindmap in Markdown format directly. Do NOT include any reasoning, thinking process, or <thought> tags in your response. Jump straight to the Markdown content.";
    }

    const messages: any[] = [];
    if (config.prompt.systemPrompt && config.prompt.systemPrompt.trim()) {
      messages.push({ role: 'system', content: config.prompt.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: finalPrompt });

    const requestBody: any = {
      model: llmConfig.model.trim(),
      messages: messages,
      temperature: llmConfig.temperature ?? 0.7,
      max_tokens: llmConfig.maxTokens ?? 2000
    };

    // 针对 LM Studio 或自定义 OpenAI 兼容后端，尝试传递上下文长度
    if (llmConfig.provider === 'lmstudio' || llmConfig.provider === 'custom') {
      if (llmConfig.num_ctx) {
        requestBody.num_ctx = llmConfig.num_ctx;
        requestBody.context_length = llmConfig.num_ctx; // 兼容不同后端
      }
    }

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
      : this.getFullUrl(llmConfig).replace('/chat/completions', '/audio/transcriptions');

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
