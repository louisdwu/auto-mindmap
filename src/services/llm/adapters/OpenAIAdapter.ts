import { ILLMAdapter, GenerateContext } from '../base';
import { BaseAdapter } from '../BaseAdapter';
import { LLMConfig, LLMProvider, PluginConfig, normalizeAsrLanguage } from '../../../types/config';
import { AsrRequestOptions } from '../../../types/subtitle';

/** 显式指定语言时的上下文偏置（只在用户主动选了对应语言时发送）。 */
const ASR_INITIAL_PROMPTS: Record<string, string> = {
  zh: '这是一段中文视频的音频，其中可能包含部分专业英文单词或短语。',
};

/** 进度日志里展示的语言说明。 */
function describeAsrLanguage(code: string): string {
  const names: Record<string, string> = {
    auto: '自动检测',
    zh: '中文',
    en: '英文',
    ja: '日文',
    ko: '韩文',
    yue: '粤语',
  };
  return names[code] ? names[code] + '（' + code + '）' : code;
}

/** 使用 OpenAI Chat Completions 协议的提供商 */
const OPENAI_COMPATIBLE_PROVIDERS: LLMProvider[] = ['openai', 'custom', 'lmstudio', 'sensenova'];

/** 把各种 OpenAI 兼容网关的错误结构统一抽成一句人话 */
function extractServerError(data: any, rawText: string): string {
  const candidates = [
    data?.error?.message,
    data?.error?.error?.message,
    typeof data?.error === 'string' ? data.error : undefined,
    data?.message,
    data?.detail
  ];
  const found = candidates.find(value => typeof value === 'string' && value.trim().length > 0);
  const text = found || rawText || '未知错误';
  return String(text).slice(0, 300);
}

export class OpenAIAdapter extends BaseAdapter implements ILLMAdapter {
  /**
   * 获取完整的 API 请求 URL
   */
  getFullUrl(llmConfig: LLMConfig): string {
    let apiUrl = this.normalizeUrl(llmConfig.apiUrl);
    const provider = llmConfig.provider;

    if (OPENAI_COMPATIBLE_PROVIDERS.includes(provider) && !apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl + '/chat/completions';
    }
    return apiUrl;
  }

  /**
   * 由 chat/completions 地址推出 models 列表地址（OpenAI 兼容协议的通用约定）
   */
  getModelsUrl(llmConfig: LLMConfig): string {
    return `${this.getFullUrl(llmConfig).replace(/\/chat\/completions$/, '')}/models`;
  }

  /**
   * 拉取该密钥可见的模型列表，用于定位「模型路由不存在」这类错误
   */
  async listModels(llmConfig: LLMConfig, timeout: number): Promise<string[]> {
    const url = this.getModelsUrl(llmConfig);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (llmConfig.apiKey && llmConfig.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${llmConfig.apiKey.trim()}`;
    }

    const response = await this.fetchWithRetry(url, { method: 'GET', headers }, timeout);
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`获取模型列表失败 (HTTP ${response.status}): ${responseText.slice(0, 200)}`);
    }

    let data: any;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error('模型列表响应不是合法 JSON');
    }

    // 三种常见结构：{data:[{id}]}、{models:[{id|name}]}、{models:["id"]}
    const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    return rawList
      .map((item: any) => (typeof item === 'string' ? item : item?.id || item?.name))
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
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
    }, timeout, 3, context?.signal);

    const responseText = await response.text();
    let data: any;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      throw new Error(`API 响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      const errorCode = response.status;
      const serverErrorMsg = extractServerError(data, responseText);
      // 错误信息里带上「实际请求地址 + 模型」，否则 404/401 这类问题只能靠猜：
      // 是同名模型没开通、还是基址写错了（例如漏了 /v1），用户和日志都无从判断。
      throw new Error(`HTTP ${errorCode}: ${serverErrorMsg}（地址 ${apiUrl}；模型 ${llmConfig.model?.trim()}）`);
    }

    const usage = data.usage;
    if (usage) {
      context?.onUsage?.({
        inputTokens: Number(usage.prompt_tokens) || 0,
        outputTokens: Number(usage.completion_tokens) || 0
      });
    }

    let content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text;
    // 推理字段各家命名不一：OpenAI 系用 reasoning_content，商汤 SenseNova 用 reasoning
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content
      || data.choices?.[0]?.message?.reasoning;

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
    options?: AsrRequestOptions,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const isLocal = config.settings.asrProvider === 'local';
    const apiUrl = isLocal 
      ? config.settings.localAsrUrl 
      : this.getFullUrl(llmConfig).replace('/chat/completions', '/audio/transcriptions');

    const progressMsg = typeof audioData === 'string' 
      ? '正在通过 URL 启动 ASR 任务...' 
      : `正在上传音频数据 (${(audioData.size / 1024 / 1024).toFixed(2)} MB)...`;
    onProgress?.(progressMsg);

    const formData = new FormData();
    if (typeof audioData === 'string') {
      formData.append('audio_url', audioData);
    } else {
      formData.append('file', audioData, 'audio.mp3');
    }
    
    formData.append('model', isLocal ? 'large-v2' : 'whisper-1');
    formData.append('response_format', 'json');
    
    // 识别语言：默认 'auto'，把语言判定交给引擎。
    // 绝不能为了「解决短音频误判为 cy」就写死 zh —— 对英文音频来说这是灾难：
    // Whisper 会把语音改写成中文译文，专业术语/型号/数字全部失真。
    const asrLanguage = normalizeAsrLanguage(config.settings.asrLanguage);
    onProgress?.('识别语言：' + describeAsrLanguage(asrLanguage));
    if (asrLanguage !== 'auto') {
      formData.append('language', asrLanguage);

      // 显式选了中文时才加中文偏置提示（中英混说场景收益最大）；
      // 自动检测下不加任何提示，避免把输出语言「带偏」。
      if (asrLanguage === 'zh') {
        formData.append('initial_prompt', ASR_INITIAL_PROMPTS.zh);
      }
    }
    
    if (isLocal) {
      if (options?.videoId) {
        formData.append('video_id', options.videoId);
      }
      // 重新语音识别：跳过服务端字幕文本缓存，强制重新推理
      if (options?.noCache) {
        formData.append('no_cache', 'true');
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
    }, timeout, 3, options?.signal);

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

      // 如果循环结束后 resultText 仍为空，且 buffer 还有内容，尝试解析整个 buffer (兼容非流式响应)
      if (!resultText) {
        const finalContent = buffer.trim();
        if (finalContent) {
          try {
            const json = JSON.parse(finalContent);
            resultText = json.text || '';
          } catch (e) {
            // 忽略非 JSON 内容
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