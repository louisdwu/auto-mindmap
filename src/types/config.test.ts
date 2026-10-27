import { describe, it, expect } from 'vitest';
import {
  ASR_LANGUAGE_OPTIONS,
  DEFAULT_ASR_LANGUAGE,
  DEFAULT_CONFIG,
  LLM_PROVIDER_PRESETS,
  createDefaultLLMConfig,
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

describe('LLM_PROVIDER_PRESETS', () => {
  it('每个提供商都有展示名；除自定义外都必须带完整基址', () => {
    for (const [provider, preset] of Object.entries(LLM_PROVIDER_PRESETS)) {
      expect(preset.label.length).toBeGreaterThan(0);
      if (provider !== 'custom') {
        expect(preset.apiUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it('商汤 SenseNova 预设必须与官方文档一致（基址带 /v1、模型标识一字不差）', () => {
    const preset = LLM_PROVIDER_PRESETS.sensenova;

    expect(preset.apiUrl).toBe('https://token.sensenova.cn/v1');
    expect(preset.model).toBe('sensenova-6.8-flash-lite');
  });

  it('getProviderLabel 兼容历史/未知 provider', () => {
    expect(getProviderLabel('sensenova')).toBe('商汤 SenseNova');
    expect(getProviderLabel('some-legacy-provider')).toBe('some-legacy-provider');
    expect(getProviderLabel('')).toBe('自定义');
  });
});

describe('createDefaultLLMConfig', () => {
  it('新增配置时直接用预设的地址与模型，避免手填出错', () => {
    const config = createDefaultLLMConfig('sensenova');

    expect(config.provider).toBe('sensenova');
    expect(config.apiUrl).toBe(LLM_PROVIDER_PRESETS.sensenova.apiUrl);
    expect(config.model).toBe(LLM_PROVIDER_PRESETS.sensenova.model);
    expect(config.apiKey).toBe('');
    expect(config.id).not.toBe('default');
  });

  it('自定义提供商保持空白地址，交由用户填写', () => {
    const config = createDefaultLLMConfig('custom');

    expect(config.apiUrl).toBe('');
    expect(config.model).toBe('');
  });
});
