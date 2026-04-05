import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { INodeData } from '../utils/markdownParser';
import { calculateLayoutBounds, NodePosition, LayoutOptions, calculateLayout } from '../utils/layout';
import { MindmapStyle } from '../types/mindmap';
import { useMindmapLayout } from '../hooks/useMindmapLayout';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';

// Phase 3: 引入拆分后的子组件
import { Node } from './MindmapRenderer/Node';
import { Link } from './MindmapRenderer/Link';
import { Toolbar } from './MindmapRenderer/Toolbar';

import './MindmapRenderer.css';

interface MindmapRendererProps {
  markdown: string;
  onNodeClick?: (node: INodeData) => void;
  layoutOptions?: Partial<LayoutOptions>;
  styleName?: MindmapStyle;
}

export const MindmapRenderer: React.FC<MindmapRendererProps> = ({
  markdown,
  onNodeClick,
  layoutOptions: userLayoutOptions,
  styleName = 'modern'
}) => {
  const layoutOptions = useMemo(() => {
    const defaultOptions = {
      direction: 'right' as const,
      horizontalSpacing: 140,
      verticalSpacing: 20,
      nodeWidth: 100,
      nodeHeight: 32,
      centerOffset: 0,
      levelSpacingMultiplier: 0.85
    };
    return { ...defaultOptions, ...userLayoutOptions };
  }, [userLayoutOptions]);

  const containerRef = useRef<HTMLDivElement>(null);

  const {
    treeData,
    positions,
    scale,
    setScale,
    offset,
    setOffset,
    toggleNode,
    expandAll,
    collapseAll,
    expandingNodeId,
    setExpandingNodeId,
    findNode
  } = useMindmapLayout({ markdown, layoutOptions, containerRef });

  const handleReset = useCallback(() => {
    if (!treeData || !containerRef.current) return;
    const layout = calculateLayout(treeData as any, layoutOptions);
    const bounds = calculateLayoutBounds(layout);
    const { clientHeight: ch, clientWidth: cw } = containerRef.current;

    let minY = Infinity, maxY = -Infinity;
    layout.forEach((pos: NodePosition) => {
      if (pos.level <= 1) {
        minY = Math.min(minY, pos.y - pos.height / 2);
        maxY = Math.max(maxY, pos.y + pos.height / 2);
      }
    });

    const fitScale = Math.min(1.5, Math.max(0.5, (ch - 100) / (maxY - minY || 1)));
    setScale(fitScale);
    const leftSpaceNeeded = Math.abs(Math.min(0, bounds.minX)) * fitScale + 50;
    setOffset({ x: Math.max(cw * 0.2, leftSpaceNeeded), y: ch * 0.5 });
  }, [treeData, layoutOptions, setScale, setOffset]);

  const {
    interactionMode,
    setInteractionMode,
    isDragging,
    handleMouseDown,
    handleWheel
  } = useCanvasInteraction({
    containerRef,
    offset,
    setOffset,
    scale,
    setScale,
    onReset: handleReset
  });

  // 辅助方法：获取分支颜色索引
  const getBranchIndex = useCallback((nodeId: string): number => {
    if (!treeData || nodeId === 'root') return -1;
    for (let i = 0; i < treeData.children.length; i++) {
        const isDescendant = (n: any, id: string): boolean => 
            n.id === id || n.children.some((c: any) => isDescendant(c, id));
        if (isDescendant(treeData.children[i], nodeId)) return i % 5;
    }
    return -1;
  }, [treeData]);

  // 自动对齐展开节点的逻辑 (Phase 3 保持现状)
  useEffect(() => {
    if (!treeData || !expandingNodeId || positions.size === 0 || !containerRef.current) return;
    const targetNode = findNode(treeData, expandingNodeId);
    if (!targetNode || !targetNode.children.length) { setExpandingNodeId(null); return; }
    if (!positions.has(targetNode.children[0].id)) return;
    const nodesToShow = new Set<string>();
    const collectIds = (n: any) => { nodesToShow.add(n.id); if (n.expanded) n.children.forEach(collectIds); };
    collectIds(targetNode);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodesToShow.forEach(id => {
      const p = positions.get(id);
      if (p) {
        minX = Math.min(minX, p.x - p.width / 2); maxX = Math.max(maxX, p.x + p.width / 2);
        minY = Math.min(minY, p.y - p.height / 2); maxY = Math.max(maxY, p.y + p.height / 2);
      }
    });

    const { clientWidth: vw, clientHeight: vh } = containerRef.current;
    const pad = 50;
    let tx = offset.x, ty = offset.y;
    if (minX * scale + tx < pad) tx = pad - minX * scale;
    else if (maxX * scale + tx > vw - pad) tx = (vw - pad) - maxX * scale;
    if (minY * scale + ty < pad) ty = pad - minY * scale;
    else if (maxY * scale + ty > vh - pad) ty = (vh - pad) - maxY * scale;

    setOffset({ x: tx, y: ty });
    setExpandingNodeId(null);
  }, [positions, expandingNodeId, scale, offset, treeData, findNode, setOffset, setExpandingNodeId]);

  // 渲染逻辑：使用 Link 组件
  const renderLinks = useMemo(() => {
    const links: React.ReactNode[] = [];
    positions.forEach((pos, id) => {
      if (pos.parentId) {
        const parentPos = positions.get(pos.parentId);
        if (parentPos) {
          links.push(<Link key={`link-${id}`} from={parentPos} to={pos} branchIndex={getBranchIndex(id)} />);
        }
      }
    });
    return links;
  }, [positions, getBranchIndex]);

  // 渲染逻辑：使用 Node 组件
  const renderNodes = useMemo(() => {
    if (!treeData) return [];
    const nodes: React.ReactNode[] = [];
    positions.forEach((pos) => {
      const nodeData = findNode(treeData, pos.id);
      if (!nodeData) return;
      nodes.push(
        <Node 
          key={pos.id} 
          pos={pos} 
          isExpanded={nodeData.expanded} 
          styleName={styleName} 
          branchIndex={getBranchIndex(pos.id)} 
          onClick={(e) => {
            e.stopPropagation();
            onNodeClick?.(nodeData as any);
            if (nodeData.children.length > 0) toggleNode(nodeData.id, !nodeData.expanded);
          }} 
        />
      );
    });
    return nodes;
  }, [positions, treeData, styleName, getBranchIndex, onNodeClick, toggleNode, findNode]);

  if (!treeData) return <div className="mm-container"><div className="mm-empty">暂无思维导图内容</div></div>;

  return (
    <div className={`mm-container style-${styleName}`} ref={containerRef} tabIndex={0}>
      <Toolbar 
        interactionMode={interactionMode} 
        setInteractionMode={setInteractionMode} 
        onExpandAll={expandAll} 
        onCollapseAll={collapseAll} 
        onReset={handleReset} 
      />
      <div className={`mm-canvas ${isDragging ? 'grabbing' : 'grab'}`} onMouseDown={handleMouseDown} onWheel={handleWheel} onDoubleClick={handleReset}>
        <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          <svg className="mm-svg" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            {renderLinks}
          </svg>
          <div className="mm-nodes">{renderNodes}</div>
        </div>
      </div>
    </div>
  );
};