import { describe, it, expect } from 'vitest';
import {
  ASR_LANGUAGE_OPTIONS,
  DEFAULT_ASR_LANGUAGE,
  DEFAULT_CONFIG,
  DEFAULT_LLM_CONFIG,
  LLM_PROVIDER_PRESETS,
  createDefaultLLMConfig,
  getModelChain,
  getProviderLabel,
  normalizeAsrLanguage
} from './config';

describe('normalizeAsrLanguage', () => {
  it('缺省与空值一律回落到自动检测', () => {
    expect(normalizeAsrLanguage(undefined)).toBe(DEFAULT_ASR_LANGUAGE);
    expect(normalizeAsrLanguage(null)).toBe(DEFAULT_ASR_LANGUAGE);
    expect(normalizeAsrLanguage('')).toBe(DEFAULT_ASR_LANGUAGE);
    expect(normalizeAsrLanguage('   ')).toBe(DEFAULT_ASR_LANGUAGE);
  });

  it('auto / detect 等哨兵值等价于自动检测', () => {
    expect(normalizeAsrLanguage('auto')).toBe('auto');
    expect(normalizeAsrLanguage('AUTO')).toBe('auto');
    expect(normalizeAsrLanguage('detect')).toBe('auto');
    expect(normalizeAsrLanguage('none')).toBe('auto');
  });

  it('地区子标签收敛为主语言代码', () => {
    expect(normalizeAsrLanguage('zh-CN')).toBe('zh');
    expect(normalizeAsrLanguage('zh-TW')).toBe('zh');
    expect(normalizeAsrLanguage('en-US')).toBe('en');
  });

  it('未知语言原样透传，由引擎自行决定是否支持', () => {
    expect(normalizeAsrLanguage('klingon')).toBe('klingon');
  });

  it('默认配置必须是自动检测（否则英文视频会被改写成中文）', () => {
    expect(DEFAULT_CONFIG.settings.asrLanguage).toBe('auto');
    expect(ASR_LANGUAGE_OPTIONS[0].value).toBe('auto');
  });
});

describe('LLM_PROVIDER_PRESETS（仅保留自定义）', () => {
  it('只包含 custom，且指向 OpenAI 兼容协议', () => {
    expect(Object.keys(LLM_PROVIDER_PRESETS)).toEqual(['custom']);
    expect(LLM_PROVIDER_PRESETS.custom.tagline).toContain('OpenAI');
  });

  it('历史 provider 仍能取到展示名（旧配置显示来路）', () => {
    expect(getProviderLabel('sensenova')).toBe('商汤 SenseNova');
    expect(getProviderLabel('ollama')).toBe('Ollama');
    expect(getProviderLabel('some-legacy-provider')).toBe('some-legacy-provider');
    expect(getProviderLabel('')).toBe('自定义');
  });
});

describe('createDefaultLLMConfig', () => {
  it('统一创建 custom 配置，地址为空交由用户填写', () => {
    const config = createDefaultLLMConfig('sensenova');

    expect(config.provider).toBe('custom');
    expect(config.apiUrl).toBe('');
    expect(config.model).toBe('');
    expect(config.apiKey).toBe('');
    expect(config.id).not.toBe('default');
  });

  it('默认兜底配置走 Ollama 的 OpenAI 兼容端点', () => {
    expect(DEFAULT_LLM_CONFIG.provider).toBe('custom');
    expect(DEFAULT_LLM_CONFIG.apiUrl).toBe('http://localhost:11434/v1');
  });
});

describe('getModelChain 模型优先级链', () => {
  it('models 有效时按序返回，并忽略空项', () => {
    expect(getModelChain({ model: 'legacy', models: ['a', '', 'b'] })).toEqual(['a', 'b']);
  });

  it('models 为空时回退到旧的单模型字段（旧配置免迁移）', () => {
    expect(getModelChain({ model: 'legacy', models: [] })).toEqual(['legacy']);
    expect(getModelChain({ model: 'legacy' })).toEqual(['legacy']);
  });

  it('两者都为空时返回空数组', () => {
    expect(getModelChain({ model: '', models: [] })).toEqual([]);
    expect(getModelChain({ model: '   ' })).toEqual([]);
  });
});
