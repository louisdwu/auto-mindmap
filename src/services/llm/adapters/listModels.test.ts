import { describe, it, expect } from 'vitest';
import { OllamaAdapter } from './OllamaAdapter';
import { GeminiAdapter } from './GeminiAdapter';
import { LLMConfig } from '../../../types/config';

function makeConfig(provider: LLMConfig['provider'], apiUrl: string, apiKey = 'test-key'): LLMConfig {
  return { id: 't', name: 't', provider, apiUrl, apiKey, model: 'm', createdAt: 0, updatedAt: 0 };
}

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

describe('OllamaAdapter 模型清单', () => {
  const adapter = new OllamaAdapter();

  it('基址推 /api/tags，不会重复拼 /api', () => {
    expect(adapter.getTagsUrl(makeConfig('ollama', 'http://localhost:11434/api'))).toBe(
      'http://localhost:11434/api/tags'
    );
    expect(adapter.getTagsUrl(makeConfig('ollama', 'http://localhost:11434'))).toBe(
      'http://localhost:11434/api/tags'
    );
    expect(adapter.getTagsUrl(makeConfig('ollama', 'https://ollama.com/api/chat'))).toBe(
      'https://ollama.com/api/tags'
    );
  });

  it('解析 {models:[{name,model}]}', async () => {
    const restore = stubFetch(200, { models: [{ name: 'llama3:latest' }, { model: 'qwen3:8b' }] });
    try {
      await expect(adapter.listModels(makeConfig('ollama', 'http://localhost:11434/api'), 5000)).resolves.toEqual([
        'llama3:latest',
        'qwen3:8b'
      ]);
    } finally {
      restore();
    }
  });
});

describe('GeminiAdapter 模型清单', () => {
  const adapter = new GeminiAdapter();

  it('从基址推 /models 并带上 key', () => {
    expect(adapter.getModelsUrl(makeConfig('gemini', 'https://generativelanguage.googleapis.com/v1beta', 'k123'))).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?key=k123'
    );
  });

  it('用户填了完整 models/<model>:generateContent 也能回到基址', () => {
    expect(
      adapter.getModelsUrl(
        makeConfig('gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent')
      )
    ).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=test-key');
  });

  it('去掉 models/ 前缀，返回可直接填入的模型名', async () => {
    const restore = stubFetch(200, {
      models: [{ name: 'models/gemini-1.5-flash' }, { name: 'models/gemini-1.5-pro' }]
    });
    try {
      await expect(
        adapter.listModels(makeConfig('gemini', 'https://generativelanguage.googleapis.com/v1beta'), 5000)
      ).resolves.toEqual(['gemini-1.5-flash', 'gemini-1.5-pro']);
    } finally {
      restore();
    }
  });
});
