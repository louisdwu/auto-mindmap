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

describe('OpenAIAdapter.getModelsUrl', () => {
  const adapter = new OpenAIAdapter();

  it('从 chat/completions 推出同源的 /models', () => {
    expect(adapter.getModelsUrl(makeConfig('sensenova', 'https://token.sensenova.cn/v1'))).toBe(
      'https://token.sensenova.cn/v1/models'
    );
  });

  it('用户填了完整 chat/completions 地址也能正确推出', () => {
    expect(adapter.getModelsUrl(makeConfig('custom', 'https://example.com/v1/chat/completions'))).toBe(
      'https://example.com/v1/models'
    );
  });
});

describe('OpenAIAdapter.listModels', () => {
  const adapter = new OpenAIAdapter();

  function stubFetch(status: number, body: unknown) {
    const response = {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async () => response) as unknown as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  it('解析 {data:[{id}]} 结构', async () => {
    const restore = stubFetch(200, { data: [{ id: 'sensenova-6.8-flash-lite' }, { id: 'sensenova-6.7-flash-lite' }] });
    try {
      await expect(adapter.listModels(makeConfig('sensenova', 'https://token.sensenova.cn/v1'), 5000)).resolves.toEqual([
        'sensenova-6.8-flash-lite',
        'sensenova-6.7-flash-lite'
      ]);
    } finally {
      restore();
    }
  });

  it('兼容 {models:[...]} 与纯字符串数组', async () => {
    const restore = stubFetch(200, { models: [{ name: 'a-model' }, 'b-model'] });
    try {
      await expect(adapter.listModels(makeConfig('custom', 'https://example.com/v1'), 5000)).resolves.toEqual([
        'a-model',
        'b-model'
      ]);
    } finally {
      restore();
    }
  });

  it('鉴权失败时抛出可读错误，而不是静默返回空列表', async () => {
    const restore = stubFetch(401, { error: { message: 'Forbidden' } });
    try {
      await expect(adapter.listModels(makeConfig('sensenova', 'https://token.sensenova.cn/v1'), 5000)).rejects.toThrow(
        /HTTP 401/
      );
    } finally {
      restore();
    }
  });
});
