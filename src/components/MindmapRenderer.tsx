import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { parseMarkdown, INodeData } from '../utils/markdownParser';
import { calculateLayout, generateLinkPath, generateTrunkPath, calculateLayoutBounds, NodePosition, LayoutOptions } from '../utils/layout';
import { MindmapStyle } from '../types/mindmap';
import './MindmapRenderer.css';

interface MindmapRendererProps {
  markdown: string;
  onNodeClick?: (node: INodeData) => void;
  layoutOptions?: Partial<LayoutOptions>;
  styleName?: MindmapStyle;
}

// 树形节点数据（带展开状态）
interface TreeNode {
  id: string;
  text: string;
  level: number;
  children: TreeNode[];
  expanded: boolean;
}

export const MindmapRenderer: React.FC<MindmapRendererProps> = ({
  markdown,
  onNodeClick,
  layoutOptions = {},
  styleName = 'modern'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // 使用 ref 来跟踪拖动状态，避免重新渲染导致事件丢失
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0
  });

  const [treeData, setTreeData] = useState<TreeNode | null>(null);
  const [positions, setPositions] = useState<Map<string, NodePosition>>(new Map());
  const [, setSelectedNodeId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [interactionMode, setInteractionMode] = useState<'move' | 'zoom'>('move');
  const [isDragging, setIsDragging] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);

  // 将 INodeData 转换为 TreeNode（深拷贝以避免引用问题）
  const convertToTreeNode = (node: INodeData): TreeNode => {
    return {
      id: node.id,
      text: node.text,
      level: node.level,
      children: node.children.map(convertToTreeNode),
      expanded: node.expanded !== false
    };
  };

  // 解析 Markdown
  useEffect(() => {
    if (!markdown) {
      setTreeData(null);
      return;
    }
    const parsed = parseMarkdown(markdown);
    const tree = convertToTreeNode(parsed);
    setTreeData(tree);
  }, [markdown]);

  // 计算布局 - 使用优化的默认值
  useEffect(() => {
    if (!treeData) return;

    // 合并默认布局选项，提供足够间距避免重叠
    const defaultOptions = {
      direction: 'right' as const,
      horizontalSpacing: 140,
      verticalSpacing: 20,  // 基础间距，实际间距会根据节点虚拟高度动态调整
      nodeWidth: 100,
      nodeHeight: 32,
      centerOffset: 0,
      levelSpacingMultiplier: 0.85
    };

    const mergedOptions = { ...defaultOptions, ...layoutOptions };
    const layout = calculateLayout(treeData as unknown as INodeData, mergedOptions);
    setPositions(layout);

    // 自动居中并自适应缩放 - 仅在初始加载时执行一次
    if (!isInitialized) {
      const bounds = calculateLayoutBounds(layout);
      const container = containerRef.current;
      if (container && bounds.width > 0 && bounds.height > 0) {
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        
        // 计算缩放比例，保证第一层级内容完全显示
        // 获取所有一级节点（level 1）的位置
        let minY = Infinity;
        let maxY = -Infinity;
        // let minX = Infinity;
        // let maxX = -Infinity;
        
        // 遍历所有位置，找到一级节点的边界
        layout.forEach((pos) => {
          if (pos.level <= 1) { // 包含根节点和一级节点
             minY = Math.min(minY, pos.y - pos.height / 2);
             maxY = Math.max(maxY, pos.y + pos.height / 2);
             // minX = Math.min(minX, pos.x - pos.width / 2);
             // maxX = Math.max(maxX, pos.x + pos.width / 2);
          }
        });
        
        const contentHeight = maxY - minY;
        // const contentWidth = maxX - minX;
        
        // 计算适应屏幕的高度缩放比例
        // 留出一定的边距 (例如上下各 50px)
        const paddingY = 100;
        let fitScale = 1;
        
        if (contentHeight > 0) {
            fitScale = (containerHeight - paddingY) / contentHeight;
        }
        
        // 限制缩放比例在合理范围内
        fitScale = Math.min(1.5, Math.max(0.5, fitScale));
        
        // 应用计算出的缩放比例
        setScale(fitScale);
        
        // 计算居中位置 (使用新的 scale)
        // 将根节点定位在画布左侧垂直居中位置
        // 修正：确保左侧内容不被遮挡。
        // 获取布局中最左侧节点的 x 坐标
        let minX = 0;
        layout.forEach(pos => {
          if (pos.x < minX) minX = pos.x;
        });

        // 根节点在 (0, 0)，最左侧节点在 (minX, y)
        // 我们希望最左侧节点距离左边缘有一定边距 (如 50px)
        // leftEdgeX * scale + offsetX = 50
        // (minX - nodeWidth/2) * scale + offsetX = 50
        // offsetX = 50 - (minX - somePadding) * scale
        
        // 简单策略：让根节点位于 containerWidth * 0.2，但如果 minX 很大（负值），则需要更多偏移
        // 计算左侧所需的空间
        // bounds.minX 是布局中最左侧节点的 x 坐标（相对于根节点 (0,0)）
        // 如果有左侧节点，minX 为负值。我们需要偏移量足以容纳这段负值距离
        // 偏移量 offset.x 实际上是根节点在屏幕上的位置（因为 transformOrigin 是 0 0，且根节点在布局坐标系中是 0,0）
        // 但要注意最外层的 transform 是 translate(offset.x, offset.y) scale(scale)
        // 所以 offset.x 就是根节点的屏幕 x 坐标
        
        // 我们需要保证：最左侧节点的屏幕坐标 > 0
        // 最左侧节点的屏幕坐标 = minX * fitScale + offset.x
        // 所以 offset.x > -minX * fitScale
        
        // 额外添加 50px 的安全边距
        const leftSpaceNeeded = Math.abs(Math.min(0, bounds.minX)) * fitScale + 50;
        
        // 默认让根节点在 20% 处，但必须大于 leftSpaceNeeded
        let centerX = Math.max(containerWidth * 0.2, leftSpaceNeeded);
        
        const centerY = containerHeight * 0.5;

        setOffset({ x: centerX, y: centerY });
        setIsInitialized(true);
      }
    }
  }, [treeData, layoutOptions, isInitialized]);

  // 递归查找节点
  const findNode = useCallback((node: TreeNode, targetId: string): TreeNode | null => {
    if (node.id === targetId) return node;
    for (const child of node.children) {
      const found = findNode(child, targetId);
      if (found) return found;
    }
    return null;
  }, []);

  // 递归更新节点展开状态
  const updateNodeExpanded = useCallback((node: TreeNode, targetId: string, expanded: boolean): TreeNode => {
    if (node.id === targetId) {
      return { ...node, expanded };
    }
    return {
      ...node,
      children: node.children.map(child => updateNodeExpanded(child, targetId, expanded))
    };
  }, []);

  // 处理节点点击
  const handleNodeClick = useCallback((node: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    setSelectedNodeId(node.id);
    onNodeClick?.(node as unknown as INodeData);

    if (node.children.length > 0) {
      // 切换展开状态
      if (!node.expanded) {
        setExpandingNodeId(node.id);
      }
      setTreeData(prev => {
        if (!prev) return null;
        return updateNodeExpanded(prev, node.id, !node.expanded);
      });
    }
  }, [onNodeClick, updateNodeExpanded]);

  // 处理拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    
    // 记录拖动开始状态
    dragRef.current.isDragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.offsetX = offset.x;
    dragRef.current.offsetY = offset.y;
    
    setIsDragging(true);
  }, [offset]);

  // 处理鼠标移动和释放
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      
      setOffset({
        x: dragRef.current.offsetX + dx,
        y: dragRef.current.offsetY + dy
      });
    };

    const handleMouseUp = () => {
      dragRef.current.isDragging = false;
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 处理滚轮缩放（使用纯滚轮，避免与 Ctrl+滚轮冲突）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // 允许 Ctrl+滚轮 进行正常的浏览器缩放，或者这里阻止默认行为以自定义缩放
    e.preventDefault();

    if (interactionMode === 'move') {
      // 移动模式
      let dx = e.deltaX;
      let dy = e.deltaY;

      // 如果按住 Shift 键，将垂直滚动转换为水平滚动
      if (e.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }

      setOffset(prev => ({
        x: prev.x - dx,
        y: prev.y - dy
      }));
    } else {
      // 缩放模式
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, scale * delta));
      
      if (newScale !== scale && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // 计算鼠标相对于当前 offset 的位置（在 1:1 比例下）
        const mouseRelX = (mouseX - offset.x) / scale;
        const mouseRelY = (mouseY - offset.y) / scale;
        
        // 更新 scale 并调整 offset，使鼠标下的点保持不动
        setScale(newScale);
        setOffset({
          x: mouseX - mouseRelX * newScale,
          y: mouseY - mouseRelY * newScale
        });
      }
    }
  }, [interactionMode, scale, offset]);

  // 自动调整视图以展示展开的节点
  useEffect(() => {
    // 确保有需要展开的节点，且位置信息已经包含该节点及其子节点
    if (!expandingNodeId || !treeData || positions.size === 0 || !containerRef.current) return;

    // 检查子节点是否已经计算了位置
    const targetNode = findNode(treeData, expandingNodeId);
    if (!targetNode || !targetNode.children.length) {
      // 没找到节点或者没有子节点，直接结束
      setExpandingNodeId(null);
      return;
    }

    // 确认子节点的位置是否已经生成
    // 如果 positions 中还没有子节点的 id，说明布局还未更新，等待下一次渲染
    const firstChildId = targetNode.children[0].id;
    if (!positions.has(firstChildId)) {
      return;
    }

    const parentPos = positions.get(expandingNodeId);
    if (!parentPos) return;

    // 1. 找到所有需要显示的节点（展开节点及其所有可见后代）
    const nodesToShow = new Set<string>();
    const collectIds = (node: TreeNode) => {
      nodesToShow.add(node.id);
      if (node.expanded) {
        node.children.forEach(collectIds);
      }
    };
    collectIds(targetNode);

    // 2. 计算这些节点的边界包围盒 (World Coordinates)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodesToShow.forEach(id => {
      const pos = positions.get(id);
      if (pos) {
        minX = Math.min(minX, pos.x - pos.width / 2);
        maxX = Math.max(maxX, pos.x + pos.width / 2);
        minY = Math.min(minY, pos.y - pos.height / 2);
        maxY = Math.max(maxY, pos.y + pos.height / 2);
      }
    });

    if (minX === Infinity) {
       setExpandingNodeId(null);
       return;
    }

    const container = containerRef.current;
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;
    const padding = 50; // 留出足够的边距

    // Calculate ideal offsets to align edges
    // fitLeft: offset required to place minX at padding
    const fitLeft = padding - minX * scale;
    // fitRight: offset required to place maxX at viewportWidth - padding
    const fitRight = (viewportWidth - padding) - maxX * scale;
    const fitTop = padding - minY * scale;
    const fitBottom = (viewportHeight - padding) - maxY * scale;

    let targetX = offset.x;
    let targetY = offset.y;

    // Horizontal logic
    // Determine expansion direction based on bounds relative to parent
    const isRightExpansion = (maxX - parentPos.x) > (parentPos.x - minX);

    if (fitLeft <= fitRight) {
        // Content fits in width
        // Only adjust if currently out of bounds
        // 注意：这里逻辑有点反直觉，fitLeft 是最大允许的 offset.x (对应左边缘在 padding 处)
        // fitRight 是最小允许的 offset.x (对应右边缘在 viewportWidth - padding 处)
        // 如果 offset.x > fitLeft，说明内容偏右了，需要左移 (减小 offset.x) 到 fitLeft
        // 如果 offset.x < fitRight，说明内容偏左了，需要右移 (增大 offset.x) 到 fitRight
        
        // 修正逻辑：
        // fitLeft 是让 minX 出现在左边缘所需的 offset
        // fitRight 是让 maxX 出现在右边缘所需的 offset
        // 因为 scale 是正数，minX < maxX，所以 -minX > -maxX，所以 fitLeft > fitRight
        
        // 如果 offset.x > fitLeft，说明内容太靠右，minX 的屏幕坐标 > padding。这通常是可以接受的，除非我们想强制紧凑。
        // 如果 offset.x < fitRight，说明内容太靠左，maxX 的屏幕坐标 < viewportWidth - padding。
        
        // 我们的目标是：如果内容超出屏幕，则平移。
        // 内容左边缘屏幕坐标: minX * scale + offset.x
        // 内容右边缘屏幕坐标: maxX * scale + offset.x
        
        const contentLeftScreen = minX * scale + offset.x;
        const contentRightScreen = maxX * scale + offset.x;
        
        if (contentLeftScreen < padding) {
             // 左侧被遮挡，向右移
             targetX = fitLeft;
        } else if (contentRightScreen > viewportWidth - padding) {
             // 右侧被遮挡，向左移
             targetX = fitRight;
        }
    } else {
        // Content too wide (fitLeft > fitRight actually, wait fitLeft = P - min*S, fitRight = W - P - max*S)
        // fitLeft - fitRight = P - min*S - (W - P - max*S) = 2P - W + S(max-min)
        // 如果内容很宽 S(max-min) > W - 2P，则 fitLeft > fitRight
        
        if (isRightExpansion) {
          // Expanding to right:
          // 我们希望看到新展开的内容（右侧），但也要保留父节点（左侧）。
          // 这里的策略是：优先保证父节点不被移出屏幕，同时尽可能显示新内容。
          // 或者：优先显示新内容（右侧），只要父节点还在屏幕内？
          
          // 简单策略：让新展示出来的区域尽可能在屏幕内。
          // 对于右侧展开，我们希望 maxX 尽可能在屏幕内 (align to right edge)，但不能让 minX (parent) 跑出屏幕左侧太远?
          // 题目要求："使得新展示出来的下级项目能完整展示在屏幕内"
          
          // 强制右侧对齐到视口右边缘 (fitRight)
          targetX = fitRight;
          
          // 但是，如果这样导致父节点（minX 附近）完全看不到了怎么办？
          // 检查父节点位置
          const parentScreenX = parentPos.x * scale + targetX;
           if (parentScreenX < padding) {
             // 父节点被挤出去了，拉回来一点，让父节点至少在边缘
             targetX = padding - parentPos.x * scale;
           }
        } else {
          // Expanding to left: Align to left edge (fitLeft)
          targetX = fitLeft;
          
           // Check parent visibility
           const parentScreenX = parentPos.x * scale + targetX;
           if (parentScreenX > viewportWidth - padding) {
               targetX = (viewportWidth - padding) - parentPos.x * scale;
           }
        }
    }

    // Vertical logic - prioritize Top
    const contentTopScreen = minY * scale + offset.y;
    const contentBottomScreen = maxY * scale + offset.y;
    
    if (contentTopScreen < padding) {
        targetY = fitTop;
    } else if (contentBottomScreen > viewportHeight - padding) {
        // 如果底部被遮挡
        if (contentTopScreen > padding) {
            // 如果顶部有空间，向上移，但不要移过头 (fitBottom)
            // 优先保证顶部可见? 还是保证底部可见?
            // 通常展开子节点，不仅关注子节点，也关注整体结构。
            // 简单策略：底部对齐
             targetY = fitBottom;
             
             // 二次检查：如果这样导致顶部看不见了（内容太高），优先显示顶部
             if (minY * scale + targetY < padding) {
                 targetY = fitTop;
             }
        }
    }

    // Apply only if changed
    if (Math.abs(targetX - offset.x) > 1 || Math.abs(targetY - offset.y) > 1) {
        setOffset({ x: targetX, y: targetY });
    }

    setExpandingNodeId(null);
  }, [positions, expandingNodeId, scale, offset, treeData, findNode]);

  // 处理双击重置视图（恢复到自适应状态）
  const handleDoubleClick = useCallback(() => {
    if (treeData) {
      const defaultOptions = {
        direction: 'right' as const,
        horizontalSpacing: 140,
        verticalSpacing: 20,
        nodeWidth: 100,
        nodeHeight: 32,
        centerOffset: 0,
        levelSpacingMultiplier: 0.85
      };
      const mergedOptions = { ...defaultOptions, ...layoutOptions };
      const layout = calculateLayout(treeData as unknown as INodeData, mergedOptions);
      const bounds = calculateLayoutBounds(layout);
      const container = containerRef.current;
      
      if (container && bounds.width > 0 && bounds.height > 0) {
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // 重新计算自适应缩放 (逻辑同上)
        let minY = Infinity;
        let maxY = -Infinity;
        
        layout.forEach((pos) => {
          if (pos.level <= 1) {
             minY = Math.min(minY, pos.y - pos.height / 2);
             maxY = Math.max(maxY, pos.y + pos.height / 2);
          }
        });
        
        const contentHeight = maxY - minY;
        const paddingY = 100;
        let fitScale = 1;
        
        if (contentHeight > 0) {
            fitScale = (containerHeight - paddingY) / contentHeight;
        }
        
        fitScale = Math.min(1.5, Math.max(0.5, fitScale));
        
        // 应用缩放和居中
        setScale(fitScale);
        // 计算左侧所需的空间
        const leftSpaceNeeded = Math.abs(Math.min(0, bounds.minX)) * fitScale + 50;
        let centerX = Math.max(containerWidth * 0.2, leftSpaceNeeded);

        setOffset({
          x: centerX,
          y: containerHeight * 0.5
        });
      }
    }
  }, [treeData, layoutOptions]);

  // 处理键盘事件 - 支持翻页键和方向键移动画布
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 定义移动步长
      const pageStep = 300; // Page Up/Down 移动的距离
      const arrowStep = 50;  // 方向键移动的距离

      switch (e.key) {
        case 'PageUp':
          e.preventDefault();
          setOffset(prev => ({ ...prev, y: prev.y + pageStep }));
          break;
        case 'PageDown':
          e.preventDefault();
          setOffset(prev => ({ ...prev, y: prev.y - pageStep }));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setOffset(prev => ({ ...prev, y: prev.y + arrowStep }));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setOffset(prev => ({ ...prev, y: prev.y - arrowStep }));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setOffset(prev => ({ ...prev, x: prev.x + arrowStep }));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setOffset(prev => ({ ...prev, x: prev.x - arrowStep }));
          break;
        case 'Home':
          // Home 键重置视图
          e.preventDefault();
          handleDoubleClick();
          break;
      }
    };

    // 添加键盘事件监听
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDoubleClick]);

  // 自动聚焦容器，使键盘事件可以立即生效
  useEffect(() => {
    const container = containerRef.current;
    if (container && isInitialized) {
      // 延迟一帧确保 DOM 已经渲染完成
      requestAnimationFrame(() => {
        container.focus();
      });
    }
  }, [isInitialized]);

  // 展开所有节点
  const handleExpandAll = useCallback(() => {
    if (!treeData) return;

    const expandAll = (node: TreeNode): TreeNode => ({
      ...node,
      expanded: true,
      children: node.children.map(expandAll)
    });

    setTreeData(expandAll(treeData));
  }, [treeData]);

  // 折叠所有节点
  const handleCollapseAll = useCallback(() => {
    if (!treeData) return;

    const collapseAll = (node: TreeNode): TreeNode => ({
      ...node,
      expanded: false,
      children: node.children.map(collapseAll)
    });

    setTreeData(collapseAll(treeData));
  }, [treeData]);


  // 获取节点所属的分支索引
  const getBranchIndex = useCallback((nodeId: string): number => {
    if (!treeData || nodeId === 'root') return -1;
    
    // 查找该节点属于哪个一级分支
    for (let i = 0; i < treeData.children.length; i++) {
      const isDescendant = (node: TreeNode, targetId: string): boolean => {
        if (node.id === targetId) return true;
        return node.children.some(child => isDescendant(child, targetId));
      };
      
      if (isDescendant(treeData.children[i], nodeId)) {
        return i % 5; // 只有5种预定义颜色
      }
    }
    return -1;
  }, [treeData]);

  // 渲染连接线 - 包括主干线和分支线
  const renderLinks = useMemo(() => {
    const links: React.ReactNode[] = [];
    
    // 按父节点分组子节点，用于生成主干线
    const childrenByParent = new Map<string, NodePosition[]>();
    
    positions.forEach((pos) => {
      if (pos.parentId) {
        const children = childrenByParent.get(pos.parentId) || [];
        children.push(pos);
        childrenByParent.set(pos.parentId, children);
      }
    });
    
    // 生成主干线
    childrenByParent.forEach((children, parentId) => {
      const parentPos = positions.get(parentId);
      if (parentPos && children.length >= 2) {
        const trunkPath = generateTrunkPath(parentPos, children);
        if (trunkPath) {
          const branchIndex = getBranchIndex(children[0].id);
          links.push(
            <path
              key={`trunk-${parentId}`}
              d={trunkPath}
              className={`mm-link mm-trunk branch-${branchIndex} level-${parentPos.level}`}
            />
          );
        }
      }
    });

    // 生成各节点的连接线
    positions.forEach((pos, id) => {
      if (pos.parentId) {
        const parentPos = positions.get(pos.parentId);
        if (parentPos) {
          const path = generateLinkPath(parentPos, pos);
          const branchIndex = getBranchIndex(id);
          const level = pos.level;

          links.push(
            <path
              key={`link-${id}`}
              d={path}
              className={`mm-link branch-${branchIndex} level-${level}`}
            />
          );
        }
      }
    });

    return links;
  }, [positions, getBranchIndex]);

  // 预先构建节点查找映射（避免每次渲染都递归查找）
  const nodeLookupMap = useMemo(() => {
    if (!treeData) return new Map<string, TreeNode>();

    const map = new Map<string, TreeNode>();
    const buildMap = (node: TreeNode) => {
      map.set(node.id, node);
      node.children.forEach(buildMap);
    };
    buildMap(treeData);
    return map;
  }, [treeData]);

  // 渲染节点
  const renderNodes = useMemo(() => {
    if (!treeData || positions.size === 0) return [];

    const nodes: React.ReactNode[] = [];

    positions.forEach((pos) => {
      const isRoot = pos.id === 'root';
      const hasChildren = pos.hasChildren;
      const branchIndex = getBranchIndex(pos.id);

      const nodeData = nodeLookupMap.get(pos.id);
      if (!nodeData) return;

      const isExpanded = nodeData.expanded;

      // 节点的实际显示高度根据层级调整
      // 与 layout.ts 中的 getFontConfig 保持一致
      const getDisplayHeight = (level: number, isRootNode: boolean): number => {
        if (isRootNode) return 52;
        switch (level) {
          case 1: return 36;
          case 2: return 32;
          case 3: return 30;
          default: return 28;
        }
      };
      const displayHeight = getDisplayHeight(pos.level, isRoot);
      
      nodes.push(
        <div
          key={pos.id}
          className={`mm-node ${isRoot ? 'root' : ''} branch-${branchIndex} style-${styleName}`}
          style={{
            left: pos.x - pos.width / 2,
            top: pos.y - displayHeight / 2,
            width: pos.width,
            height: displayHeight,
          }}
          data-level={pos.level}
          onClick={(e) => handleNodeClick(nodeData, e)}
          title={pos.text}
        >
          <span className="mm-node-text">{pos.text}</span>
          {!isRoot && <div className="mm-node-underline" />}
          {hasChildren && !isExpanded && (
            <span className="mm-collapse-indicator">+</span>
          )}
        </div>
      );
    });

    return nodes;
  }, [positions, nodeLookupMap, handleNodeClick]);

  if (!treeData) {
    return (
      <div className="mm-container">
        <div className="mm-empty">暂无思维导图内容</div>
      </div>
    );
  }

  return (
    <div
      className={`mm-container style-${styleName}`}
      ref={containerRef}
      tabIndex={0}
      onFocus={(e) => {
        // 当容器获得焦点时，确保可以接收键盘事件
        e.currentTarget.style.outline = 'none';
      }}
    >
      {/* 工具栏 */}
      <div className="mm-toolbar">
        <button onClick={handleExpandAll} title="展开所有">展开</button>
        <button onClick={handleCollapseAll} title="折叠所有">折叠</button>
        <button onClick={handleDoubleClick} title="重置视图">重置</button>
        <div className="mm-mode-toggle">
          <button
            className={`mm-mode-btn ${interactionMode === 'move' ? 'active' : ''}`}
            onClick={() => setInteractionMode('move')}
            title="移动模式 (滚轮移动画布)"
          >
            移动
          </button>
          <button
            className={`mm-mode-btn ${interactionMode === 'zoom' ? 'active' : ''}`}
            onClick={() => setInteractionMode('zoom')}
            title="缩放模式 (滚轮缩放画布)"
          >
            缩放
          </button>
        </div>
      </div>

      {/* 画布 */}
      <div
        className={`mm-canvas ${isDragging ? 'grabbing' : 'grab'}`}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            position: 'absolute',
            top: 0,
            left: 0
          }}
        >
          <svg
            ref={svgRef}
            className="mm-svg"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible'
            }}
          >
            {renderLinks}
          </svg>
          <div className="mm-nodes">
            {renderNodes}
          </div>
        </div>
      </div>

    </div>
  );
};