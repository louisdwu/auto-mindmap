import { LLMProvider, PluginConfig, LLMConfig, DEFAULT_CONFIG, DEFAULT_LLM_CONFIG } from '../types/config';
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
    cachedInitialMindmap?: string,
    taskId?: string
  ): Promise<{ result: string, initialResult?: string, reflectionSuccess?: boolean }> {
    const isReflectionEnabled = config.settings.enableReflection;

    if (!isReflectionEnabled) {
      const result = cachedInitialMindmap || await this.generateSinglePhase(config, subtitleText, taskId);
      if (onPhase1Complete && !cachedInitialMindmap) {
        await onPhase1Complete(result);
      }
      return { result };
    }
    
    return this.generateWithReflection(config, subtitleText, onProgress, onPhase1Complete, cachedInitialMindmap, taskId);
  }

  /**
   * 单阶段生成逻辑 (默认)
   */
  private static async generateSinglePhase(config: PluginConfig, subtitleText: string, taskId?: string): Promise<string> {
    const llmConfig = await StorageService.getSelectedLLMConfig();
    if (!llmConfig) throw new Error('未找到有效的 LLM 配置');

    // 使用 split/join 代替 replace 以避免字幕中包含 $ 符号导致的替换错误
    const template = config.prompt.template || DEFAULT_CONFIG.prompt.template;
    const prompt = template.split('{subtitle_content}').join(subtitleText);
    const result = await this.callLLM(config, llmConfig, prompt, { taskId });
    return this.extractMarkdown(result);
  }

  /**
   * 反思模式多阶段生成逻辑
   */
  private static async generateWithReflection(
    config: PluginConfig,
    subtitleText: string,
    onProgress?: (msg: string) => void,
    onPhase1Complete?: (initialMindmap: string) => Promise<void>,
    cachedInitialMindmap?: string,
    taskId?: string
  ): Promise<{ result: string, initialResult?: string, reflectionSuccess?: boolean }> {
    await LoggerService.info('LLMService', '开始反思模式生成流程', undefined, taskId);
    
    // 阶段 1: 初步生成
    let initialMindmap = cachedInitialMindmap;
    if (initialMindmap) {
      onProgress?.('阶段 1/2: 发现初版缓存，跳过生成...');
      await LoggerService.info('LLMService', '阶段 1: 发现初版缓存，跳过主模型生成', undefined, taskId);
    } else {
      onProgress?.('阶段 1/2: 正在生成初步思维导图...');
      await LoggerService.info('LLMService', '阶段 1: 正在调用主模型生成初稿', undefined, taskId);
      initialMindmap = await this.generateSinglePhase(config, subtitleText, taskId);
      await LoggerService.debug('LLMService', '阶段 1 完成，收到初稿内容', undefined, taskId);

      if (onPhase1Complete) {
        try {
          await onPhase1Complete(initialMindmap);
        } catch (err) {
          await LoggerService.error('LLMService', '阶段 1 完成后的回调执行失败', err, taskId);
        }
      }
    }

    // 阶段 2: 评价与优化
    onProgress?.('阶段 2/2: 正在评估并优化思维导图...');
    const reflectionConfigId = config.settings.reflectionLLMConfigId;
    const reflectionLLMConfig = reflectionConfigId === 'default' 
      ? await StorageService.getSelectedLLMConfig()
      : await StorageService.getLLMConfigById(reflectionConfigId);
    
    if (!reflectionLLMConfig) {
      await LoggerService.error('LLMService', '未找到反思阶段的 LLM 配置', undefined, taskId);
      throw new Error('未找到反思阶段的 LLM 配置');
    }

    await LoggerService.info('LLMService', `阶段 2: 正在调用反思模型 (${reflectionLLMConfig.name}) 进行评估与优化`, undefined, taskId);
    
    // 在反思阶段前不再添加硬编码延迟，改为由适配器层的指数退避重试机制处理限流或负载问题
    
    let reflectionPromptTemplate = config.prompt.reflectionPrompt || DEFAULT_CONFIG.prompt.reflectionPrompt;
    // 兼容性处理：如果检测到用户仍在使用旧版三阶段 Prompt，则自动 fallback 到系统内置的新版两阶段 Prompt
    if (!reflectionPromptTemplate.includes('优化补充后的完整 Markdown')) {
      await LoggerService.warn('LLMService', '检测到旧版反思 Prompt，已自动切换为两阶段合并逻辑', undefined, taskId);
      reflectionPromptTemplate = DEFAULT_CONFIG.prompt.reflectionPrompt;
    }

    const reflectionPrompt = reflectionPromptTemplate
      .split('{subtitle_content}').join(subtitleText)
      .split('{initial_mindmap}').join(initialMindmap);
    
    const reflectionSystemPrompt = `你是一个资深知识分析师与思维导图可视化专家。你的任务是基于原视频字幕稿，严格评价初步生成的思维导图质量，并在必要时直接执行优化。
必须遵循以下准则：
1. 定性概括：将口语化表达转化为书面逻辑观点。
2. 数据敏感：精准保留所有价格、日期、百分比等数字点位。
3. 结构规范：最高层级唯一(#)，严禁标题编号，采用标准 Markdown 缩进。
4. 严禁输出任何开场白、解释或结束语。`;
    const reflectionResult = await this.callLLM(config, reflectionLLMConfig, reflectionPrompt, {
      isReflection: true,
      systemPrompt: reflectionSystemPrompt,
      taskId
    });
    
    await LoggerService.debug('LLMService', '阶段 2 完成，收到反思结果', undefined, taskId);

    // 处理合并后的逻辑
    const cleanedResult = this.extractMarkdown(reflectionResult);
    if (cleanedResult === '优秀' || (cleanedResult.includes('优秀') && cleanedResult.length < 10)) {
      await LoggerService.info('LLMService', '评价结果为“优秀”，使用初稿', undefined, taskId);
      onProgress?.('评价结果：质量优秀，采用初稿');
      return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: true };
    }

    await LoggerService.info('LLMService', '发现优化内容，采用优化后的版本', undefined, taskId);
    onProgress?.('发现遗漏点，已完成自动优化');
    return { result: cleanedResult, initialResult: initialMindmap, reflectionSuccess: false };
  }

  /**
   * 提取纯净的 Markdown 导图文本
   * 同时清理头部（思考过程前缀）和尾部（自我检查后缀）的非导图内容
   */
  private static extractMarkdown(text: string): string {
    // 预处理：移除 <think> 标签及其包裹的所有打草稿内容，防止干扰后续提取
    const processedText = text.replace(/<think>[\s\S]*?<\/think>\n?/gi, '');

    // 优先寻找 ```markdown 或 ```md 代码块
    const mdBlockMatch = processedText.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
    if (mdBlockMatch) {
      return mdBlockMatch[1].trim();
    }
    
    // 如果没有代码块，从第一个 # 标题开始截断，舍弃前面的非规范内容
    let extracted = processedText;
    const headingMatch = processedText.match(/(?:^|\n)(#\s.*[\s\S]*)/);
    if (headingMatch) {
      extracted = headingMatch[1];
    }
    
    // 清理尾部：检测连续的非 Markdown 结构文本并截断
    // 合法的导图行：标题(#)、列表项(-/*)、缩进文本(以空格开头)、空行
    const lines = extracted.split('\n');
    let lastValidLineIndex = lines.length - 1;
    
    // 从末尾向前扫描，找到最后一个合法的 Markdown 导图行
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // 空行跳过
      if (!trimmed) continue;
      
      // 合法的导图结构行：以 #、-、*、空格缩进 开头
      if (/^#{1,6}\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\s+[-*]\s/.test(line)) {
        lastValidLineIndex = i;
        break;
      }
      
      // 如果是以 **、> 开头的 Markdown 格式（如粗体标记、引用），判定为非导图思考内容
      // 纯文本行（非标题、非列表）也判定为非导图内容
    }
    
    // 截断尾部非导图内容
    const cleanedLines = lines.slice(0, lastValidLineIndex + 1);
    return cleanedLines.join('\n').trim();
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
    
    const isReflection = context?.isReflection === true;
    let timeoutSeconds = Number(llmConfig.timeout) || 60;
    
    // 如果是反思阶段，且用户设置的超时时间较短，则自动提升至 120 秒，以应对更大规模的上下文处理
    if (isReflection && timeoutSeconds < 120) {
      timeoutSeconds = 120;
    }
    
    const timeout = timeoutSeconds * 1000;

    // 获取 API Key（如果 UI 配置为空且是默认配置，将采用 config.ts 中的环境变量默认值）
    const apiKey = llmConfig.apiKey || (llmConfig.id === 'default' ? DEFAULT_LLM_CONFIG.apiKey : '');

    // 确保 context 包含有效的 systemPrompt，实现 Prompt 内理化
    const finalContext = {
      ...context,
      systemPrompt: context?.systemPrompt || config.prompt.systemPrompt || DEFAULT_CONFIG.prompt.systemPrompt
    };

    // 构造最终的 LLM 配置（包含补全后的 API Key）
    const finalLLMConfig = { ...llmConfig, apiKey };

    try {
      const content = await adapter.generateMindmap(config, finalLLMConfig, finalPrompt, timeout, finalContext);
      
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