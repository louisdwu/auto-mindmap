/**
 * 思维导图布局计算器
 * 计算树形节点的坐标位置
 */

import { INodeData } from './markdownParser';

/**
 * 获取所有节点（包括折叠的子节点）
 */
function getAllNodes(node: INodeData): INodeData[] {
  const nodes: INodeData[] = [node];
  for (const child of node.children) {
    nodes.push(...getAllNodes(child));
  }
  return nodes;
}

export interface NodePosition {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId?: string;
}

export interface LayoutOptions {
  direction: 'left' | 'right' | 'both';  // 布局方向
  horizontalSpacing: number;  // 水平间距（基础值）
  verticalSpacing: number;    // 垂直间距（基础值）
  nodeWidth: number;          // 节点默认宽度
  nodeHeight: number;         // 节点默认高度
  centerOffset: number;       // 中心偏移量
  levelSpacingMultiplier: number; // 层级间距倍数（越深层级间距越紧凑）
}

/**
 * 计算思维导图布局
 */
export function calculateLayout(
  root: INodeData,
  options: Partial<LayoutOptions> = {}
): Map<string, NodePosition> {
  const {
    direction = 'both',
    horizontalSpacing = 140,
    verticalSpacing = 16,  // 基础间距
    nodeWidth = 100,
    nodeHeight = 32,
    centerOffset = 0,
    levelSpacingMultiplier = 0.85
  } = options;

  const positions = new Map<string, NodePosition>();

  // 计算每个节点需要的实际宽度（基于文本长度）
  // 注意：需要计算所有节点的尺寸，包括折叠的子节点，因为布局计算时需要用到
  const allNodes = getAllNodes(root);
  const nodeDimensions = calculateNodeDimensions(allNodes, nodeWidth, nodeHeight);

  if (direction === 'both') {
    // 左右分布布局
    calculateBothDirectionLayout(root, positions, nodeDimensions, {
      horizontalSpacing,
      verticalSpacing,
      centerOffset,
      levelSpacingMultiplier
    });
  } else {
    // 单方向布局
    calculateSingleDirectionLayout(root, positions, nodeDimensions, {
      horizontalSpacing,
      verticalSpacing,
      direction,
      levelSpacingMultiplier
    });
  }

  return positions;
}

/**
 * 根据层级获取字体大小配置
 * 字号层级规则：
 * - 根节点 (level 0): 22px
 * - 一级节点 (level 1): 18px
 * - 二级节点 (level 2): 16px
 * - 三级节点 (level 3): 14px
 * - 四级及更深节点 (level 4+): 13px
 */
function getFontConfig(level: number): { chineseWidth: number; englishWidth: number; padding: number; baseHeight: number } {
  switch (level) {
    case 0: // 根节点
      return { chineseWidth: 22, englishWidth: 12, padding: 56, baseHeight: 52 };
    case 1: // 一级节点
      return { chineseWidth: 18, englishWidth: 10, padding: 28, baseHeight: 36 };
    case 2: // 二级节点
      return { chineseWidth: 16, englishWidth: 9, padding: 24, baseHeight: 32 };
    case 3: // 三级节点
      return { chineseWidth: 14, englishWidth: 8, padding: 20, baseHeight: 30 };
    default: // 四级及更深节点
      return { chineseWidth: 13, englishWidth: 7, padding: 20, baseHeight: 28 };
  }
}

/**
 * 计算节点尺寸（基于文本长度和层级）
 * 对于长文本节点，增加额外的高度来避免重叠
 */
