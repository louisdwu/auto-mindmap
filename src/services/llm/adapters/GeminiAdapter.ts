import { ILLMAdapter, GenerateContext } from '../base';
import { BaseAdapter } from '../BaseAdapter';
import { LLMConfig, PluginConfig } from '../../../types/config';

export class GeminiAdapter extends BaseAdapter implements ILLMAdapter {
  /**
   * 获取完整的 API 请求 URL (Gemini)
   */
  getFullUrl(llmConfig: LLMConfig): string {
    let url = this.normalizeUrl(llmConfig.apiUrl);
    const modelName = llmConfig.model || 'gemini-1.5-flash';

    const hasModelsPath = url.includes('/models/');
    const hasGenerateContent = url.includes(':generateContent');

    if (!hasModelsPath && !hasGenerateContent) {
      url = `${url}/models/${modelName}:generateContent`;
    } else if (hasModelsPath && !hasGenerateContent) {
      url = `${url}:generateContent`;
    }

    const separator = url.includes('?') ? '&' : '?';
    if (!url.includes('key=') && llmConfig.apiKey) {
      url = `${url}${separator}key=${llmConfig.apiKey}`;
    }
    return url;
  }

  async generateMindmap(
    config: PluginConfig,
    llmConfig: LLMConfig,
    prompt: string,
    timeout: number,
    context?: GenerateContext
  ): Promise<string> {
    const url = this.getFullUrl(llmConfig);

    const requestBody: any = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: llmConfig.temperature ?? 0.7,
        maxOutputTokens: llmConfig.maxTokens ?? 2000
      }
    };

    const sysPrompt = context?.systemPrompt !== undefined ? context.systemPrompt : config.prompt.systemPrompt;
    if (sysPrompt && sysPrompt.trim()) {
      requestBody.system_instruction = {
        parts: [{ text: sysPrompt.trim() }]
      };
    }

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }, timeout);

    const responseText = await response.text();
    let data: any;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      throw new Error(`Gemini API 响应格式错误 (HTTP ${response.status}): ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      const errorCode = response.status;
      let errorMsg = data.error?.message || data.error?.status || responseText;
      if (errorCode === 403 && errorMsg.toLowerCase().includes('location is not supported')) {
        errorMsg = '您的 IP 所在地区不在 Google Gemini 的服务范围内（如中国大陆）。请开启“全局代理”或在 API 地址处填写可用的“反向代理地址”。';
      }
      throw new Error(`HTTP ${errorCode}: ${errorMsg}`);
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('Gemini API 返回的数据格式不正确');
    return content;
  }
}
