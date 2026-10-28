import { LLMProvider, PluginConfig, LLMConfig, DEFAULT_CONFIG, DEFAULT_LLM_CONFIG, REFLECTION_PROMPT_MARKER } from '../types/config';
import { StorageService } from './storageService';
import { ILLMAdapter, LlmUsage } from './llm/base';
import { OpenAIAdapter } from './llm/adapters/OpenAIAdapter';
import { GeminiAdapter } from './llm/adapters/GeminiAdapter';
import { OllamaAdapter } from './llm/adapters/OllamaAdapter';
import { LoggerService } from './loggerService';
import { extractMarkdown } from '../utils/markdownParser';
import { ErrorUtils } from '../utils/errorUtils';
import { AsrRequestOptions } from '../types/subtitle';
import { computeInputBudget, estimateTokens, splitTranscriptByBudget } from './llm/tokenBudget';
import { evaluateMindmapDraft, compareDrafts } from './llm/reflectionGate';

/** 连通性测试结果（供选项页展示） */
export interface ConnectionTestResult {
  ok: boolean;
  /** 实际请求地址（已包含适配器补全的 endpoint 路径） */
  url: string;
  /** 往返耗时（毫秒） */
  latencyMs: number;
  /** 成功时是模型回显，失败时是可操作的原因 */
  detail: string;
  /** 该密钥当前可用的模型清单（拿不到时为 undefined） */
  models?: string[];
  /** 拿模型清单失败的原因 */
  modelsError?: string;
}

/** 探针 Prompt：只要最短回复，避免连通性测试本身消耗大量 token */
const CONNECTION_TEST_PROMPT = '连通性测试：本次只回复「收到」两个字，不要输出任何其他内容。';
const CONNECTION_TEST_SYSTEM_PROMPT = '你是连通性测试助手，严格按用户要求给出最短回复。';

/** 长视频分段提炼的系统提示词 */
const CHUNK_SYSTEM_PROMPT = `你是视频字幕的分段提炼助手。你的任务是从一段带时间戳的字幕中提取结构化提纲，供后续合并成完整思维导图。
必须遵循：
1. 保留所有关键结论、论据、案例、数字与专业术语，并保留对应的 [mm:ss] 时间戳；
2. 使用 Markdown 无序列表（-）表达层级，不要输出 # 根标题，不要输出开场白或解释；
3. 不要按时间流水账罗列，按主题逻辑归并；
4. 只输出提纲正文。`;

const CHUNK_MAP_PROMPT = `这是长视频字幕的第 {index}/{total} 段。请把这一段提炼成结构化提纲。
要求：保留 [mm:ss] 时间戳与关键数据；用 "-" 列表表达层级；不要输出根标题与解释。
字幕：
{chunk}`;

const CHUNK_REDUCE_SYSTEM_PROMPT = `你是思维导图提纲的合并助手。把多段分段提纲合并为一份更紧凑、去重后的提纲，保留 [mm:ss] 时间戳、关键数据与主题层级。
只输出提纲正文，不要输出解释、根标题或代码块。`;

const CHUNK_REDUCE_PROMPT = `请合并以下分段提纲，去除重复，保留全部关键结论、数据与时间戳：
{outlines}`;

interface Phase1Result {
  markdown: string;
  /** 反思阶段使用的压缩稿；正常长度时为 undefined（直接用原字幕） */
  reflectionSource?: string;
}

