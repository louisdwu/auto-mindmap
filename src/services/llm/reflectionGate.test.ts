import { describe, expect, it } from 'vitest';
import { evaluateMindmapDraft, compareDrafts, extractDataPoints, parseStamp } from './reflectionGate';

const subtitle = [
  '[00:00] 开场，今天聊财报',
  '[00:10] 公司营收 133.8 亿美元，同比增长 7.4%',
  '[00:20] 调整后每股收益 91 美分',
  '[00:30] 全年自由现金流 130 亿美元，指引上调至少 11%',
  '[00:40] 以上就是今天的全部内容'
].join('\n');

const goodDraft = [
  '# 财报速览 [00:00]',
  '- 核心数据 [00:10]',
  '  - 营收 133.8 亿美元 [00:10]',
  '  - 同比增长 7.4% [00:10]',
  '  - 每股收益 91 美分 [00:20]',
  '- 现金流与指引 [00:30]',
  '  - 自由现金流 130 亿美元 [00:30]',
  '  - 指引上调至少 11% [00:30]'
].join('\n');

describe('extractDataPoints / parseStamp', () => {
  it('抽取百分比、金额、日期与年份并归一化空格', () => {
    const points = extractDataPoints('营收 133.8 亿美元，增长 7.4%，12 月 7 日发布，2028 年量产');
    expect(points.has('133.8亿')).toBe(true);
    expect(points.has('7.4%')).toBe(true);
    expect(points.has('12月7日')).toBe(true);
    expect(points.has('2028年')).toBe(true);
  });

  it('解析时间戳为秒', () => {
    expect(parseStamp('01:23')).toBe(83);
    expect(parseStamp('1:02:03')).toBe(3723);
    expect(parseStamp('abc')).toBeNull();
  });
});

describe('evaluateMindmapDraft', () => {
  it('结构、时间戳、数据点都齐时通过', () => {
    const result = evaluateMindmapDraft(goodDraft, subtitle);
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.metrics.dataPointRecall).toBe(1);
  });

  it('结尾内容被漏掉时拒绝', () => {
    const source = [
      '[00:00] 开场',
      '[02:00] 公司营收 133.8 亿美元，增长 7.4%',
      '[04:00] 每股收益 91 美分',
      '[06:00] 自由现金流 130 亿美元',
      '[08:00] 指引上调至少 11%',
      '[12:00] 结尾'
    ].join('\n');
    const draft = [
      '# 财报 [00:00]',
      '- 开场 [00:00]',
      '- 营收 133.8 亿美元 [02:00]',
      '  - 增长 7.4% [02:00]',
      '- 每股收益 91 美分 [04:00]',
      '- 现金流 130 亿美元 [06:00]',
      '- 指引 11% [08:00]'
    ].join('\n');

    const result = evaluateMindmapDraft(draft, source);
    expect(result.pass).toBe(false);
    expect(result.reasons.join('；')).toContain('结尾');
  });

  it('定量数据点丢失时拒绝', () => {
    const draft = [
      '# 财报 [00:00]',
      '- 核心数据 [00:10]',
      '  - 营收增长 [00:10]',
      '  - 每股收益提升 [00:20]',
      '- 现金流与指引 [00:30]',
      '  - 现金流充裕 [00:30]',
      '  - 指引上调 [00:30]'
    ].join('\n');

    const result = evaluateMindmapDraft(draft, subtitle);
    expect(result.pass).toBe(false);
    expect(result.reasons.join('；')).toContain('数据点');
  });

  it('混用 ## 标题时拒绝', () => {
    const draft = goodDraft.replace('- 核心数据 [00:10]', '## 核心数据 [00:10]');
    const result = evaluateMindmapDraft(draft, subtitle);
    expect(result.pass).toBe(false);
    expect(result.reasons.join('；')).toContain('二级');
  });

  it('缩进不是 2 的整数倍时拒绝', () => {
    const draft = goodDraft.replace('  - 营收 133.8 亿美元 [00:10]', '   - 营收 133.8 亿美元 [00:10]');
    const result = evaluateMindmapDraft(draft, subtitle);
    expect(result.pass).toBe(false);
    expect(result.reasons.join('；')).toContain('缩进');
  });

  it('节点过少时拒绝', () => {
    const result = evaluateMindmapDraft('# 只有标题\n- 一句话 [00:00]', subtitle);
    expect(result.pass).toBe(false);
    expect(result.reasons.join('；')).toContain('节点');
  });
});

describe('compareDrafts', () => {
  const draft = '# 财报 [00:00]\n- 核心数据 [00:10]\n  - 营收增长 [00:10]\n  - 每股收益提升 [00:20]\n- 现金流 [00:30]\n  - 现金流充裕 [00:30]\n  - 指引上调 [00:30]';

  it('重写稿补齐数据后采纳', () => {
    const verdict = compareDrafts(draft, goodDraft, subtitle);
    expect(verdict.adopt).toBe(true);
  });

  it('重写稿更差时拒绝', () => {
    const worse = '# 财报 [00:00]\n- 一句话 [00:10]';
    const verdict = compareDrafts(draft, worse, subtitle);
    expect(verdict.adopt).toBe(false);
  });

  it('重写稿为空时拒绝', () => {
    const verdict = compareDrafts(draft, '', subtitle);
    expect(verdict.adopt).toBe(false);
  });
});
