import { useState, useCallback, useEffect, RefObject } from 'react';
import { INodeData, parseMarkdown } from '../utils/markdownParser';
import { calculateLayout, calculateLayoutBounds, NodePosition, LayoutOptions } from '../utils/layout';

interface UseMindmapLayoutProps {
  markdown: string;
  layoutOptions: LayoutOptions;
  containerRef: RefObject<HTMLDivElement>;
}

interface TreeNode extends INodeData {
  id: string;
  text: string;
  level: number;
  children: TreeNode[];
  expanded: boolean;
}

export const useMindmapLayout = ({
  markdown,
  layoutOptions,
  containerRef
}: UseMindmapLayoutProps) => {
  const [treeData, setTreeData] = useState<TreeNode | null>(null);
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // 将 INodeData 转换为 TreeNode
  const convertToTreeNode = useCallback((node: INodeData): TreeNode => {
    return {
      id: node.id,
      text: node.text,
      level: node.level,
      children: node.children.map(convertToTreeNode),
      expanded: node.expanded !== false
    };
  }, []);

  // 解析 Markdown
  useEffect(() => {
    if (!markdown) {
      setTreeData(null);
      return;
    }
    const parsed = parseMarkdown(markdown);
    setTreeData(convertToTreeNode(parsed));
  }, [markdown, convertToTreeNode]);

  // 计算布局
  useEffect(() => {
    if (!treeData) return;

    const layout = calculateLayout(treeData as unknown as INodeData, layoutOptions);
    setPositions(layout);

    // 初始加载时的自动缩放和居中逻辑
    if (!isInitialized && containerRef.current) {
      const bounds = calculateLayoutBounds(layout);
      const container = containerRef.current;
      const { clientHeight: ch } = container;

      if (bounds.width > 0 && bounds.height > 0) {
        // 计算一级节点垂直边界以决定缩放
        let minY = Infinity, maxY = -Infinity;
        layout.forEach((pos) => {
          if (pos.level <= 1) {
            minY = Math.min(minY, pos.y - pos.height / 2);
            maxY = Math.max(maxY, pos.y + pos.height / 2);
          }
        });

        const contentHeight = maxY - minY;
        const fitScale = Math.min(1.5, Math.max(0.5, (ch - 100) / (contentHeight || 1)));
        setScale(fitScale);

        // 计算可见节点（level >= 1）的最左侧边界，以实现与标题栏对齐
        let minXVisible = Infinity;
        layout.forEach((pos) => {
          if (pos.level >= 1) {
            minXVisible = Math.min(minXVisible, pos.x - pos.width / 2);
          }
        });

        // 如果没有可见节点，回退到 0
        if (minXVisible === Infinity) minXVisible = 0;

        // 与标题栏 padding: 0 16px 一致的左偏移
        const leftPadding = 16;
        const centerX = leftPadding - (minXVisible * fitScale);
        setOffset({ x: centerX, y: ch * 0.5 });
        setIsInitialized(true);
      }
    }
  }, [treeData, layoutOptions, isInitialized, containerRef]);

  // 递归查找节点
  const findNode = useCallback((node: TreeNode, targetId: string): TreeNode | null => {
    if (node.id === targetId) return node;
    for (const child of node.children) {
      const found = findNode(child, targetId);
      if (found) return found;
    }
    return null;
  }, []);

  // 递归更新展开状态
  const updateNodeExpanded = useCallback((node: TreeNode, targetId: string, expanded: boolean): TreeNode => {
    if (node.id === targetId) return { ...node, expanded };
    return {
      ...node,
      children: node.children.map(child => updateNodeExpanded(child, targetId, expanded))
    };
  }, []);

  const toggleNode = useCallback((nodeId: string, expanded: boolean) => {
    if (expanded) setExpandingNodeId(nodeId);
    setTreeData(prev => prev ? updateNodeExpanded(prev, nodeId, expanded) : null);
  }, [updateNodeExpanded]);

  const expandAll = useCallback(() => {
    const expand = (node: TreeNode): TreeNode => ({
      ...node, expanded: true, children: node.children.map(expand)
    });
    setTreeData(prev => prev ? expand(prev) : null);
  }, []);

  const collapseAll = useCallback(() => {
    const collapse = (node: TreeNode, isRoot: boolean): TreeNode => ({
      ...node, expanded: isRoot ? true : false, children: node.children.map(child => collapse(child, false))
    });
    setTreeData(prev => prev ? collapse(prev, true) : null);
  }, []);

  return {
    treeData,
    positions,
    scale,
    setScale,
    offset,
    setOffset,
    isInitialized,
    setIsInitialized,
    toggleNode,
    expandAll,
    collapseAll,
    expandingNodeId,
    setExpandingNodeId,
    findNode
  };
};
