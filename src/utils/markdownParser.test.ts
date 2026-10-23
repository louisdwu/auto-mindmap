import { describe, it, expect } from 'vitest';
import { parseMarkdown, collectExpandedIds, applyExpandedState } from './markdownParser';

describe('Markdown Parser', () => {
  it('should parse first # as root title', () => {
    const markdown = `# 视频主题
## 子主题1
### 子子主题1
## 子主题2`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('视频主题');
    expect(result.children.length).toBe(2);
    expect(result.children[0].text).toBe('子主题1');
  });

  it('should use default root title when no # present', () => {
    const markdown = `- 主题
  - 子主题1
    - 子子主题1
  - 子主题2`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('中心主题');
    expect(result.children.length).toBe(1);
    expect(result.children[0].text).toBe('主题');
  });

  it('should handle asterisk lists', () => {
    const markdown = `* 主题
  * 子主题1
    * 子子主题1
  * 子主题2`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('中心主题');
    expect(result.children.length).toBe(1);
  });

  it('should handle mixed format', () => {
    const markdown = `# 主题
- 子主题1
  - 子子主题1
## 子主题2
  - 子子主题2`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('主题');
    expect(result.children.length).toBe(2);
    expect(result.children[0].text).toBe('子主题1');
    expect(result.children[1].text).toBe('子主题2');
  });

  it('should handle indented text', () => {
    const markdown = `  主题
    子主题1
      子子主题1
    子主题2`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('中心主题');
    expect(result.children.length).toBe(1); // '主题' 是唯一的 Level 1 节点
    expect(result.children[0].text).toBe('主题');
    expect(result.children[0].children.length).toBe(2); // '子主题1' 和 '子主题2'
  });

  it('should handle complex structure', () => {
    const markdown = `# 视频主题
## 第一部分
- 要点1
  - 细节1.1
  - 细节1.2
- 要点2
## 第二部分
* 要点3
  * 细节3.1
* 要点4
  细节4.1
    细节4.1.1`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('视频主题');
    // Expect 2 main parts
    const part1 = result.children.find(c => c.text === '第一部分');
    const part2 = result.children.find(c => c.text === '第二部分');
    expect(part1).toBeDefined();
    expect(part2).toBeDefined();
  });

  it('should handle multiple headings but only use first # as root', () => {
    const markdown = `# 中心主题
## 第一章
### 第一节
#### 小节
## 第二章
### 第二节`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('中心主题');
    expect(result.children.length).toBe(2); // 第一章, 第二章
    expect(result.children[0].text).toBe('第一章');
    expect(result.children[0].children[0].text).toBe('第一节');
  });

  it('should handle pure list without headings', () => {
    const markdown = `- 子主题1
- 子主题2
  - 子子主题2.1`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('中心主题');
    expect(result.children.length).toBe(2);
  });
});

describe('展开状态的收集与还原', () => {
  const markdown = `# 主题
## 分支A
- 要点1
- 要点2
## 分支B
- 要点3`;

  it('新解析的导图默认只展开中心主题', () => {
    const tree = parseMarkdown(markdown);
    expect(tree.expanded).toBe(true);
    expect(tree.children.every(child => child.expanded === false)).toBe(true);
    expect(collectExpandedIds(tree)).toEqual([]);
  });

  it('收集已展开节点，排除中心主题', () => {
    const tree = parseMarkdown(markdown);
    const branchA = tree.children.find(child => child.text === '分支A')!;
    const point1 = branchA.children[0];
    branchA.expanded = true;
    point1.expanded = true;

    expect(collectExpandedIds(tree).sort()).toEqual([branchA.id, point1.id].sort());
  });

  it('按 id 集合还原展开状态，且中心主题始终展开', () => {
    const tree = parseMarkdown(markdown);
    const branchB = tree.children.find(child => child.text === '分支B')!;

    const restored = applyExpandedState(tree, new Set([branchB.id]));
    expect(restored.expanded).toBe(true);
    expect(restored.children.find(c => c.id === branchB.id)!.expanded).toBe(true);
    expect(restored.children.find(c => c.text === '分支A')!.expanded).toBe(false);
  });

  it('空集合表示全部折叠（中心主题除外）', () => {
    const tree = parseMarkdown(markdown);
    const restored = applyExpandedState(tree, new Set<string>());
    expect(restored.expanded).toBe(true);
    expect(restored.children.every(child => child.expanded === false)).toBe(true);
  });

  it('不传入集合时保留解析默认状态', () => {
    const tree = parseMarkdown(markdown);
    const restored = applyExpandedState(tree, null);
    expect(restored.children.every(child => child.expanded === false)).toBe(true);
  });

  it('还原过程不修改原树（纯函数）', () => {
    const tree = parseMarkdown(markdown);
    const branchA = tree.children.find(child => child.text === '分支A')!;
    applyExpandedState(tree, new Set([branchA.id]));
    expect(branchA.expanded).toBe(false);
  });

  it('收集后再还原可完整往返（含嵌套层级）', () => {
    const tree = parseMarkdown(markdown);
    const branchA = tree.children.find(child => child.text === '分支A')!;
    const point1 = branchA.children[0];
    point1.expanded = true;
    branchA.expanded = true;

    const restored = applyExpandedState(tree, new Set(collectExpandedIds(tree)));
    const restoredA = restored.children.find(child => child.text === '分支A')!;
    expect(restoredA.expanded).toBe(true);
    expect(restoredA.children.find(child => child.id === point1.id)!.expanded).toBe(true);
    expect(collectExpandedIds(restored).sort()).toEqual(collectExpandedIds(tree).sort());
  });
});