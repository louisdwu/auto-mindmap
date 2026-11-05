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

import { DEFAULT_CONFIG, DEFAULT_LLM_CONFIG } from '../types/config';
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

describe('反思闸门与失败回退', () => {
  const subtitle = [
    '[00:00] 开场，今天聊财报',
    '[00:10] 公司营收 133.8 亿美元，同比增长 7.4%',
    '[00:20] 调整后每股收益 91 美分',
    '[00:30] 全年自由现金流 130 亿美元，指引上调至少 11%',
    '[00:40] 以上就是今天的全部内容'
  ].join('\n');

  const weakDraft = [
    '# 财报 [00:00]',
    '- 核心数据 [00:10]',
    '  - 营收增长 [00:10]',
    '  - 每股收益提升 [00:20]',
    '- 现金流与指引 [00:30]',
    '  - 现金流充裕 [00:30]',
    '  - 指引上调 [00:30]'
  ].join('\n');

  const goodDraft = [
    '# 财报 [00:00]',
    '- 核心数据 [00:10]',
    '  - 营收 133.8 亿美元 [00:10]',
    '  - 同比增长 7.4% [00:10]',
    '  - 每股收益 91 美分 [00:20]',
    '- 现金流与指引 [00:30]',
    '  - 自由现金流 130 亿美元 [00:30]',
    '  - 指引上调至少 11% [00:30]'
  ].join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(StorageService.getSelectedLLMConfig).mockResolvedValue(modelConfig);
    vi.mocked(StorageService.getLLMConfigById).mockResolvedValue(modelConfig);
  });

  it('初稿通过闸门时不再调用反思模型', async () => {
    const spy = vi.spyOn(LLMService as any, 'callLLM').mockResolvedValue(goodDraft);

    const result = await LLMService.generateMindmap(
      buildConfig({ enableReflection: true, enableChunking: false }),
      subtitle
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.result).toContain('133.8');
    expect(result.reflectionSuccess).toBe(true);
  });

  it('反思模型调用失败时回退初稿，不连累任务', async () => {
    const spy = vi.spyOn(LLMService as any, 'callLLM')
      .mockResolvedValueOnce(weakDraft)
      .mockRejectedValueOnce(new Error('HTTP 429: rate limited'));

    const result = await LLMService.generateMindmap(
      buildConfig({ enableReflection: true, enableChunking: false }),
      subtitle
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.result).toBe(weakDraft);
    expect(result.reflectionSuccess).toBe(false);
  });

  it('重写稿更完整时采用重写稿', async () => {
    const spy = vi.spyOn(LLMService as any, 'callLLM')
      .mockResolvedValueOnce(weakDraft)
      .mockResolvedValueOnce(goodDraft);

    const result = await LLMService.generateMindmap(
      buildConfig({ enableReflection: true, enableChunking: false }),
      subtitle
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.result).toContain('133.8');
    expect(result.initialResult).toBe(weakDraft);
  });

  it('重写稿还不如初稿时保留初稿', async () => {
    const worse = '# 财报 [00:00]\n- 一句话 [00:10]';
    const spy = vi.spyOn(LLMService as any, 'callLLM')
      .mockResolvedValueOnce(weakDraft)
      .mockResolvedValueOnce(worse);

    const result = await LLMService.generateMindmap(
      buildConfig({ enableReflection: true, enableChunking: false }),
      subtitle
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.result).toBe(weakDraft);
    expect(result.reflectionSuccess).toBe(false);
  });
});

describe('LLMService.fetchModels 通过 API 端点获取模型清单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功时返回模型清单与实际请求地址', async () => {
    const spy = vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue({
      getModelsUrl: (cfg: any) => `${cfg.apiUrl}/models`,
      listModels: async () => ['gpt-4o-mini', 'gpt-4o']
    });

    const result = await LLMService.fetchModels(modelConfig);

    expect(spy).toHaveBeenCalledWith('openai');
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gpt-4o-mini', 'gpt-4o']);
    expect(result.url).toBe('https://example.com/v1/models');
    expect(result.error).toBeUndefined();
  });

  it('适配器不支持清单时如实返回失败原因', async () => {
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue({
      getModelsUrl: (cfg: any) => `${cfg.apiUrl}/models`
    });

    const result = await LLMService.fetchModels(modelConfig);

    expect(result.ok).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toContain('不支持查询模型列表');
    expect(result.url).toBe('https://example.com/v1/models');
  });

  it('getModelsUrl 抛异常时回退 apiUrl 继续拉清单', async () => {
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue({
      getModelsUrl: () => { throw new Error('bad url'); },
      listModels: async () => ['m1']
    });

    const result = await LLMService.fetchModels(modelConfig);

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['m1']);
    expect(result.url).toBe('https://example.com/v1');
  });

  it('listModels 请求失败时返回错误信息', async () => {
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue({
      getModelsUrl: (cfg: any) => `${cfg.apiUrl}/models`,
      listModels: async () => { throw new Error('HTTP 401: invalid key'); }
    });

    const result = await LLMService.fetchModels(modelConfig);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 401');
    expect(result.models).toEqual([]);
  });

  it('默认配置（id=default）把内置 apiKey 透传给适配器', async () => {
    let seen: any;
    vi.spyOn(LLMService as any, 'getAdapter').mockImplementation(() => ({
      getModelsUrl: (cfg: any) => { seen = cfg; return `${cfg.apiUrl}/models`; },
      // 本地构建未注入内置 key 时 DEFAULT_LLM_CONFIG.apiKey 为空串，这里只校验透传值
      listModels: async (cfg: any) => [cfg.apiKey === DEFAULT_LLM_CONFIG.apiKey ? 'key-passthrough' : 'unexpected']
    }));

    const result = await LLMService.fetchModels({ ...modelConfig, id: 'default', apiKey: '' });

    expect(seen.apiKey).toBe(DEFAULT_LLM_CONFIG.apiKey);
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['key-passthrough']);
  });
});

