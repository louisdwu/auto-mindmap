import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from './OpenAIAdapter';
import { LLMConfig, LLMProvider } from '../../../types/config';

function makeConfig(provider: LLMProvider, apiUrl: string, model = 'demo-model'): LLMConfig {
  return {
    id: 'test',
    name: 'test',
    provider,
    apiUrl,
    apiKey: '',
    model,
    createdAt: 0,
    updatedAt: 0
  };
}

describe('OpenAIAdapter.getFullUrl', () => {
  const adapter = new OpenAIAdapter();

  it('OpenAI 兼容提供商只补一次 /chat/completions', () => {
    for (const provider of ['openai', 'custom', 'lmstudio', 'sensenova'] as LLMProvider[]) {
      expect(adapter.getFullUrl(makeConfig(provider, 'https://example.com/v1'))).toBe(
        'https://example.com/v1/chat/completions'
      );
    }
  });

  it('已经填了完整 URL 时不重复拼接', () => {
    expect(adapter.getFullUrl(makeConfig('custom', 'https://example.com/v1/chat/completions'))).toBe(
      'https://example.com/v1/chat/completions'
    );
  });

  it('结尾多余斜杠被归一化', () => {
    expect(adapter.getFullUrl(makeConfig('sensenova', 'https://token.sensenova.cn/v1/'))).toBe(
      'https://token.sensenova.cn/v1/chat/completions'
    );
  });

  it('商汤 SenseNova 基址拼出的就是官方文档里的请求地址', () => {
    expect(adapter.getFullUrl(makeConfig('sensenova', 'https://token.sensenova.cn/v1'))).toBe(
      'https://token.sensenova.cn/v1/chat/completions'
    );
  });
});
