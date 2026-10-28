import { LLMConfig, PluginConfig } from '../../types/config';
import { AsrRequestOptions } from '../../types/subtitle';

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerateContext {
  isReflection?: boolean;
  systemPrompt?: string;
  taskId?: string;
  /** 用户取消任务时中断 LLM 请求 */
  signal?: AbortSignal;
  /** 上游返回的 token 用量，用于统计与费用估算 */
  onUsage?: (usage: LlmUsage) => void;
}

export interface ILLMAdapter {
  /**
   * 生成思维导图内容
   */
  generateMindmap(
    config: PluginConfig,
    llmConfig: LLMConfig,
    prompt: string,
    timeout: number,
    context?: GenerateContext
  ): Promise<string>;

  /**
   * 语音识别 (可选实现)
   */
  transcribeAudio?(
    config: PluginConfig,
    llmConfig: LLMConfig,
    audioData: Blob | string,
    timeout: number,
    options?: AsrRequestOptions,
    onProgress?: (msg: string) => void
  ): Promise<string>;

  /**
   * 获取完整的 API 请求 URL
   */
  getFullUrl(llmConfig: LLMConfig): string;

  /**
   * 列出当前密钥可见的模型（可选实现）。
   *
   * 存在的意义：404「model route not found」既可能是地址写错，也可能是模型标识
   * 在上游被改名/下线。直接问服务端「我这个 key 能用哪些模型」，比让用户猜要快得多。
   */
  listModels?(llmConfig: LLMConfig, timeout: number): Promise<string[]>;

  /**
   * 在发送前对 Prompt 进行预处理（可选）
   */
  preprocessPrompt?(prompt: string): string;
}