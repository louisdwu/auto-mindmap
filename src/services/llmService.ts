import { LLMProvider, PluginConfig, LLMConfig } from '../types/config';
import { StorageService } from './storageService';
import { ILLMAdapter } from './llm/base';
import { OpenAIAdapter } from './llm/adapters/OpenAIAdapter';
import { GeminiAdapter } from './llm/adapters/GeminiAdapter';
import { OllamaAdapter } from './llm/adapters/OllamaAdapter';
import { LoggerService } from './loggerService';

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
   * 构建基础 Prompt
   */
  static buildPrompt(template: string, subtitleText: string): string {
    return template.replace('{subtitle_content}', subtitleText);
  }

  /**
   * 调用大模型 API 生成思维导图
   */
  static async generateMindmap(
    config: PluginConfig,
    subtitleText: string,
    onProgress?: (msg: string) => void,
    onPhase1Complete?: (initialMindmap: string) => Promise<void>,
    cachedInitialMindmap?: string
  ): Promise<{ result: string, initialResult?: string }> {
    const isReflectionEnabled = config.settings.enableReflection;

    if (!isReflectionEnabled) {
      const result = cachedInitialMindmap || await this.generateSinglePhase(config, subtitleText);
      if (onPhase1Complete && !cachedInitialMindmap) {
        await onPhase1Complete(result);
      }
      return { result };
    }

    return this.generateWithReflection(config, subtitleText, onProgress, onPhase1Complete, cachedInitialMindmap);
  }

  /**
   * 单阶段生成逻辑 (默认)
   */
  private static async generateSinglePhase(config: PluginConfig, subtitleText: string): Promise<string> {
    const llmConfig = await StorageService.getSelectedLLMConfig();
    if (!llmConfig) throw new Error('未找到有效的 LLM 配置');

    // 使用 split/join 代替 replace 以避免字幕中包含 $ 符号导致的替换错误
    const prompt = config.prompt.template.split('{subtitle_content}').join(subtitleText);
    return this.callLLM(config, llmConfig, prompt);
  }

  /**
   * 反思模式多阶段生成逻辑
   */
  private static async generateWithReflection(
    config: PluginConfig,
    subtitleText: string,
    onProgress?: (msg: string) => void,
    onPhase1Complete?: (initialMindmap: string) => Promise<void>,
    cachedInitialMindmap?: string
  ): Promise<{ result: string, initialResult?: string }> {
    await LoggerService.info('LLMService', '开始反思模式生成流程');
    
    // 阶段 1: 初步生成
    let initialMindmap = cachedInitialMindmap;
    if (initialMindmap) {
      onProgress?.('阶段 1/3: 发现初版缓存，跳过生成...');
      await LoggerService.info('LLMService', '阶段 1: 发现初版缓存，跳过主模型生成');
    } else {
      onProgress?.('阶段 1/3: 正在生成初步思维导图...');
      await LoggerService.info('LLMService', '阶段 1: 正在调用主模型生成初稿');
      initialMindmap = await this.generateSinglePhase(config, subtitleText);
      await LoggerService.debug('LLMService', '阶段 1 完成，收到初稿内容');

      if (onPhase1Complete) {
        try {
          await onPhase1Complete(initialMindmap);
        } catch (err) {
          await LoggerService.error('LLMService', '阶段 1 完成后的回调执行失败', err);
        }
      }
    }

    // 阶段 2: 评价反思
    onProgress?.('阶段 2/3: 正在评估生成质量并识别遗漏信息...');
    const reflectionConfigId = config.settings.reflectionLLMConfigId;
    const reflectionLLMConfig = reflectionConfigId === 'default' 
      ? await StorageService.getSelectedLLMConfig()
      : await StorageService.getLLMConfigById(reflectionConfigId);
    
    if (!reflectionLLMConfig) {
      await LoggerService.error('LLMService', '未找到反思阶段的 LLM 配置');
      throw new Error('未找到反思阶段的 LLM 配置');
    }

    await LoggerService.info('LLMService', `阶段 2: 正在调用反思模型 (${reflectionLLMConfig.name}) 进行评估，提供商: ${reflectionLLMConfig.provider}, 地址: ${reflectionLLMConfig.apiUrl}`);
    
    // 使用 split/join 代替 replace 以避免字幕中包含 $ 符号导致的替换错误
    const reflectionPrompt = config.prompt.reflectionPrompt
      .split('{subtitle_content}').join(subtitleText)
      .split('{initial_mindmap}').join(initialMindmap);
    
    const reflectionSystemPrompt = '你是一个资深知识分析师与思维导图评审专家。你的任务是严格评价初步生成的思维导图的质量，并指出遗漏的重要信息点。严禁输出任何开场白、解释或结束语。';
    const feedback = await this.callLLM(config, reflectionLLMConfig, reflectionPrompt, {
      isReflection: true,
      systemPrompt: reflectionSystemPrompt
    });
    await LoggerService.debug('LLMService', '阶段 2 完成，收到反思反馈', { feedback });

    if (feedback.includes('优秀') && feedback.length < 20) {
      await LoggerService.info('LLMService', '评价结果为“优秀”，跳过优化阶段');
      onProgress?.('评价结果：质量优秀，跳过优化阶段');
      return { result: initialMindmap, initialResult: initialMindmap };
    }

    // 阶段 3: 最终优化
    onProgress?.('阶段 3/3: 正在根据反馈优化最终思维导图...');
    const refinementConfigId = config.settings.refinementLLMConfigId;
    const refinementLLMConfig = refinementConfigId === 'default'
      ? await StorageService.getSelectedLLMConfig()
      : await StorageService.getLLMConfigById(refinementConfigId);

    if (!refinementLLMConfig) {
      await LoggerService.error('LLMService', '未找到优化阶段的 LLM 配置');
      throw new Error('未找到优化阶段的 LLM 配置');
    }

    await LoggerService.info('LLMService', `阶段 3: 正在调用优化模型 (${refinementLLMConfig.name}) 生成最终导图，提供商: ${refinementLLMConfig.provider}, 地址: ${refinementLLMConfig.apiUrl}`);
    
    // 使用 split/join 代替 replace 以避免字幕中包含 $ 符号导致的替换错误
    const refinementPrompt = config.prompt.refinementTemplate
      .split('{subtitle_content}').join(subtitleText)
      .split('{initial_mindmap}').join(initialMindmap)
      .split('{feedback}').join(feedback);

    const refinementSystemPrompt = '你是一个资深知识分析师与思维导图可视化专家。你的任务是根据反馈意见，完善现有的思维导图。请严格遵守 Markdown 格式规范，严禁输出任何开场白、解释或结束语。';
    const finalResult = await this.callLLM(config, refinementLLMConfig, refinementPrompt, {
      isReflection: false,
      systemPrompt: refinementSystemPrompt
    });
    await LoggerService.info('LLMService', '反思模式全流程完成');
    return { result: finalResult, initialResult: initialMindmap };
  }

  /**
   * 通用的 LLM 调用方法
   */
  private static async callLLM(
    config: PluginConfig, 
    llmConfig: LLMConfig, 
    prompt: string,
    context?: import('./llm/base').GenerateContext
  ): Promise<string> {
    const adapter = this.getAdapter(llmConfig.provider);
    
    let finalPrompt = prompt;
    if (adapter.preprocessPrompt) {
      finalPrompt = adapter.preprocessPrompt(finalPrompt);
    }
    
    const timeout = (Number(llmConfig.timeout) || 60) * 1000;

    try {
      const content = await adapter.generateMindmap(config, llmConfig, finalPrompt, timeout, context);
      
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('大模型返回的内容为空或不合法');
      }

      return content;
    } catch (error: any) {
      console.error(`[LLMService] 调用 ${llmConfig.provider} 失败:`, error);
      throw new Error(this.parseError(error));
    }
  }

  /**
   * 调用语音识别 API
   */
  static async transcribeAudio(
    config: PluginConfig,
    audioData: Blob | string,
    options?: { videoId?: string },
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const llmConfig = await StorageService.getSelectedLLMConfig();
    
    // 如果配置为本地 ASR，强制使用 OpenAIAdapter 处理渲染 (它内部支持 localAsrUrl)
    if (config.settings.asrProvider === 'local') {
      const adapter = this.adapters['openai'];
      const timeout = 1800000; // 30 分钟 (1800000ms)，防止长视频识别过程中被前端切断
      return adapter.transcribeAudio!(config, llmConfig || {} as LLMConfig, audioData, timeout, options, onProgress);
    }

    if (!llmConfig) {
      throw new Error('未找到有效的 LLM 配置，请前往设置页面配置');
    }

    const adapter = this.getAdapter(llmConfig.provider);
    if (!adapter.transcribeAudio) {
      throw new Error(`当前提供商 ${llmConfig.provider} 不支持语音识别功能。请切换为“本地 ASR”或使用支持 Whisper 的提供商。`);
    }

    const timeout = 1800000; // 30 分钟
    return adapter.transcribeAudio(config, llmConfig, audioData, timeout, options, onProgress);
  }

  /**
   * 获取完整的请求 URL 预览（供 Options UI 使用）
   */
  static getFullRequestUrl(provider: LLMProvider, apiUrl: string, model: string): string {
    if (!apiUrl) return '';
    try {
      const adapter = this.getAdapter(provider);
      // 临时构造一个 config 对象用于预览
      const tempConfig = { provider, apiUrl, model, apiKey: '***' } as LLMConfig;
      return adapter.getFullUrl(tempConfig);
    } catch {
      return apiUrl;
    }
  }

  /**
   * 区分错误类型并返回友好的错误信息
   */
  static parseError(error: any): string {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('fetch') || errorMessage.includes('网络') || errorMessage.includes('Failed to fetch')) {
      return `网络错误：无法连接到 API 服务器 (${errorMessage})，请检查网络连接、API 地址或 CORS 设置`;
    }
    if (errorMessage.includes('超时') || errorMessage.includes('timeout') || errorMessage.includes('AbortError')) {
      return `请求超时，请检查服务状态或在设置中调大超时时间`;
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

  /**
   * 验证配置是否有效
   */
  static validateConfig(llmConfig: LLMConfig, pluginConfig: PluginConfig | any): { valid: boolean; error?: string } {
    if (!llmConfig.apiUrl) return { valid: false, error: 'API 地址不能为空' };
    if (!llmConfig.apiKey && llmConfig.provider !== 'lmstudio' && llmConfig.provider !== 'ollama') {
      return { valid: false, error: 'API 密钥不能为空' };
    }
    if (!llmConfig.model) return { valid: false, error: '模型名称不能为空' };
    if (!pluginConfig.prompt.template) return { valid: false, error: 'Prompt 模板不能为空' };
    return { valid: true };
  }
}