export class LLMService {
  private static adapters: Record<string, ILLMAdapter> = {
    openai: new OpenAIAdapter(),
    // 商汤 SenseNova 提供 OpenAI 兼容的 Chat Completions 接口
    sensenova: new OpenAIAdapter(),
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
   *
   * 短字幕：单次生成。
   * 长字幕：先按 token 预算分段提炼，再合并提纲生成最终导图；
   *         开启反思模式时，反思阶段也优先使用压缩稿，避免再次超上下文。
   */
  static async generateMindmap(
    config: PluginConfig,
    subtitleText: string,
    onProgress?: (msg: string) => void,
    onPhase1Complete?: (initialMindmap: string) => Promise<void>,
    cachedInitialMindmap?: string,
    taskId?: string,
    signal?: AbortSignal,
    onUsage?: (usage: LlmUsage) => void
  ): Promise<{ result: string, initialResult?: string, reflectionSuccess?: boolean }> {
    const isReflectionEnabled = config.settings.enableReflection;

    if (!isReflectionEnabled) {
      const phase1 = cachedInitialMindmap
        ? { markdown: cachedInitialMindmap }
        : await this.generateSinglePhase(config, subtitleText, taskId, onProgress, signal, onUsage);
      if (onPhase1Complete && !cachedInitialMindmap) {
        await onPhase1Complete(phase1.markdown);
      }
      return { result: phase1.markdown };
    }

    return this.generateWithReflection(
      config,
      subtitleText,
      onProgress,
      onPhase1Complete,
      cachedInitialMindmap,
      taskId,
      signal,
      onUsage
    );
  }

  /** 根据上下文窗口与用户配置推导实际输出预算（输出最多占上下文 30%） */
  private static resolveOutputTokens(llmConfig: LLMConfig): number {
    const contextWindow = Math.max(2048, Number(llmConfig.num_ctx) || 16384);
    const configured = Math.max(512, Number(llmConfig.maxTokens) || 8192);
    return Math.min(
      configured,
      Math.max(1024, Math.floor(contextWindow * 0.3)),
      Math.max(1024, contextWindow - 2048)
    );
  }

  /** 模型可容纳的最大 prompt token（已扣除输出与安全边际） */
  private static maxPromptTokens(llmConfig: LLMConfig): number {
    const contextWindow = Math.max(2048, Number(llmConfig.num_ctx) || 16384);
    return Math.max(1024, contextWindow - this.resolveOutputTokens(llmConfig) - 512);
  }

  /** 把模板中的占位符清空后估算固定开销 */
  private static templateOverheadTokens(template: string): number {
    return estimateTokens(template.split('{subtitle_content}').join(''));
  }

  /**
   * 单阶段生成逻辑。
   * 返回 markdown 与可选的 reflectionSource（长字幕时是合并后的提纲）。
   */
  private static async generateSinglePhase(
    config: PluginConfig,
    subtitleText: string,
    taskId?: string,
    onProgress?: (msg: string) => void,
    signal?: AbortSignal,
    onUsage?: (usage: LlmUsage) => void
  ): Promise<Phase1Result> {
    const llmConfig = await StorageService.getSelectedLLMConfig();
    if (!llmConfig) throw new Error('未找到有效的 LLM 配置');

    const template = config.prompt.template || DEFAULT_CONFIG.prompt.template;
    const systemPrompt = config.prompt.systemPrompt || DEFAULT_CONFIG.prompt.systemPrompt;
    const contextWindow = Math.max(2048, Number(llmConfig.num_ctx) || 16384);
    const outputTokens = this.resolveOutputTokens(llmConfig);
    const inputBudget = computeInputBudget({
      contextWindow,
      maxOutputTokens: outputTokens,
      systemPromptTokens: estimateTokens(systemPrompt),
      templateTokens: this.templateOverheadTokens(template)
    });

    const subtitleTokens = estimateTokens(subtitleText);
    const canUseSingleCall = !config.settings.enableChunking || subtitleTokens <= inputBudget;

    await LoggerService.info(
      'LLMService',
      canUseSingleCall
        ? `正在调用模型 ${llmConfig.name} (${llmConfig.model}) 生成思维导图`
        : `字幕约 ${subtitleTokens} tokens，超过单次输入预算 ${inputBudget}，启用分段提炼`,
      undefined,
      taskId
    );

    if (canUseSingleCall) {
      const prompt = template.split('{subtitle_content}').join(subtitleText);
      const result = await this.callLLM(config, llmConfig, prompt, { taskId, signal, onUsage });
      return { markdown: extractMarkdown(result) };
    }

    return this.generateByChunks(
      config,
      llmConfig,
      subtitleText,
      template,
      taskId,
      onProgress,
      inputBudget,
      outputTokens,
      signal,
      onUsage
    );
  }

  /**
   * 长字幕分段提炼：
   *   分段提纲 -> 合并/压缩到输入预算 -> 用原模板生成最终导图。
   */
  private static async generateByChunks(
    config: PluginConfig,
    llmConfig: LLMConfig,
    subtitleText: string,
    template: string,
    taskId: string | undefined,
    onProgress: ((msg: string) => void) | undefined,
    inputBudget: number,
    outputTokens: number,
    signal?: AbortSignal,
    onUsage?: (usage: LlmUsage) => void
  ): Promise<Phase1Result> {
    const totalTokens = estimateTokens(subtitleText);
    onProgress?.(`字幕较长（约 ${totalTokens} tokens），将分段提炼后再生成思维导图...`);

    // 每段留出 map prompt 的固定开销
    const chunkBudget = Math.max(600, Math.floor(inputBudget * 0.82));
    const chunks = splitTranscriptByBudget(subtitleText, chunkBudget);
    if (chunks.length <= 1) {
      const prompt = template.split('{subtitle_content}').join(subtitleText);
      const result = await this.callLLM(config, llmConfig, prompt, { taskId, signal, onUsage });
      return { markdown: extractMarkdown(result) };
    }

    const mapLlmConfig: LLMConfig = {
      ...llmConfig,
      maxTokens: Math.min(2048, outputTokens),
      temperature: 0.3
    };

    const outlines: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(`阶段 1/3: 正在提炼第 ${i + 1}/${chunks.length} 段字幕...`);
      const prompt = CHUNK_MAP_PROMPT
        .replace('{index}', String(i + 1))
        .replace('{total}', String(chunks.length))
        .replace('{chunk}', chunks[i]);

      const raw = await this.callLLM(config, mapLlmConfig, prompt, {
        systemPrompt: CHUNK_SYSTEM_PROMPT,
        taskId,
        signal,
        onUsage
      });
      const outline = this.cleanChunkText(raw);
      if (!outline) {
        throw new Error(`第 ${i + 1} 段字幕提炼结果为空，请重试或更换模型。`);
      }
      outlines.push(`### 分段 ${i + 1}/${chunks.length}\n${outline}`);
    }

    // 合并后的提纲必须能塞进最终生成请求，否则递归压缩
    const targetTokens = Math.max(800, inputBudget - 400);
    onProgress?.(`阶段 2/3: 正在合并 ${outlines.length} 段提纲...`);
    const merged = await this.reduceOutlines(config, llmConfig, outlines, targetTokens, taskId, onProgress, signal, onUsage);

    onProgress?.('阶段 3/3: 正在生成最终思维导图...');
    const header = '[说明] 原视频字幕过长，以下内容为按时间顺序分段提炼的提纲（保留原始时间戳与关键数据），请据此生成完整思维导图。\n\n';
    const finalPrompt = template.split('{subtitle_content}').join(header + merged);
    const result = await this.callLLM(config, llmConfig, finalPrompt, { taskId, signal, onUsage });

    return {
      markdown: extractMarkdown(result),
      reflectionSource: header + merged
    };
  }