describe('LLMService 模型优先级链故障切换', () => {
  beforeEach(() => {
    // 前面的 describe 在 callLLM 上留有带实现的 spy，会拦截这里的直接调用，先恢复
    vi.restoreAllMocks();
    vi.clearAllMocks();
    (LLMService as any).lastGoodModel.clear();
  });

  function makeChainConfig(models: string[]) {
    return { ...modelConfig, model: models[0], models };
  }

  it('链首失败自动切换到下一个，成功后返回', async () => {
    const adapter = {
      generateMindmap: vi.fn()
        .mockRejectedValueOnce(new Error('HTTP 404: model not found'))
        .mockResolvedValueOnce('# 导图\n- 一')
    };
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue(adapter);

    const result = await (LLMService as any).callLLM(
      buildConfig(),
      makeChainConfig(['m-primary', 'm-backup']),
      '测试 prompt'
    );

    expect(result).toContain('# 导图');
    expect(adapter.generateMindmap).toHaveBeenCalledTimes(2);
    // 第一次用链首，第二次用备选
    expect(adapter.generateMindmap.mock.calls[0][1].model).toBe('m-primary');
    expect(adapter.generateMindmap.mock.calls[1][1].model).toBe('m-backup');
  });

  it('全部模型失败时抛出最后一个错误', async () => {
    const adapter = { generateMindmap: vi.fn().mockRejectedValue(new Error('HTTP 429: limited')) };
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue(adapter);

    await expect((LLMService as any).callLLM(
      buildConfig(),
      makeChainConfig(['m1', 'm2', 'm3']),
      '测试 prompt'
    )).rejects.toThrow('HTTP 429');

    expect(adapter.generateMindmap).toHaveBeenCalledTimes(3);
  });

  it('成功过的模型在后续调用中优先尝试', async () => {
    const adapter = {
      generateMindmap: vi.fn()
        .mockRejectedValueOnce(new Error('HTTP 404: gone'))
        .mockResolvedValue('# ok')
    };
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue(adapter);
    const cfg = makeChainConfig(['dead-model', 'alive-model']);

    await (LLMService as any).callLLM(buildConfig(), cfg, '第一次调用');
    await (LLMService as any).callLLM(buildConfig(), cfg, '第二次调用');

    // 第二次直接用上次成功的 alive-model，不再碰 dead-model
    expect(adapter.generateMindmap).toHaveBeenCalledTimes(3);
    expect(adapter.generateMindmap.mock.calls[1][1].model).toBe('alive-model');
    expect(adapter.generateMindmap.mock.calls[2][1].model).toBe('alive-model');
  });

  it('用户取消时不切换备选模型，直接抛出', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const adapter = { generateMindmap: vi.fn().mockRejectedValue(abortError) };
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue(adapter);
    const controller = new AbortController();
    controller.abort();

    await expect((LLMService as any).callLLM(
      buildConfig(),
      makeChainConfig(['m1', 'm2']),
      '测试 prompt',
      { signal: controller.signal }
    )).rejects.toThrow('aborted');

    expect(adapter.generateMindmap).toHaveBeenCalledTimes(1);
  });

  it('模型链为空时给出可操作的错误提示', async () => {
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue({ generateMindmap: vi.fn() });

    await expect((LLMService as any).callLLM(
      buildConfig(),
      { ...modelConfig, model: '', models: [] },
      '测试 prompt'
    )).rejects.toThrow('未配置模型名称');
  });

  it('旧配置只有单 model 字段也能正常走链（兼容回退）', async () => {
    const adapter = { generateMindmap: vi.fn().mockResolvedValue('# ok') };
    vi.spyOn(LLMService as any, 'getAdapter').mockReturnValue(adapter);

    const result = await (LLMService as any).callLLM(
      buildConfig(),
      { ...modelConfig, model: 'legacy-model', models: undefined },
      '测试 prompt'
    );

    expect(result).toBe('# ok');
    expect(adapter.generateMindmap.mock.calls[0][1].model).toBe('legacy-model');
  });
});