function calculateNodeDimensions(
  nodes: INodeData[],
  _defaultWidth: number,
  _defaultHeight: number
): Map<string, { width: number; height: number }> {
  const dimensions = new Map<string, { width: number; height: number }>();

  for (const node of nodes) {
    const text = node.text;
    const fontConfig = getFontConfig(node.level);
    
    // 根据层级和字体大小计算宽度
    let estimatedWidth = 0;
    for (const char of text) {
      // 判断是否为中文字符（包括中文标点）
      if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(char)) {
        estimatedWidth += fontConfig.chineseWidth;
      } else {
        estimatedWidth += fontConfig.englishWidth;
      }
    }
    // 添加 padding
    estimatedWidth += fontConfig.padding;
    // 设置最小宽度
    estimatedWidth = Math.max(60, estimatedWidth);

    // 高度计算
    const isRoot = node.id === 'root';
    let estimatedHeight: number;
    
    if (isRoot) {
      estimatedHeight = fontConfig.baseHeight;
    } else {
      // 基础显示高度根据层级不同
      const baseHeight = fontConfig.baseHeight;
      // 对于宽度超过阈值的节点，按比例增加虚拟高度
      // 宽度 180px 以下：不增加
      // 宽度 180-350px：增加 (width - 180) / 12 的高度
      // 宽度 350px 以上：增加更多
      let extraHeight = 0;
      if (estimatedWidth > 180) {
        if (estimatedWidth <= 350) {
          extraHeight = Math.floor((estimatedWidth - 180) / 12);
        } else {
          // 180-350 的部分贡献约 14px，350以上的部分贡献更多
          extraHeight = 14 + Math.floor((estimatedWidth - 350) / 10);
        }
      }
      estimatedHeight = baseHeight + extraHeight;
    }

    dimensions.set(node.id, {
      width: estimatedWidth,
      height: estimatedHeight
    });
  }

  return dimensions;
}

/**
 * 左右分布布局
 */
function calculateBothDirectionLayout(
  root: INodeData,
  positions: Map<string, NodePosition>,
  dimensions: Map<string, { width: number; height: number }>,
  options: { horizontalSpacing: number; verticalSpacing: number; centerOffset: number; levelSpacingMultiplier: number }
): void {
  const { horizontalSpacing, verticalSpacing, centerOffset } = options;

  // 根节点位置
  const rootDim = dimensions.get(root.id)!;
  positions.set(root.id, {
    id: root.id,
    text: root.text,
    x: centerOffset,
    y: 0,
    width: rootDim.width,
    height: rootDim.height,
    level: root.level,
    hasChildren: root.children.length > 0,
    expanded: root.expanded || false
  });

  if (root.children.length === 0) return;

  // 将子节点分为左右两组
  const children = root.children;
  const leftCount = Math.ceil(children.length / 2);
  const leftChildren = children.slice(0, leftCount);
  const rightChildren = children.slice(leftCount);

  // 计算左侧分支
if (leftChildren.length > 0) {
  const leftHeight = calculateSubtreeHeight(leftChildren, dimensions, verticalSpacing);
  let yOffset = -leftHeight / 2;

  // 计算左侧锚点：根节点左边缘 - 间距
  // 使用 0.5 倍间距作为视觉分隔
  const leftAnchorX = centerOffset - rootDim.width / 2 - horizontalSpacing * 0.5;

  for (const child of leftChildren) {
    const childDim = dimensions.get(child.id)!;
    const branchHeight = calculateNodeBranchHeight(child, dimensions, verticalSpacing);
    
    // 左侧节点右对齐：锚点 - 宽度/2
    const x = leftAnchorX - childDim.width / 2;
    const y = yOffset + branchHeight / 2;

    positions.set(child.id, {
      id: child.id,
      text: child.text,
      x,
      y,
      width: childDim.width,
      height: childDim.height,
      level: child.level,
      hasChildren: child.children.length > 0,
      expanded: child.expanded || false,
      parentId: root.id
    });

    // 递归计算子节点
    if (child.expanded && child.children.length > 0) {
      layoutChildBranch(
        child,
        positions,
        dimensions,
        x,
        y,
        'left',
        horizontalSpacing,
        verticalSpacing
      );
    }

    yOffset += branchHeight + verticalSpacing;
  }
}

// 计算右侧分支
if (rightChildren.length > 0) {
  const rightHeight = calculateSubtreeHeight(rightChildren, dimensions, verticalSpacing);
  let yOffset = -rightHeight / 2;

  // 计算右侧锚点：根节点右边缘 + 间距
  const rightAnchorX = centerOffset + rootDim.width / 2 + horizontalSpacing * 0.5;

  for (const child of rightChildren) {
    const childDim = dimensions.get(child.id)!;
    const branchHeight = calculateNodeBranchHeight(child, dimensions, verticalSpacing);
    
    // 右侧节点左对齐：锚点 + 宽度/2
    const x = rightAnchorX + childDim.width / 2;
    const y = yOffset + branchHeight / 2;

    positions.set(child.id, {
      id: child.id,
      text: child.text,
      x,
      y,
      width: childDim.width,
      height: childDim.height,
      level: child.level,
      hasChildren: child.children.length > 0,
      expanded: child.expanded || false,
      parentId: root.id
    });

    // 递归计算子节点
    if (child.expanded && child.children.length > 0) {
      layoutChildBranch(
        child,
        positions,
        dimensions,
        x,
        y,
        'right',
        horizontalSpacing,
        verticalSpacing
      );
    }

    yOffset += branchHeight + verticalSpacing;
  }
}
}