  /** 递归合并分段提纲，直到能放进最终请求 */
  private static async reduceOutlines(
    config: PluginConfig,
    llmConfig: LLMConfig,
    outlines: string[],
    targetTokens: number,
    taskId: string | undefined,
    onProgress: ((msg: string) => void) | undefined,
    signal?: AbortSignal,
    onUsage?: (usage: LlmUsage) => void
  ): Promise<string> {
    let current = outlines;
    let round = 0;

    while (estimateTokens(current.join('\n\n')) > targetTokens) {
      round++;
      if (round > 4) {
        return this.truncateToBudget(current.join('\n\n'), targetTokens);
      }

      onProgress?.(`正在压缩分段提纲（第 ${round} 轮）...`);
      const groups = this.groupByBudget(current, Math.max(1200, targetTokens * 2));
      const next: string[] = [];
      const reduceLlmConfig: LLMConfig = {
        ...llmConfig,
        maxTokens: Math.min(2048, Number(llmConfig.maxTokens) || 2048),
        temperature: 0.2
      };

      for (const group of groups) {
        const prompt = CHUNK_REDUCE_PROMPT.replace('{outlines}', group.join('\n\n'));
        const raw = await this.callLLM(config, reduceLlmConfig, prompt, {
          systemPrompt: CHUNK_REDUCE_SYSTEM_PROMPT,
          taskId,
          signal,
          onUsage
        });
        const cleaned = this.cleanChunkText(raw);
        if (cleaned) next.push(cleaned);
      }

      // 无法再通过分组压缩时，按行硬截断，并显式说明
      if (next.length === 0 || next.length >= current.length) {
        return this.truncateToBudget(current.join('\n\n'), targetTokens);
      }
      current = next;
    }

    return current.join('\n\n');
  }

