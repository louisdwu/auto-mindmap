/**
 * Markdown 思维导图解析器
 * 将 Markdown 内容解析为树形节点数据结构
 * 支持多种格式：
 * - # 标题格式（# ## ### 等）
 * - 列表格式（- 或 *）
 * - 缩进表示层级
 */

export interface INodeData {
  id: string;
  text: string;
  level: number;      // 标题层级 0-6
  children: INodeData[];
  expanded?: boolean;
}

/**
 * 解析 Markdown 字符串为树形结构
 * 支持多种格式：# 标题、列表项、缩进
 * @param markdown Markdown 格式的字符串
 * @returns INodeData 树形结构
 */
export function parseMarkdown(markdown: string): INodeData {
  // 预处理：查找第一个 # 标题作为中心主题
  const lines = markdown.split('\n');
  
  // 初始化默认中心主题
  let rootNode: INodeData = {
    id: 'root',
    text: '中心主题',
    level: 0,
    children: [],
    expanded: true
  };

  // 查找第一个 # 标题
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const text = headingMatch[2].trim().replace(/\s*-\s*$/, '');
      if (text) {
        // 使用第一个 # 标题作为中心主题
        rootNode = {
          id: 'root',
          text: text,
          level: 0,
          children: [],
          expanded: true
        };
        break;
      }
    }
  }

  // 使用栈来维护当前路径上的父节点
  // 栈中存储 (节点, 最小层级)
  const stack: { node: INodeData; minLevel: number }[] = [{ node: rootNode, minLevel: 0 }];

  let nodeIdCounter = 0;
  let currentBaseLevel = 0; // 当前基础层级（用于列表项的相对层级计算）
  let isFirstHeading = true; // 标记是否是第一个 # 标题

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // 1. 匹配 # 标题格式
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim().replace(/\s*-\s*$/, '');

      if (text) {
        // 如果是第一个 # 标题，跳过（已作为中心主题）
        if (isFirstHeading) {
          isFirstHeading = false;
          currentBaseLevel = level;
          continue;
        }

        processNode(text, level, stack, nodeIdCounter++);
        currentBaseLevel = level; // 更新基础层级
      }
      continue;
    }

    // 2. 匹配列表项格式（- 或 *）
    const listMatch = trimmedLine.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      const text = listMatch[1].trim();

      // 计算缩进层级（每2个空格或1个tab算一级）
      const indentLevel = calculateIndentLevel(line);

      if (text) {
        // 列表项的层级 = 基础层级 + 缩进层级
        const actualLevel = currentBaseLevel + indentLevel + 1;
        processNode(text, actualLevel, stack, nodeIdCounter++);
      }
      continue;
    }

    // 3. 匹配纯文本（可能是缩进的子项）
    // 如果行首不是 #、-、*，但有缩进，则作为子项处理
    if (!trimmedLine.startsWith('#') && !trimmedLine.startsWith('-') && !trimmedLine.startsWith('*')) {
      const indentLevel = calculateIndentLevel(line);

      if (indentLevel > 0 && trimmedLine) {
        // 纯文本的层级 = 基础层级 + 缩进层级
        const actualLevel = currentBaseLevel + indentLevel;
        processNode(trimmedLine, actualLevel, stack, nodeIdCounter++);
      }
    }
  }

  return rootNode;
}

/**
 * 计算缩进层级
 * 每2个空格或1个tab算一级
 */
function calculateIndentLevel(line: string): number {
  const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';
  const tabCount = (leadingSpaces.match(/\t/g) || []).length;
  const spaceCount = leadingSpaces.replace(/\t/g, '').length;
  
  // 1个tab = 2个空格
  const totalIndent = tabCount * 2 + Math.floor(spaceCount / 2);
  return totalIndent;
}

/**
 * 处理单个节点
 */
function processNode(
  text: string,
  level: number,
  stack: { node: INodeData; minLevel: number }[],
  idCounter: number
): void {
  // 弹出比当前层级深或相等的节点，找到正确的父节点
  // 例如：# A (level1) -> ## B (level2) -> ### C (level3) -> ## D (level2)
  // 当遇到 ## D 时，需要弹出 C(3) 和 B(2)，回到 A(1)
  while (stack.length > 1 && stack[stack.length - 1].minLevel >= level) {
    stack.pop();
  }

  // 获取父节点
  const parentInfo = stack[stack.length - 1];
  const parentNode = parentInfo.node;

  // 创建新节点
  const newNode: INodeData = {
    id: `node-${idCounter}`,
    text: text,
    level: level,
    children: [],
    expanded: false
  };

  // 添加为父节点的子节点
  parentNode.children.push(newNode);

  // 将新节点压入栈
  stack.push({ node: newNode, minLevel: level });
}

/**
 * 获取可见节点（考虑展开状态）
 */
export function getVisibleNodes(node: INodeData): INodeData[] {
  const nodes: INodeData[] = [node];
  if (node.expanded) {
    for (const child of node.children) {
      nodes.push(...getVisibleNodes(child));
    }
  }
  return nodes;
}