/**
 * 单方向布局
 */
function calculateSingleDirectionLayout(
  root: INodeData,
  positions: Map<string, NodePosition>,
  dimensions: Map<string, { width: number; height: number }>,
  options: { horizontalSpacing: number; verticalSpacing: number; direction: 'left' | 'right'; levelSpacingMultiplier: number }
): void {
  const { horizontalSpacing, verticalSpacing, direction } = options;
  // const isLeft = direction === 'left';
  // const sign = isLeft ? -1 : 1;

  // 根节点位置
  const rootDim = dimensions.get(root.id)!;
  positions.set(root.id, {
    id: root.id,
    text: root.text,
    x: 0,
    y: 0,
    width: rootDim.width,
    height: rootDim.height,
    level: root.level,
    hasChildren: root.children.length > 0,
    expanded: root.expanded || false
  });

  // 递归计算子节点
  // 传入 0 (根节点 x 坐标) 使得 layoutChildBranch 计算出相对于根节点的正确锚点位置
  layoutChildBranch(
    root,
    positions,
    dimensions,
    0,
    0,
    direction,
    horizontalSpacing,
    verticalSpacing
  );
}

/**
 * 递归布局子分支
 */
function layoutChildBranch(
  parent: INodeData,
  positions: Map<string, NodePosition>,
  dimensions: Map<string, { width: number; height: number }>,
  currentX: number,
  currentY: number,
  direction: 'left' | 'right',
  horizontalSpacing: number,
  verticalSpacing: number
): void {
  if (!parent.expanded || parent.children.length === 0) return;

  const sign = direction === 'left' ? -1 : 1;
  
  const parentDim = dimensions.get(parent.id)!;
  
  // 增加层级间距：父节点宽度/2 + 基础间距 * 调整系数
  const spacingMultiplier = parent.level >= 2 ? 1.0 : 0.8;
  
  // 计算锚点 X 坐标（子节点的对齐线）
  // 锚点为：父节点边缘 + 间距
  // 间距设为 horizontalSpacing 的 0.6 倍，确保视觉上的分隔
  const hGap = horizontalSpacing * spacingMultiplier * 0.6;
  const anchorX = currentX + sign * (parentDim.width / 2 + hGap);

  // 使用 calculateSubtreeHeight 计算子节点堆栈的总高度
  const totalSubtreeHeight = calculateSubtreeHeight(parent.children, dimensions, verticalSpacing);

  // 从 currentY 开始计算，y 轴起始点应该是 currentY - totalSubtreeHeight/2
  let yOffset = currentY - totalSubtreeHeight / 2;

  for (const child of parent.children) {
    const childDim = dimensions.get(child.id)!;
    // 计算该子节点分支占据的高度
    const branchHeight = calculateNodeBranchHeight(child, dimensions, verticalSpacing);

    // 子节点的位置应该是其分支高度的中心
    const y = yOffset + branchHeight / 2;

    // 计算子节点 X 坐标：基于锚点和自身宽度对齐
    // 右侧布局：左对齐（锚点 + 宽度/2）
    // 左侧布局：右对齐（锚点 - 宽度/2）
    const x = anchorX + sign * (childDim.width / 2);

    positions.set(child.id, {
      id: child.id,
      text: child.text,
      x,
      y,
      width: childDim.width,
      height: childDim.height,
      level: child.level,
      hasChildren: child.children.length > 0,
      expanded: child.expanded || false,
      parentId: parent.id
    });

    // 递归处理孙子节点
    if (child.expanded && child.children.length > 0) {
      layoutChildBranch(
        child,
        positions,
        dimensions,
        x,
        y,
        direction,
        horizontalSpacing,
        verticalSpacing
      );
    }

    // 移动偏移量：当前分支高度 + 垂直间距
    yOffset += branchHeight + verticalSpacing;
  }
}