  /** 按 token 预算把条目分组，供合并阶段使用 */
  private static groupByBudget(items: string[], budgetTokens: number): string[][] {
    const groups: string[][] = [];
    let current: string[] = [];
    let currentTokens = 0;

    for (const item of items) {
      const itemTokens = estimateTokens(item);
      if (current.length > 0 && currentTokens + itemTokens > budgetTokens) {
        groups.push(current);
        current = [];
        currentTokens = 0;
      }
      current.push(item);
      currentTokens += itemTokens;
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }

  /** 极端情况下按行截断，宁可少一些内容也不要直接失败 */
  private static truncateToBudget(text: string, budgetTokens: number): string {
    const lines = text.split('\n');
    const kept: string[] = [];
    let tokens = 0;
    for (const line of lines) {
      const lineTokens = estimateTokens(line) + 1;
      if (tokens + lineTokens > budgetTokens) break;
      kept.push(line);
      tokens += lineTokens;
    }
    if (kept.length === 0) {
      return text.slice(0, Math.max(100, Math.floor(budgetTokens * 0.8)));
    }
    return kept.join('\n') + '\n\n[注] 后续内容因模型上下文限制被省略。';
  }

  /** 清理分段/合并阶段返回的文本（去掉 think 标签与代码块包裹） */
  private static cleanChunkText(text: string): string {
    let cleaned = (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fence = cleaned.match(/^\`\`\`(?:markdown|md|text)?\s*([\s\S]*?)\`\`\`$/i);
    if (fence) cleaned = fence[1].trim();
    return cleaned;
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
    taskId?: string,
    signal?: AbortSignal,
    onUsage?: (usage: LlmUsage) => void
  ): Promise<{ result: string, initialResult?: string, reflectionSuccess?: boolean }> {
    await LoggerService.info('LLMService', '开始反思模式生成流程', undefined, taskId);

    let phase1: Phase1Result;
    if (cachedInitialMindmap) {
      phase1 = { markdown: cachedInitialMindmap };
      onProgress?.('阶段 1/2: 发现初版缓存，跳过生成...');
      await LoggerService.info('LLMService', '阶段 1: 发现初版缓存，跳过主模型生成', undefined, taskId);
    } else {
      const mainLLMConfig = await StorageService.getSelectedLLMConfig();
      onProgress?.(`阶段 1/2: 正在通过 ${mainLLMConfig?.model || '主模型'} 生成初步思维导图...`);
      await LoggerService.info('LLMService', `阶段 1: 正在调用主模型 ${mainLLMConfig?.name || '默认'} (${mainLLMConfig?.model || '未知'}) 生成初稿`, undefined, taskId);
      phase1 = await this.generateSinglePhase(config, subtitleText, taskId, onProgress, signal, onUsage);
      await LoggerService.debug('LLMService', '阶段 1 完成，收到初稿内容', undefined, taskId);

      if (onPhase1Complete) {
        try {
          await onPhase1Complete(phase1.markdown);
        } catch (err) {
          await LoggerService.error('LLMService', '阶段 1 完成后的回调执行失败', err, taskId);
        }
      }
    }

    const initialMindmap = phase1.markdown;
    // 闸门与反思阶段使用同一份输入：长字幕时是压缩稿，否则是原字幕
    const gateSource = phase1.reflectionSource ?? subtitleText;

    onProgress?.('阶段 2/2: 正在校验初稿完整度...');
    const gate = evaluateMindmapDraft(initialMindmap, gateSource);
    await LoggerService.info(
      'LLMService',
      `阶段 2 预检：${gate.pass ? '通过，无需重写' : `未通过（${gate.reasons.join('；')}）`}｜列表节点 ${gate.metrics.nodeCount}｜定量数据点 ${gate.metrics.dataPointCovered}/${gate.metrics.dataPointTotal}`,
      undefined,
      taskId
    );

    if (gate.pass) {
      onProgress?.('初稿通过自动校验，无需重写');
      return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: true };
    }

    const reflectionConfigId = config.settings.reflectionLLMConfigId;
    const reflectionLLMConfig = reflectionConfigId === 'default'
      ? await StorageService.getSelectedLLMConfig()
      : await StorageService.getLLMConfigById(reflectionConfigId);

    if (!reflectionLLMConfig) {
      await LoggerService.error('LLMService', '未找到反思阶段的 LLM 配置，已回退初稿', undefined, taskId);
      onProgress?.('未找到反思模型配置，已采用初稿');
      return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: false };
    }

    await LoggerService.info('LLMService', `阶段 2: 正在调用反思模型 ${reflectionLLMConfig.name} (${reflectionLLMConfig.model}) 补漏与纠错`, undefined, taskId);

    let reflectionPromptTemplate = config.prompt.reflectionPrompt || DEFAULT_CONFIG.prompt.reflectionPrompt;
    // 兼容性处理：旧版「自评是否优秀」的 Prompt 已废弃，自动切换到「补漏纠错」版
    if (!reflectionPromptTemplate.includes(REFLECTION_PROMPT_MARKER)) {
      await LoggerService.warn('LLMService', '检测到旧版反思 Prompt，已自动切换为补漏纠错版', undefined, taskId);
      reflectionPromptTemplate = DEFAULT_CONFIG.prompt.reflectionPrompt;
    }

    const buildPrompt = (source: string) => reflectionPromptTemplate
      .split('{subtitle_content}').join(source)
      .split('{initial_mindmap}').join(initialMindmap);

    const reflectionSystemPrompt = `你是一个资深知识分析师与思维导图可视化专家。你的任务是在初稿基础上做补漏与纠错：对照带时间戳的字幕稿，补齐被漏掉的板块、数据与结论，修正错误，然后输出完整导图。
必须遵循以下准则：
1. 定性概括与时间对齐：将口语化表达转化为书面逻辑观点，保留节点末尾的视频时间戳 [mm:ss]。
2. 数据敏感：字幕中的价格、百分比、日期、机构名必须全部落到叶子上，一个都不能少。
3. 结构规范：最高层级唯一(#)，严禁标题编号，严格采用标准 Markdown 无序列表缩进，按主题逻辑归并而非时间流水账。
4. 与初稿一致的正确内容可以沿用，但不要为了"看起来不同"而改写；确实有误的才改。
5. 只输出完整的 Markdown 导图，不要输出评价、解释、开场白或结束语。`;

    const maxReflectionPromptTokens = this.maxPromptTokens(reflectionLLMConfig);
    let reflectionPrompt = buildPrompt(subtitleText);

    // 超长字幕：优先用阶段 1 生成的压缩稿；仍超限则跳过反思，保留初稿。
    if (estimateTokens(reflectionPrompt) > maxReflectionPromptTokens) {
      if (phase1.reflectionSource) {
        const compressedPrompt = buildPrompt(phase1.reflectionSource);
        if (estimateTokens(compressedPrompt) <= maxReflectionPromptTokens) {
          reflectionPrompt = compressedPrompt;
          await LoggerService.info('LLMService', '反思阶段输入超限，已改用分段提炼稿', undefined, taskId);
        } else {
          await LoggerService.warn('LLMService', '反思阶段输入超限且压缩稿仍过长，跳过反思阶段', undefined, taskId);
          onProgress?.('字幕与导图超出反思模型上下文，已跳过反思阶段，采用初稿');
          return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: false };
        }
      } else {
        await LoggerService.warn('LLMService', '反思阶段输入超限，跳过反思阶段', undefined, taskId);
        onProgress?.('字幕与导图超出反思模型上下文，已跳过反思阶段，采用初稿');
        return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: false };
      }
    }

    let reflectionResult: string;
    try {
      reflectionResult = await this.callLLM(config, reflectionLLMConfig, reflectionPrompt, {
        isReflection: true,
        systemPrompt: reflectionSystemPrompt,
        taskId,
        signal,
        onUsage
      });
    } catch (err) {
      // 用户主动取消要如实上报，不能吞掉
      if (signal?.aborted) throw err;
      // 反思只是加分项：出错就回退已经拿到的初稿，绝不连累整单任务
      await LoggerService.warn('LLMService', '反思阶段调用失败，已回退初稿', err, taskId);
      onProgress?.('反思阶段失败，已采用初稿');
      return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: false };
    }

    await LoggerService.debug('LLMService', '阶段 2 完成，收到反思结果', undefined, taskId);

    const cleanedResult = extractMarkdown(reflectionResult);
    // 兼容旧版 Prompt 的「优秀」直通：没有改动就保留初稿
    if (cleanedResult === '优秀' || (cleanedResult.includes('优秀') && cleanedResult.length < 10)) {
      await LoggerService.info('LLMService', '反思模型未做改动，使用初稿', undefined, taskId);
      onProgress?.('反思模型未做改动，采用初稿');
      return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: true };
    }

    const verdict = compareDrafts(initialMindmap, cleanedResult, gateSource);
    if (!verdict.adopt) {
      await LoggerService.warn('LLMService', `重写稿未被采用：${verdict.reason}`, undefined, taskId);
      onProgress?.('重写结果未通过复核，保留初稿');
      return { result: initialMindmap, initialResult: initialMindmap, reflectionSuccess: false };
    }

    await LoggerService.info('LLMService', `已采用重写稿：${verdict.reason}`, undefined, taskId);
    onProgress?.('已完成补漏与纠错');
    return { result: cleanedResult, initialResult: initialMindmap, reflectionSuccess: false };
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
        throw new Error('大模型返回的内容为空（可能是由于触发了敏感词过滤或政治文明敏感字符拒绝工作，请检查输入或更换模型）');
      }

      return content;
    } catch (error: any) {
      console.error(`[LLMService] 调用 ${llmConfig.provider} 失败:`, error);
      throw new Error(ErrorUtils.parseError(error));
    }
  }

  /**
   * 调用语音识别 API
   */
  static async transcribeAudio(
    config: PluginConfig,
    audioData: Blob | string,
    options?: AsrRequestOptions,
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
   * 连通性测试：发一次最小请求，并顺带取回该密钥可用的模型清单。
   *
   * 两件事一次做完，是因为它们回答的是同一个问题「这条链路现在能怎么用」：
   * - 探测请求告诉你「当前这个地址 + 模型」通不通；
   * - 模型清单告诉你「还可以换成哪个」——上游把模型改名/下线时，
   *   用户配置一个字没改也会突然 404，只有清单能直接给出下一步该填什么。
   * 靠跑完整生成任务去试错代价太高（字幕下载 + 长时间等待）。
   */
  static async testConnection(
    config: PluginConfig,
    llmConfig: LLMConfig,
    timeoutSeconds: number = 30
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const apiKey = llmConfig.apiKey || (llmConfig.id === 'default' ? DEFAULT_LLM_CONFIG.apiKey : '');
    const probeConfig: LLMConfig = { ...llmConfig, apiKey, timeout: timeoutSeconds };

    let url = llmConfig.apiUrl || '';
    let adapter: ILLMAdapter;
    try {
      adapter = this.getAdapter(llmConfig.provider);
      url = adapter.getFullUrl(probeConfig);
    } catch (error: any) {
      return {
        ok: false,
        url,
        latencyMs: Date.now() - startedAt,
        detail: error?.message || String(error),
        modelsError: '提供商不受支持，无法查询模型列表'
      };
    }

    let ok = false;
    let detail = '';
    try {
      const reply = await this.callLLM(config, probeConfig, CONNECTION_TEST_PROMPT, {
        systemPrompt: CONNECTION_TEST_SYSTEM_PROMPT
      });
      ok = true;
      detail = `模型返回：${reply.trim().slice(0, 120)}`;
    } catch (error: any) {
      detail = error?.message || String(error);
    }

    // 无论成败都拉一次清单：失败时它是定位依据，成功时它是「可替换项」。
    // 单独失败不影响探测结论，只作为附注展示。
    let models: string[] | undefined;
    let modelsError: string | undefined;
    if (adapter.listModels) {
      try {
        models = await adapter.listModels(probeConfig, 15000);
      } catch (error: any) {
        modelsError = error?.message || String(error);
      }
    } else {
      modelsError = '该提供商暂不支持查询模型列表';
    }

    return {
      ok,
      url,
      latencyMs: Date.now() - startedAt,
      detail,
      models,
      modelsError
    };
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