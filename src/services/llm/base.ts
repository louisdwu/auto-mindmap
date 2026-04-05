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
    onProgress?: (msg: string) => void
  ): Promise<string>;
}
