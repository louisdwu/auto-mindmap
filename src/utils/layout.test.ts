import { describe, expect, it } from 'vitest';
import { INodeData } from './markdownParser';
import { calculateLayout } from './layout';

function makeTree(text: string): INodeData {
  return {
    id: 'root',
    text: '中心主题',
    level: 0,
    expanded: true,
    children: [
      {
        id: 'n1',
        text,
        level: 1,
        expanded: false,
        children: []
      }
    ]
  };
}

describe('calculateLayout 长文本换行', () => {
  it('短文本保持基础高度', () => {
    const positions = calculateLayout(makeTree('短标题'), { direction: 'right', fontSizeBase: 1 });
    const pos = positions.get('n1')!;
    expect(pos.height).toBe(pos.baseHeight);
  });

  it('长文本宽度受上限约束，高度随行数增长', () => {
    const longText = '这是一段很长的思维导图节点文本'.repeat(20);
    const positions = calculateLayout(makeTree(longText), { direction: 'right', fontSizeBase: 1 });
    const pos = positions.get('n1')!;

    expect(pos.width).toBeLessThanOrEqual(420);
    expect(pos.height).toBeGreaterThan(pos.baseHeight);
    // 单个一级节点会与根节点垂直居中，因此只校验尺寸，不假设 y > 0
  });

  it('字号缩放同时影响最大宽度与高度', () => {
    const longText = '很长的节点内容'.repeat(30);
    const normal = calculateLayout(makeTree(longText), { direction: 'right', fontSizeBase: 1 }).get('n1')!;
    const small = calculateLayout(makeTree(longText), { direction: 'right', fontSizeBase: 0.7 }).get('n1')!;

    expect(small.width).toBeLessThan(normal.width);
    expect(small.height).toBeLessThan(normal.height);
  });
});

describe('calculateLayout 时间戳徽章估宽', () => {
  it('尾部时间戳按徽章预留宽度，而不是按原始括号字符', () => {
    const stamped = calculateLayout(makeTree('疯狂购买GPU和内存 [00:10]'), { direction: 'right', fontSizeBase: 1 }).get('n1')!;
    const plain = calculateLayout(makeTree('疯狂购买GPU和内存'), { direction: 'right', fontSizeBase: 1 }).get('n1')!;
    // 一级节点英文字宽 10：徽章预留 = 5 字符 × 10 + 固定余量 22
    expect(stamped.width - plain.width).toBe(5 * 10 + 22);
  });

  it('预留宽度保证标题与徽章同行，不产生额外换行高度', () => {
    const stamped = calculateLayout(makeTree('疯狂购买GPU和内存 [00:10]'), { direction: 'right', fontSizeBase: 1 }).get('n1')!;
    expect(stamped.height).toBe(stamped.baseHeight);
  });

  it('开头时间戳同样剥离并预留徽章宽度', () => {
    const stamped = calculateLayout(makeTree('[00:10] 开场介绍'), { direction: 'right', fontSizeBase: 1 }).get('n1')!;
    const plain = calculateLayout(makeTree('开场介绍'), { direction: 'right', fontSizeBase: 1 }).get('n1')!;
    expect(stamped.width - plain.width).toBe(5 * 10 + 22);
  });

  it('正文中间的括号数字不按时间戳剥离，宽度计入括号字符', () => {
    const pos = calculateLayout(makeTree('屏幕(16:9)对比'), { direction: 'right', fontSizeBase: 1 }).get('n1')!;
    // 2×18 + 6×10 + 2×18 + padding 28
    expect(pos.width).toBe(2 * 18 + 6 * 10 + 2 * 18 + 28);
  });
});