import { LLMProvider, PluginConfig } from '../types/config';
import { StorageService } from './storageService';
import { ILLMAdapter } from './llm/base';
import { OpenAIAdapter } from './llm/adapters/OpenAIAdapter';
import { GeminiAdapter } from './llm/adapters/GeminiAdapter';
import { OllamaAdapter } from './llm/adapters/OllamaAdapter';

export class LLMService {
  private static adapters: Record<string, ILLMAdapter> = {
    openai: new OpenAIAdapter(),
    custom: new OpenAIAdapter(),
    lmstudio: new OpenAIAdapter(),
    gemini: new GeminiAdapter(),
    ollama: new OllamaAdapter()
  };

  private static getAdapter(provider: LLMProvider): ILLMAdapter {
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new Error(`不支持的 LLM 提供商: ${provider}`);
    }
    return adapter;
  }

  /**
   * 构建完整的prompt
   */
  static buildPrompt(template: string, subtitleText: string, provider?: LLMProvider): string {
    let prompt = template.replace('{subtitle_content}', subtitleText);
    
    if (provider === 'lmstudio') {
      prompt += "\n\nIMPORTANT: Please output the mindmap in Markdown format directly. Do NOT include any reasoning, thinking process, or <thought> tags in your response. Jump straight to the Markdown content.";
    }
    
    return prompt;
  }

  /**
   * 调用大模型API生成思维导图
   */
  static async generateMindmap(
    config: PluginConfig,
    subtitleText: string
  ): Promise<string> {
    const llmConfig = await StorageService.getSelectedLLMConfig();
    if (!llmConfig) {
      throw new Error('未找到有效的 LLM 配置，请前往设置页面配置');
    }

    const provider = llmConfig.provider;
    const adapter = this.getAdapter(provider);
    const prompt = this.buildPrompt(config.prompt.template, subtitleText, provider);
    
    // 默认超时时间处理
    let defaultTimeoutSeconds = 60;
    if (provider === 'lmstudio') {
      defaultTimeoutSeconds = 180;
    }
    const timeout = (Number(llmConfig.timeout) || defaultTimeoutSeconds) * 1000;

    try {
      const content = await adapter.generateMindmap(config, llmConfig, prompt, timeout);
      
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('大模型返回的内容为空或不合法');
      }

      return content;
    } catch (error: any) {
      console.error(`[LLMService] 调用 ${provider} 失败:`, error);
      throw new Error(this.parseError(error));
    }
  }

  /**
   * 调用语音识别 API
   */
  static async transcribeAudio(
    config: PluginConfig,
    audioData: Blob | string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    // 如果配置为本地 ASR，强制使用 OpenAIAdapter 处理 (它内置了对 config.settings.localAsrUrl 的路由)
    if (config.settings.asrProvider === 'local') {
      const llmConfig = await StorageService.getSelectedLLMConfig();
      const adapter = this.adapters['openai']; // 使用 OpenAIAdapter 作为 ASR 调度器
      const timeout = 300000; // 5 分钟超时
      return adapter.transcribeAudio!(config, llmConfig!, audioData, timeout, onProgress);
    }

    // 官方/在线模式：使用当前选中的 LLM 提供商的适配器
    const llmConfig = await StorageService.getSelectedLLMConfig();
    if (!llmConfig) {
      throw new Error('未找到有效的 LLM 配置，请前往设置页面配置');
    }

    const adapter = this.getAdapter(llmConfig.provider);
    if (!adapter.transcribeAudio) {
      throw new Error(`当前提供商 ${llmConfig.provider} 不支持语音识别功能。请在设置中切换为“本地 ASR”或使用支持 Whisper 的提供商（如 OpenAI）。`);
    }

    const timeout = 300000; // 5 分钟超时
    return adapter.transcribeAudio(config, llmConfig, audioData, timeout, onProgress);
  }

  /**
   * 获取完整的请求 URL 预览
   */
  static getFullRequestUrl(provider: LLMProvider, apiUrl: string, model: string): string {
    if (!apiUrl) return '';

    if (provider === 'gemini') {
      // 复用逻辑或抽离到 Util
      return this.buildGeminiUrl(apiUrl, model, false);
    } else if (provider === 'ollama') {
      let url = apiUrl.trim();
      if (url.endsWith('/')) url = url.slice(0, -1);
      if (!url.endsWith('/chat') && !url.endsWith('/generate')) {
        url = `${url}/chat`;
      }
      return url;
    } else {
      // OpenAI 风格
      let url = apiUrl.trim();
      if (url.endsWith('/')) url = url.slice(0, -1);
      if ((provider === 'openai' || provider === 'lmstudio') && !url.endsWith('/chat/completions')) {
        url = url + '/chat/completions';
      }
      return url;
    }
  }

  /**
   * 辅助方法：构建 Gemini URL (保持向下兼容预览)
   */
  private static buildGeminiUrl(apiUrl: string, model: string, showApiKey: boolean): string {
    let url = apiUrl.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    const modelName = model || 'gemini-1.5-flash';
    if (!url.includes('/models/') && !url.includes(':generateContent')) {
      url = `${url}/models/${modelName}:generateContent`;
    } else if (url.includes('/models/') && !url.includes(':generateContent')) {
      url = `${url}:generateContent`;
    }
    const separator = url.includes('?') ? '&' : '?';
    if (!url.includes('key=')) {
      url = `${url}${separator}key=${showApiKey ? '{API_KEY}' : '***'}`;
    }
    return url;
  }

  /**
   * 区分错误类型并返回友好的错误信息
   */
  static parseError(error: any): string {
    let errorMessage = '';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }

    if (errorMessage.includes('fetch') || errorMessage.includes('网络')) {
      return `网络错误：无法连接到API服务器，请检查网络连接和API地址是否正确`;
    }
    if (errorMessage.includes('超时') || errorMessage.includes('timeout')) {
      return `请求超时，请检查服务状态或尝试调大超时时间`;
    }
    return errorMessage;
  }

  /**
   * 验证配置是否有效
   */
  static validateConfig(config: PluginConfig): { valid: boolean; error?: string } {
    if (!config.llm.apiUrl) return { valid: false, error: 'API地址不能为空' };
    if (!config.llm.apiKey && config.llm.provider !== 'lmstudio') return { valid: false, error: 'API密钥不能为空' };
    if (!config.llm.model) return { valid: false, error: '模型名称不能为空' };
    if (!config.prompt.template) return { valid: false, error: 'Prompt模板不能为空' };
    return { valid: true };
  }
}