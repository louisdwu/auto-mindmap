import { LLMProvider, PluginConfig } from '../types/config';

// 超时时间（毫秒）
const DEFAULT_TIMEOUT = 30000;

export class LLMService {
  /**
   * 构建完整的prompt
   */
  static buildPrompt(template: string, subtitleText: string, provider?: LLMProvider): string {
    let prompt = template.replace('{subtitle_content}', subtitleText);
    
    // 如果是 LM Studio 且可能存在推理模型，追加禁止推理的指令
    if (provider === 'lmstudio') {
      prompt += "\n\nIMPORTANT: Please output the mindmap in Markdown format directly. Do NOT include any reasoning, thinking process, or <thought> tags in your response. Jump straight to the Markdown content.";
    }
    
    return prompt;
  }

  /**
   * 带超时的fetch请求
   *
   * 使用 Promise.race 实现超时，避免在 Chrome 扩展 service worker 中
   * AbortController 可能导致的问题。
   */
  private static async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number = DEFAULT_TIMEOUT
  ): Promise<Response> {
    console.log(`[LLMService] 发起请求: ${url}, 超时: ${timeout/1000}s`);
    
    // 创建超时 Promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`请求超时（${timeout / 1000}秒），请检查网络连接或API服务是否正常`));
      }, timeout);
    });

    try {
      // 使用 Promise.race 实现超时控制
      const response = await Promise.race([
        fetch(url, options),
        timeoutPromise
      ]);
      
      console.log(`[LLMService] 响应状态: ${response.status}`);
      return response;
    } catch (error: any) {
      console.error(`[LLMService] 请求失败:`, error);
      
      // 提供更详细的错误信息
      if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
        throw new Error(`网络请求失败：无法连接到 ${new URL(url).hostname}，请检查网络连接和API地址`);
      }
      
      throw error;
    }
  }

  /**
   * 区分错误类型并返回友好的错误信息
   */
  static parseError(error: any): string {
    // 确保获取到有意义的错误信息
    let errorMessage = '';
    
    if (error instanceof Error) {
      errorMessage = error.message || error.name || 'Unknown Error';
      // 如果有 cause，也包含进来 (ES2022 特性，需要类型断言)
      const errorWithCause = error as Error & { cause?: unknown };
      if (errorWithCause.cause) {
        errorMessage += ` (${String(errorWithCause.cause)})`;
      }
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object') {
      errorMessage = error.message || error.error || JSON.stringify(error);
    } else {
      errorMessage = String(error) || 'Unknown Error';
    }
    
    // 如果错误信息太简短或无意义，给出更多上下文
    if (!errorMessage || errorMessage === 'Error' || errorMessage === 'undefined' || errorMessage === 'null') {
      errorMessage = '未知错误，请检查网络连接和API配置';
    }
    
    // 网络错误
    if (errorMessage.includes('fetch') || errorMessage.includes('网络') || errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
      return `网络错误：无法连接到API服务器，请检查网络连接和API地址是否正确`;
    }
    
    // 超时错误
    if (errorMessage.includes('超时') || errorMessage.includes('timeout') || errorMessage.includes('Timeout') || errorMessage.includes('AbortError')) {
      return `请求超时：${errorMessage}`;
    }
    
    // CORS 错误
    if (errorMessage.includes('CORS') || errorMessage.includes('cross-origin') || errorMessage.includes('Access-Control')) {
      return `跨域错误：API服务器不允许跨域请求，请检查API配置`;
    }
    
    // API错误
    if (errorMessage.includes('API') || errorMessage.includes('api') || errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('429')) {
      return `API错误：${errorMessage}`;
    }
    
    // 内容为空
    if (errorMessage.includes('为空') || errorMessage.includes('empty') || errorMessage.includes('no content')) {
      return `大模型返回内容为空：请检查Prompt模板或尝试重新生成`;
    }
    
    // 默认错误
    return `调用大模型失败：${errorMessage}`;
  }

  /**
   * 调用大模型API生成思维导图
   */
  static async generateMindmap(
    config: PluginConfig,
    subtitleText: string
  ): Promise<string> {
    const prompt = this.buildPrompt(config.prompt.template, subtitleText, config.llm.provider);
    
    // 针对本地 LM Studio 默认给予更长的超时时间 (180s)
    let defaultTimeoutSeconds = 60;
    if (config.llm.provider === 'lmstudio') {
      defaultTimeoutSeconds = 180;
    }
    
    const timeout = (Number(config.llm.timeout) || defaultTimeoutSeconds) * 1000;

    try {
      let content: string;

      if (config.llm.provider === 'gemini') {
        content = await this.callGeminiAPI(config, prompt, timeout);
      } else if (config.llm.provider === 'ollama') {
        content = await this.callOllamaAPI(config, prompt, timeout);
      } else {
        // OpenAI 兼容格式（包括自定义 API 和 LM Studio）
        content = await this.callOpenAICompatibleAPI(config, prompt, timeout);
      }

      console.log('[LLMService] 成功获取大模型响应');

      // 验证返回内容
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('大模型返回的内容为空或不合法');
      }

      return content;
    } catch (error: any) {
      const friendlyError = this.parseError(error);
      console.error('调用大模型API失败:', error);
      throw new Error(friendlyError);
    }
  }

  /**
   * 调用语音识别 API (本地 or Whisper)
   */
  static async transcribeAudio(
    config: PluginConfig,
    audioData: Blob | string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const isLocal = config.settings.asrProvider === 'local';
    const apiUrl = isLocal 
      ? config.settings.localAsrUrl 
      : this.buildOpenAIUrl(config.llm.apiUrl, config.llm.provider).replace('/chat/completions', '/audio/transcriptions');

    const timeout = 300000; // 语音识别较慢，给 5 分钟超时

    onProgress?.('正在上传音频并识别中 (可能需要 15-60s)...');

    const formData = new FormData();
    if (typeof audioData === 'string') {
      // 如果是 URL，直接传给后端
      formData.append('audio_url', audioData);
    } else {
      // 如果是 Blob，上传文件
      formData.append('file', audioData, 'audio.mp3');
    }
    
    formData.append('model', isLocal ? 'large-v2' : 'whisper-1');
    formData.append('response_format', 'json');
    
    // 如果是本地 ASR，透传性能参数
    if (isLocal) {
      if (config.settings.asrBeamSize) {
        formData.append('beam_size', config.settings.asrBeamSize.toString());
      }
      if (config.settings.asrVadFilter !== undefined) {
        formData.append('vad_filter', config.settings.asrVadFilter.toString());
      }
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    if (!isLocal && config.llm.apiKey) {
      headers['Authorization'] = `Bearer ${config.llm.apiKey.trim()}`;
    }

    const response = await this.fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers,
      body: formData
    }, timeout);

    if (!response.ok) {
      const responseText = await response.text();
      let serverError = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        serverError = errorJson.error || errorJson.message || responseText;
      } catch (e) {
        // 如果不是 JSON，使用原始文本
      }
      throw new Error(`识别失败 (HTTP ${response.status}): ${serverError}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`ASR 服务报错: ${data.error}`);
    }
    return data.text || '';
  }

  /**
   * 构建 OpenAI 兼容的 API URL
   *
   * 只对 OpenAI 提供商自动补全 /chat/completions 路径
   * 自定义提供商保持用户输入的完整 URL
   */
  static buildOpenAIUrl(url: string, provider: LLMProvider): string {
    if (!url) return '';
    let apiUrl = url.trim();

    // 移除末尾的斜杠
    if (apiUrl.endsWith('/')) {
      apiUrl = apiUrl.slice(0, -1);
    }

    // 只对 OpenAI 提供商自动补全路径
    if ((provider === 'openai' || provider === 'lmstudio') && !apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl + '/chat/completions';
    }
    // 自定义提供商保持原样，不自动补全

    return apiUrl;
  }

  /**
   * 调用 OpenAI 兼容的 API
   */
  private static async callOpenAICompatibleAPI(
    config: PluginConfig,
    prompt: string,
    timeout: number
  ): Promise<string> {
    // 使用简单的 URL 构建逻辑
    const apiUrl = this.buildOpenAIUrl(config.llm.apiUrl, config.llm.provider);

    console.log(`[LLMService] 正在发起 OpenAI 兼容请求:`);
    console.log(`[LLMService] - URL: ${apiUrl}`);
    console.log(`[LLMService] - Model: ${config.llm.model.trim()}`);
    console.log(`[LLMService] - API Key: ${config.llm.apiKey ? config.llm.apiKey.substring(0, 8) + '...' : '(空)'}`);
    console.log(`[LLMService] - API Key 长度: ${config.llm.apiKey?.length || 0}`);
    
    const messages: any[] = [];
    
    // 如果有 System Prompt，作为第一个消息发送
    if (config.prompt.systemPrompt && config.prompt.systemPrompt.trim()) {
      messages.push({
        role: 'system',
        content: config.prompt.systemPrompt.trim()
      });
    }

    messages.push({
      role: 'user',
      content: prompt
    });

    const requestBody = {
      model: config.llm.model.trim(),
      messages: messages,
      temperature: config.llm.temperature ?? 0.7,
      max_tokens: config.llm.maxTokens ?? 2000
    };
    
    console.log(`[LLMService] - Request body size: ${JSON.stringify(requestBody).length} bytes`);
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // 只有在 API Key 非空时才发送 Authorization 头
    if (config.llm.apiKey && config.llm.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.llm.apiKey.trim()}`;
    }
    
    const response = await this.fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    }, timeout);

    let data: any;
    const responseText = await response.text();
    
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      console.error('[LLMService] Failed to parse JSON response:', responseText);
      throw new Error(`API 响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      const errorCode = response.status;
      console.error(`[LLMService] API 错误响应 (${errorCode}):`, responseText);
      console.error(`[LLMService] 解析后的错误数据:`, data);
      
      // 尝试从响应中获取错误信息
      let serverErrorMsg = data.error?.message || data.message || data.detail || '';
      if (typeof data.error === 'string') {
        serverErrorMsg = data.error;
      }
      
      let errorMsg = serverErrorMsg || '调用大模型API失败';

      // 根据状态码提供更详细的错误信息
      if (errorCode === 401) {
        errorMsg = serverErrorMsg || 'API密钥无效或已过期，请检查配置';
      } else if (errorCode === 403) {
        errorMsg = serverErrorMsg || 'API访问被拒绝，请检查API权限';
      } else if (errorCode === 429) {
        errorMsg = serverErrorMsg || 'API请求过于频繁，请稍后重试';
      } else if (errorCode >= 500) {
        errorMsg = serverErrorMsg || `API服务器错误（${errorCode}），请稍后重试`;
      }

      throw new Error(`HTTP ${errorCode}: ${errorMsg}`);
    }

    // 提取思维导图内容
    // 1. 标准 OpenAI 格式: choices[0].message.content
    let content = data.choices?.[0]?.message?.content;
    
    // 2. 兼容传统的 completions 格式: choices[0].text
    if (!content && data.choices?.[0]?.text) {
      content = data.choices[0].text;
    }

    // 3. 针对推理型模型（如 R1/Qwen-Reasoning）的特殊处理
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content;
    const finishReason = data.choices?.[0]?.finish_reason;

    if (!content || content.trim().length === 0) {
      if (finishReason === 'length') {
        // 特殊处理：如果推理内容占满了 4096 但已经开始输出 Markdown，尝试强行截取
        if (reasoningContent && (reasoningContent.includes('#') || reasoningContent.includes('- '))) {
          console.warn('[LLMService] Token 耗尽，但推理内容中包含部分结果，进行强行提取');
          return reasoningContent; 
        }
        throw new Error('模型思维输出（Reasoning）过长，导致思维导图内容被挤出。请在插件设置中将 Max Tokens 调大到 8192 或以上，或更换非推理模型。');
      }
      
      // 如果正常内容为空但推理内容不为空，且推理内容看起来包含了结果，进行兜底
      if (reasoningContent && (reasoningContent.includes('#') || reasoningContent.includes('- '))) {
        console.warn('[LLMService] 正文内容为空，尝试从推理内容中提取结果');
        content = reasoningContent;
      } else {
        throw new Error('API返回的数据格式不正确：模型未返回有效的思维导图内容。');
      }
    }

    return content;
  }

  /**
   * 调用 Gemini API
   */
  private static async callGeminiAPI(
    config: PluginConfig,
    prompt: string,
    timeout: number
  ): Promise<string> {
    console.log(`[LLMService] 正在发起 Gemini 请求:`);
    console.log(`[LLMService] - API Key: ${config.llm.apiKey ? config.llm.apiKey.substring(0, 8) + '...' : '(空)'}`);
    console.log(`[LLMService] - API Key 长度: ${config.llm.apiKey?.length || 0}`);
    
    // 构建API URL
    let apiUrl = config.llm.apiUrl.trim();
    if (apiUrl.endsWith('/')) {
      apiUrl = apiUrl.slice(0, -1);
    }
    const modelName = config.llm.model || 'gemini-pro';

    // 检查 URL 是否已经是完整端点
    const hasModelsPath = apiUrl.includes('/models/');
    const hasGenerateContent = apiUrl.includes(':generateContent');

    if (!hasModelsPath && !hasGenerateContent) {
      // 如果用户只提供了基础 URL，构建完整的端点
      apiUrl = `${apiUrl}/models/${modelName}:generateContent`;
    } else if (hasModelsPath && !hasGenerateContent) {
      // 如果 URL 包含 /models/ 但没有 :generateContent，追加生成内容端点
      apiUrl = `${apiUrl}:generateContent`;
    }
    // 否则保持用户输入的完整 URL 不变

    // 统一处理 API Key 附加
    const separator = apiUrl.includes('?') ? '&' : '?';
    if (!apiUrl.includes('key=')) {
      apiUrl = `${apiUrl}${separator}key=${config.llm.apiKey}`;
    }

    const requestBody: any = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: config.llm.temperature ?? 0.7,
        maxOutputTokens: config.llm.maxTokens ?? 2000
      }
    };

    // Gemini 原生支持 system_instruction
    if (config.prompt.systemPrompt && config.prompt.systemPrompt.trim()) {
      requestBody.system_instruction = {
        parts: [
          {
            text: config.prompt.systemPrompt.trim()
          }
        ]
      };
    }

    const response = await this.fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }, timeout);

    let data: any;
    const responseText = await response.text();
    
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      console.error('[LLMService] Failed to parse Gemini JSON response:', responseText);
      throw new Error(`Gemini API 响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      const errorCode = response.status;
      let errorMsg = data.error?.message || data.error?.status || '调用 Gemini API 失败';

      // 根据状态码提供更详细的错误信息
      if (errorCode === 401) {
        errorMsg = 'API密钥无效或已过期，请检查配置';
      } else if (errorCode === 403) {
        if (errorMsg.toLowerCase().includes('location is not supported')) {
          errorMsg = '您的 IP 所在地区不在 Google Gemini 的服务范围内（如中国大陆）。请开启“全局代理”或在 API 地址处填写可用的“反向代理地址”。';
        } else {
          errorMsg = 'API访问被拒绝，请检查API权限或配额';
        }
      } else if (errorCode === 429) {
        errorMsg = 'API请求过于频繁，请稍后重试';
      } else if (errorCode >= 500) {
        errorMsg = `Gemini 服务器错误（${errorCode}），请稍后重试`;
      }

      throw new Error(errorMsg);
    }

    // 提取思维导图内容
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Gemini API 返回的数据格式不正确');
    }

    return content;
  }

  /**
   * 调用 Ollama API (支持本地及云端)
   */
  private static async callOllamaAPI(
    config: PluginConfig,
    prompt: string,
    timeout: number
  ): Promise<string> {
    console.log(`[LLMService] 正在发起 Ollama 请求:`);
    
    // 构建 API URL
    let apiUrl = config.llm.apiUrl.trim();
    if (apiUrl.endsWith('/')) {
      apiUrl = apiUrl.slice(0, -1);
    }
    
    // 检查是否包含端点，如果不包含则补全为 /chat (这是 Ollama 原生的 JSON API)
    if (!apiUrl.endsWith('/chat') && !apiUrl.endsWith('/generate')) {
      apiUrl = `${apiUrl}/chat`;
    }

    const messages: any[] = [];
    if (config.prompt.systemPrompt && config.prompt.systemPrompt.trim()) {
      messages.push({
        role: 'system',
        content: config.prompt.systemPrompt.trim()
      });
    }
    messages.push({
      role: 'user',
      content: prompt
    });

    const requestBody = {
      model: config.llm.model.trim(),
      messages: messages,
      stream: false, // 禁用流式输出
      options: {
        temperature: config.llm.temperature ?? 0.7,
        num_predict: config.llm.maxTokens ?? 4096
      }
    };

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // 如果提供了 API Key (Ollama Cloud 需要)，则添加
    if (config.llm.apiKey && config.llm.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.llm.apiKey.trim()}`;
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
      throw new Error(`Ollama API 响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      if (response.status === 405) {
        throw new Error(`Method Not Allowed (405): 请检查 API 地址是否正确。如果使用 Ollama Cloud，请确保地址为 https://ollama.com/api/chat 并带上 API Key。`);
      }
      throw new Error(data.error || `Ollama API 错误 (HTTP ${response.status})`);
    }

    // 提取内容 (Ollama 原生响应格式为 message.content)
    const content = data.message?.content || data.response;
    if (!content) {
      throw new Error('Ollama API 未返回有效内容');
    }

    return content;
  }

  /**
   * 构建 Gemini API URL（用于预览）
   *
   * @param apiUrl 用户输入的 API URL
   * @param model 模型名称
   * @param showApiKey 是否显示 API Key（用于预览时隐藏）
   */
  static buildGeminiUrl(apiUrl: string, model: string, showApiKey: boolean = false): string {
    if (!apiUrl) return '';
    
    let url = apiUrl.trim();
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    const modelName = model || 'gemini-pro';

    // 检查 URL 是否已经是完整端点
    const hasModelsPath = url.includes('/models/');
    const hasGenerateContent = url.includes(':generateContent');

    if (!hasModelsPath && !hasGenerateContent) {
      // 如果用户只提供了基础 URL，构建完整的端点
      url = `${url}/models/${modelName}:generateContent`;
    } else if (hasModelsPath && !hasGenerateContent) {
      // 如果 URL 包含 /models/ 但没有 :generateContent，追加生成内容端点
      url = `${url}:generateContent`;
    }

    // 添加 key 参数占位符
    const separator = url.includes('?') ? '&' : '?';
    if (!url.includes('key=')) {
      url = `${url}${separator}key=${showApiKey ? '{API_KEY}' : '***'}`;
    }

    return url;
  }

  /**
   * 获取完整的请求 URL 预览
   *
   * 根据提供商类型返回实际请求时会使用的完整 URL
   */
  static getFullRequestUrl(provider: LLMProvider, apiUrl: string, model: string): string {
    if (!apiUrl) return '';

    if (provider === 'gemini') {
      return this.buildGeminiUrl(apiUrl, model, false);
    } else if (provider === 'ollama') {
      let url = apiUrl.trim();
      if (url.endsWith('/')) url = url.slice(0, -1);
      if (!url.endsWith('/chat') && !url.endsWith('/generate')) {
        url = `${url}/chat`;
      }
      return url;
    } else {
      return this.buildOpenAIUrl(apiUrl, provider);
    }
  }

  /**
   * 验证配置是否有效
   */
  static validateConfig(config: PluginConfig): { valid: boolean; error?: string } {
    if (!config.llm.apiUrl) {
      return { valid: false, error: 'API地址不能为空' };
    }

    if (!config.llm.apiKey && config.llm.provider !== 'lmstudio') {
      return { valid: false, error: 'API密钥不能为空' };
    }

    if (!config.llm.model) {
      return { valid: false, error: '模型名称不能为空' };
    }

    if (!config.prompt.template) {
      return { valid: false, error: 'Prompt模板不能为空' };
    }

    return { valid: true };
  }
}