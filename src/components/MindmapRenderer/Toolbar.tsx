import React from 'react';

interface ToolbarProps {
  interactionMode: 'move' | 'zoom';
  setInteractionMode: (mode: 'move' | 'zoom') => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onReset: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  interactionMode,
  setInteractionMode,
  onExpandAll,
  onCollapseAll,
  onReset
}) => {
  return (
    <div className="mm-toolbar">
      <button onClick={onExpandAll} title="展开所有节点">展开</button>
      <button onClick={onCollapseAll} title="折叠所有子节点">折叠</button>
      <button onClick={onReset} title="重置视图到中心并自适应">重置</button>
      
      <div className="mm-mode-toggle">
        <button 
          className={interactionMode === 'move' ? 'active' : ''} 
          onClick={() => setInteractionMode('move')}
          title="移动模式：滚轮平移画面"
        >
          移动
        </button>
        <button 
          className={interactionMode === 'zoom' ? 'active' : ''} 
          onClick={() => setInteractionMode('zoom')}
          title="缩放模式：滚轮放大缩小"
        >
          缩放
        </button>
      </div>
    </div>
  );
};
