import { describe, expect, it } from 'vitest';
import { buildSubtitleFileName, sanitizeSubtitleFileName } from './subtitleExport';

describe('subtitleExport', () => {
  it('将标题中的非法文件名字符替换为下划线', () => {
    expect(sanitizeSubtitleFileName('a/b:c*d?"e<f>g|h')).toBe('a_b_c_d__e_f_g_h');
  });

  it('空标题回退为默认名称', () => {
    expect(sanitizeSubtitleFileName('')).toBe('视频字幕');
    expect(sanitizeSubtitleFileName('   ')).toBe('视频字幕');
    expect(sanitizeSubtitleFileName(undefined)).toBe('视频字幕');
  });

  it('生成带 .txt 后缀的字幕文件名', () => {
    expect(buildSubtitleFileName('测试 视频')).toBe('测试 视频_字幕原文本.txt');
    expect(buildSubtitleFileName()).toBe('视频字幕_字幕原文本.txt');
  });
});
