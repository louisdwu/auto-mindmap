import { describe, it, expect } from 'vitest';
import { ASR_LANGUAGE_OPTIONS, DEFAULT_ASR_LANGUAGE, DEFAULT_CONFIG, normalizeAsrLanguage } from './config';

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
