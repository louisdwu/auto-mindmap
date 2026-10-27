import { describe, expect, it } from 'vitest';
import { computeInputBudget, estimateTokens, splitTranscriptByBudget } from './tokenBudget';

describe('estimateTokens', () => {
  it('中文按接近 1 字 1 token 估算', () => {
    expect(estimateTokens('你好世界')).toBeGreaterThanOrEqual(5);
    expect(estimateTokens('你好世界')).toBeLessThanOrEqual(6);
  });

  it('英文按约 4 字符 1 token 估算', () => {
    const tokens = estimateTokens('hello world this is a test');
    expect(tokens).toBeGreaterThan(4);
    expect(tokens).toBeLessThan(12);
  });

  it('空文本返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('computeInputBudget', () => {
  it('从上下文窗口中扣除输出与 prompt 开销', () => {
    const budget = computeInputBudget({
      contextWindow: 8192,
      maxOutputTokens: 2048,
      systemPromptTokens: 500,
      templateTokens: 200
    });
    expect(budget).toBeLessThan(8192 - 2048 - 500 - 200);
    expect(budget).toBeGreaterThan(0);
  });

  it('输出上限不会把输入预算压成负数', () => {
    const budget = computeInputBudget({ contextWindow: 2048, maxOutputTokens: 999999 });
    expect(budget).toBeGreaterThanOrEqual(1000);
  });
});

describe('splitTranscriptByBudget', () => {
  it('短字幕不切分', () => {
    const text = '[00:01] 第一句\n[00:02] 第二句';
    expect(splitTranscriptByBudget(text, 1000)).toEqual([text]);
  });

  it('按行切分且不丢行、不超预算太多', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `[${String(i).padStart(2, '0')}:00] 这是第 ${i} 行测试字幕内容`);
    const text = lines.join('\n');
    const chunks = splitTranscriptByBudget(text, 300);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // 估算允许 10% 误差
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(330);
    }
    const joined = chunks.join('\n');
    for (const line of lines) {
      expect(joined).toContain(line);
    }
  });

  it('单行超长时硬切，并保留时间戳前缀', () => {
    const long = '这是一段非常长的字幕'.repeat(200);
    const chunks = splitTranscriptByBudget(`[12:34] ${long}`, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('[12:34]')).toBe(true);
    }
  });

  it('空文本返回空数组', () => {
    expect(splitTranscriptByBudget('   \n  ', 100)).toEqual([]);
  });
});
