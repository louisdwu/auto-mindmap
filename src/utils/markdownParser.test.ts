import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './markdownParser';

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
    const markdown = `主题
  子主题1
    子子主题1
  子主题2`;
    const result = parseMarkdown(markdown);
    expect(result.text).toBe('中心主题');
    expect(result.children.length).toBe(1);
    expect(result.children[0].children.length).toBe(2);
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