import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./storageService', () => ({
  StorageService: {
    getSelectedLLMConfig: vi.fn(),
    getLLMConfigById: vi.fn()
  }
}));

vi.mock('./loggerService', () => ({
  LoggerService: {
    info: vi.fn(async () => {}),
    warn: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
    debug: vi.fn(async () => {})
  }
}));

import { DEFAULT_CONFIG } from '../types/config';
import { LLMService } from './llmService';
import { StorageService } from './storageService';

const modelConfig = {
  id: 'test',
  name: 'Test',
  provider: 'openai' as const,
  apiUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  timeout: 30,
  maxTokens: 1000,
  num_ctx: 4000,
  temperature: 0.5,
  createdAt: 0,
  updatedAt: 0
};

function buildConfig(overrides: Partial<typeof DEFAULT_CONFIG.settings> = {}) {
  return {
    ...DEFAULT_CONFIG,
    prompt: {
      systemPrompt: '系统提示',
      template: '请生成导图：\n{subtitle_content}',
      reflectionPrompt: DEFAULT_CONFIG.prompt.reflectionPrompt
    },
    settings: {
      ...DEFAULT_CONFIG.settings,
      enableReflection: false,
      enableChunking: true,
      ...overrides
    }
  };
}

function buildSubtitle(lines = 400): string {
  return Array.from({ length: lines }, (_, i) => {
    const sec = String(i % 60).padStart(2, '0');
    return `[00:${sec}] 这是第 ${i} 行字幕，包含关键数据 ${i}% 以及一些解释性文本。`;
  }).join('\n');
}

describe('LLMService 长视频分段', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(StorageService.getSelectedLLMConfig).mockResolvedValue(modelConfig);
    vi.mocked(StorageService.getLLMConfigById).mockResolvedValue(modelConfig);
  });

  it('超长字幕会走分段 + 合并 + 最终生成', async () => {
    const prompts: string[] = [];
    const spy = vi.spyOn(LLMService as any, 'callLLM').mockImplementation(async (...args: any[]) => {
      prompts.push(String(args[2]));
      return '\`\`\`markdown\n# 分段结果\n- 要点 [00:01]\n\`\`\`';
    });

    const result = await LLMService.generateMindmap(buildConfig(), buildSubtitle());

    expect(spy.mock.calls.length).toBeGreaterThan(1);
    expect(prompts.some(p => p.includes('第 1/'))).toBe(true);
    expect(prompts.some(p => p.includes('分段提炼的提纲'))).toBe(true);
    expect(result.result).toContain('# 分段结果');
  });

  it('短字幕只调用一次', async () => {
    const spy = vi.spyOn(LLMService as any, 'callLLM').mockResolvedValue('\`\`\`markdown\n# 短\n- 一\n\`\`\`');

    const result = await LLMService.generateMindmap(buildConfig(), '[00:00] 很短的一段字幕');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.result).toContain('# 短');
  });

  it('关闭分段时保持单次调用（把超限交给上游报错）', async () => {
    const spy = vi.spyOn(LLMService as any, 'callLLM').mockResolvedValue('# 单次\n- 一');

    await LLMService.generateMindmap(buildConfig({ enableChunking: false }), buildSubtitle());

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('反思阶段输入超限时跳过反思并返回初稿', async () => {
    const spy = vi.spyOn(LLMService as any, 'callLLM').mockResolvedValue('# 初稿\n- 一 [00:01]');

    const result = await LLMService.generateMindmap(
      buildConfig({ enableReflection: true, enableChunking: false }),
      buildSubtitle(2000)
    );

    // 一次主生成；反思因 prompt 超限被跳过，不应再调用
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.result).toContain('# 初稿');
    expect(result.reflectionSuccess).toBe(false);
  });
});