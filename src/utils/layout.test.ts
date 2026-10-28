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