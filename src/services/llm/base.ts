import { LLMConfig, PluginConfig } from '../../types/config';

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ILLMAdapter {
  /**
   * 生成思维导图内容
   */
  generateMindmap(
    config: PluginConfig,
    llmConfig: LLMConfig,
    prompt: string,
    timeout: number
  ): Promise<string>;

  /**
   * 语音识别 (可选实现)
   */
  transcribeAudio?(
    config: PluginConfig,
    llmConfig: LLMConfig,
    audioData: Blob | string,
    timeout: number,
    options?: { videoId?: string },
    onProgress?: (msg: string) => void
  ): Promise<string>;

  /**
   * 获取完整的 API 请求 URL
   */
  getFullUrl(llmConfig: LLMConfig): string;

  /**
   * 在发送前对 Prompt 进行预处理（可选）
   */
  preprocessPrompt?(prompt: string): string;
}

