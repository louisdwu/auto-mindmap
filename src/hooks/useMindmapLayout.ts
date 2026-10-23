import { useState, useCallback, useEffect, useRef, RefObject } from 'react';
import { INodeData, parseMarkdown, applyExpandedState, collectExpandedIds } from '../utils/markdownParser';
import { calculateLayout, calculateLayoutBounds, NodePosition, LayoutOptions } from '../utils/layout';
import { MindmapViewStateService } from '../services/mindmapViewState';

interface UseMindmapLayoutProps {
  markdown: string;
  layoutOptions: LayoutOptions;
  containerRef: RefObject<HTMLDivElement>;
  /** 视图状态缓存键；提供时自动恢复/保存展开状态与画布位置 */
  viewStateKey?: string;
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
  containerRef,
  viewStateKey
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

  // 解析 Markdown（并还原上次保存的展开状态）
  useEffect(() => {
    if (!markdown) {
      setTreeData(null);
      return;
    }
    const snapshot = MindmapViewStateService.get(viewStateKey);
    const expandedIds = snapshot ? new Set(snapshot.expandedIds) : null;
    const parsed = applyExpandedState(parseMarkdown(markdown), expandedIds);
    setTreeData(convertToTreeNode(parsed));
  }, [markdown, viewStateKey, convertToTreeNode]);

  // 切换导图时重新执行初始视图适配
  useEffect(() => {
    setIsInitialized(false);
  }, [viewStateKey]);

  // 计算布局
  useEffect(() => {
    if (!treeData) return;

    const layout = calculateLayout(treeData as unknown as INodeData, layoutOptions);
    setPositions(layout);

    // 初始加载时的视图定位：优先还原缓存，其次自动缩放并居中
    if (!isInitialized && containerRef.current) {
      const snapshot = MindmapViewStateService.get(viewStateKey);
      if (snapshot && typeof snapshot.scale === 'number' && snapshot.offset) {
        setScale(snapshot.scale);
        setOffset({ x: snapshot.offset.x, y: snapshot.offset.y });
        setIsInitialized(true);
        return;
      }

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
  }, [treeData, layoutOptions, isInitialized, containerRef, viewStateKey]);

  // 保存视图状态：展开状态 + 画布位置，供下次挂载还原
  useEffect(() => {
    if (!viewStateKey || !isInitialized || !treeData) return;
    MindmapViewStateService.save(viewStateKey, {
      expandedIds: collectExpandedIds(treeData),
      scale,
      offset
    });
  }, [viewStateKey, isInitialized, treeData, scale, offset]);

  // 卸载前兜底保存：避免「展开节点后立刻点时间戳关闭视图」时丢失最后一次变更
  const latestStateRef = useRef({ viewStateKey, treeData, scale, offset, isInitialized });
  useEffect(() => {
    latestStateRef.current = { viewStateKey, treeData, scale, offset, isInitialized };
  }, [viewStateKey, treeData, scale, offset, isInitialized]);

  useEffect(() => {
    return () => {
      const latest = latestStateRef.current;
      if (!latest.viewStateKey || !latest.isInitialized || !latest.treeData) return;
      MindmapViewStateService.save(latest.viewStateKey, {
        expandedIds: collectExpandedIds(latest.treeData),
        scale: latest.scale,
        offset: latest.offset
      });
    };
  }, []);

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
