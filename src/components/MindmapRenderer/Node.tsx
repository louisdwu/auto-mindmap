import React from 'react';
import { NodePosition } from '../../utils/layout';

interface NodeProps {
  pos: NodePosition;
  isExpanded: boolean;
  styleName: string;
  branchIndex: number;
  onClick: (e: React.MouseEvent) => void;
}

export const Node: React.FC<NodeProps> = ({
  pos,
  isExpanded,
  styleName,
  branchIndex,
  onClick
}) => {
  const isRoot = pos.id === 'root';
  
  return (
    <div
      className={`mm-node ${isRoot ? 'root' : ''} branch-${branchIndex} style-${styleName}`}
      data-level={pos.level}
      style={{
        left: pos.x - pos.width / 2,
        top: pos.y - pos.baseHeight / 2,
        width: pos.width,
        height: pos.baseHeight,
      }}
      onClick={onClick}
      title={pos.text}
    >
      <span className="mm-node-text">{pos.text}</span>
      {!isRoot && <div className="mm-node-underline" />}
      {pos.hasChildren && !isExpanded && (
        <span className="mm-collapse-indicator">+</span>
      )}
    </div>
  );
};
