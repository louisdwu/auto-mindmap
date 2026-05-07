import { ILLMAdapter, GenerateContext } from '../base';
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
    timeout: number,
    context?: GenerateContext
  ): Promise<string> {
    const apiUrl = this.getFullUrl(llmConfig);
    
    // 如果是 LM Studio，且不是反思阶段，添加防推理补丁
    let finalPrompt = prompt;
    if (llmConfig.provider === 'lmstudio' && !context?.isReflection) {
      finalPrompt += "\n\nIMPORTANT: Please output the mindmap in Markdown format directly. Do NOT include any reasoning, thinking process, or <thought> tags in your response. Jump straight to the Markdown content.";
    }

    const messages: any[] = [];
    const sysPrompt = context?.systemPrompt !== undefined ? context.systemPrompt : config.prompt.systemPrompt;
    if (sysPrompt && sysPrompt.trim()) {
      messages.push({ role: 'system', content: sysPrompt.trim() });
    }
    messages.push({ role: 'user', content: finalPrompt });

    const requestBody: any = {
      model: llmConfig.model.trim(),
      messages: messages,
      temperature: llmConfig.temperature ?? 0.7,
      max_tokens: llmConfig.maxTokens ?? 8192
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

    const response = await this.fetchWithRetry(apiUrl, {
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
    options?: { videoId?: string },
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
    
    // 强制指定识别语言（解决短音频识别为 cy 的问题）
    const langMap: Record<string, string> = {
      'zh-CN': 'zh',
      'zh-TW': 'zh',
      'en-US': 'en',
      'ja-JP': 'ja'
    };
    const whisperLang = langMap[config.settings.language] || config.settings.language?.split('-')[0];
    if (whisperLang) {
      formData.append('language', whisperLang);
      
      // 如果是中文，添加初始提示词以优化中英混说识别
      if (whisperLang === 'zh') {
        formData.append('initial_prompt', '这是一段中文视频的音频，其中可能包含部分专业英文单词或短语。');
      }
    }
    
    if (isLocal) {
      if (options?.videoId) {
        formData.append('video_id', options.videoId);
      }
      if (config.settings.asrBeamSize) formData.append('beam_size', config.settings.asrBeamSize.toString());
      if (config.settings.asrVadFilter !== undefined) formData.append('vad_filter', config.settings.asrVadFilter.toString());
    }

    if (isLocal) {
      formData.append('stream', 'true');
    }

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (!isLocal && llmConfig.apiKey) {
      headers['Authorization'] = `Bearer ${llmConfig.apiKey.trim()}`;
    }

    const response = await this.fetchWithRetry(apiUrl, {
      method: 'POST',
      headers,
      body: formData
    }, timeout);

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`识别失败 (HTTP ${response.status}): ${responseText}`);
    }

    // 如果是本地流式模式，手动解析流内容
    if (isLocal) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');
      
      const decoder = new TextDecoder();
      let resultText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          if (line.startsWith('JSON:')) {
            try {
              const json = JSON.parse(line.substring(5));
              resultText = json.text || '';
            } catch (e) {
              console.error('Failed to parse final JSON from stream:', e);
            }
          } else if (line.startsWith('ERROR:')) {
            throw new Error(line.substring(6));
          } else {
            // 普通日志，通过 onProgress 回传给 UI
            onProgress?.(line);
          }
        }
      }
      return resultText;
    }

    const data = await response.json();
    const text = data.text || '';
    
    if (text && onProgress) {
      const duration = data.duration ? `${data.duration.toFixed(2)}s` : '未知';
      const lang = data.language || '未知';
      const words = text.length;
      onProgress(`转录完成！语言: ${lang}, 耗时: ${duration}, 字数: ${words}`);
    }
    
    return text;
  }
}