/**
 * 计算一组节点（同级）构成的整体高度
 */
function calculateSubtreeHeight(
  nodes: INodeData[],
  dimensions: Map<string, { width: number; height: number }>,
  verticalSpacing: number
): number {
  if (nodes.length === 0) return 0;

  let totalHeight = 0;
  for (const node of nodes) {
    totalHeight += calculateNodeBranchHeight(node, dimensions, verticalSpacing);
  }

  // 加上节点之间的间距，根据节点数量动态调整
  // 节点越多，每个间距相对较小，但总间距增加
  const baseSpacing = verticalSpacing;
  totalHeight += (nodes.length - 1) * baseSpacing;
  return totalHeight;
}

/**
 * 计算单个节点及其所有展开子孙节点所占据的总分支高度
 * 确保每个节点有足够的垂直空间，特别是对于长文本节点
 */
function calculateNodeBranchHeight(
  node: INodeData,
  dimensions: Map<string, { width: number; height: number }>,
  verticalSpacing: number
): number {
  const nodeDim = dimensions.get(node.id)!;
  // 节点的最小高度应该考虑其自身尺寸
  // 对于长文本节点（宽度较大），我们已经在 calculateNodeDimensions 中增加了高度
  const nodeHeight = nodeDim.height;
  
  // 设置最小分支高度，确保节点之间有足够的间距
  const minBranchHeight = Math.max(nodeHeight, 32);

  if (node.expanded && node.children.length > 0) {
    // 如果展开了，计算子孙节点的总高度
    const childrenTotalHeight = calculateSubtreeHeight(node.children, dimensions, verticalSpacing);
    // 节点的分支高度是其自身最小高度与子高度的较大值
    return Math.max(minBranchHeight, childrenTotalHeight);
  }

  return minBranchHeight;
}

/**
 * 生成 SVG 连接线路径 - 使用平滑贝塞尔曲线
 * 每条连线都有独特的曲线路径，避免重叠
 */
export function generateLinkPath(
  from: NodePosition,
  to: NodePosition
): string {
  // 根据节点的实际位置关系确定连接点
  const isLeftBranch = to.x < from.x;
  const isFromRoot = from.id === 'root';

  // 父节点连接点（从节点边缘出发）
  const fromX = isLeftBranch ? from.x - from.width / 2 : from.x + from.width / 2;
  const fromY = isFromRoot ? from.y : from.y + from.height / 2;

  // 子节点连接点（连接到节点边缘）
  const toX = isLeftBranch ? to.x + to.width / 2 : to.x - to.width / 2;
  const toY = to.y + to.height / 2;

  // 计算水平距离
  const dx = Math.abs(toX - fromX);
  
  // 控制点偏移量 - 根据水平距离动态计算，使曲线更自然
  // 偏移量为水平距离的 40-60%，确保曲线平滑但不过于弯曲
  const controlOffset = dx * 0.5;
  
  // 使用三次贝塞尔曲线
  // 第一个控制点：从起点水平向外延伸
  // 第二个控制点：从终点水平向内延伸
  const cp1x = isLeftBranch ? fromX - controlOffset : fromX + controlOffset;
  const cp1y = fromY;
  const cp2x = isLeftBranch ? toX + controlOffset : toX - controlOffset;
  const cp2y = toY;

  return `M ${fromX} ${fromY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toX} ${toY}`;
}

/**
 * 生成分支主干线路径
 * 使用贝塞尔曲线后不再需要主干线，返回 null
 */
export function generateTrunkPath(
  _parent: NodePosition,
  _children: NodePosition[]
): string | null {
  // 使用贝塞尔曲线连接后，不再需要主干线
  return null;
}

/**
 * 计算布局的边界
 */
export function calculateLayoutBounds(
  positions: Map<string, NodePosition>
): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  positions.forEach((pos) => {
    minX = Math.min(minX, pos.x - pos.width / 2);
    maxX = Math.max(maxX, pos.x + pos.width / 2);
    minY = Math.min(minY, pos.y - pos.height / 2);
    maxY = Math.max(maxY, pos.y + pos.height / 2);
  });

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}