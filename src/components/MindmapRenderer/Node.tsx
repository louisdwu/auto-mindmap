import React, { useMemo } from 'react';
import { NodePosition } from '../../utils/layout';
import { VideoUtils } from '../../utils/videoUtils';
import { splitNodeTimestamp } from '../../utils/nodeTimestamp';

interface NodeProps {
  pos: NodePosition;
  isExpanded: boolean;
  styleName: string;
  branchIndex: number;
  onClick: (e: React.MouseEvent) => void;
  onTimestampClick?: (timestamp: string, seconds: number) => void;
}

export const Node: React.FC<NodeProps> = ({
  pos,
  isExpanded,
  styleName,
  branchIndex,
  onClick,
  onTimestampClick
}) => {
  const isRoot = pos.id === 'root';

  // 时间戳从标题剥离为可点击徽章；切分与布局估宽共用同一实现，
  // 标题为空（纯时间戳节点）时只渲染徽章
  const { title: titleText, timestamp: timestampStr } = useMemo(() => splitNodeTimestamp(pos.text), [pos.text]);

  const handleTimestampClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!timestampStr) return;
    const seconds = VideoUtils.parseTimestampToSeconds(timestampStr);
    if (seconds !== null) {
      onTimestampClick?.(timestampStr, seconds);
    }
  };

  return (
    <div
      className={`mm-node ${isRoot ? 'root' : ''} branch-${branchIndex} style-${styleName}`}
      data-level={pos.level}
      style={{
        left: pos.x - pos.width / 2,
        top: pos.y - pos.height / 2,
        width: pos.width,
        height: pos.height,
        fontSize: pos.fontSize
      }}
      onClick={onClick}
      title={pos.text}
    >
      <span className="mm-node-text">
        {titleText}
        {timestampStr && (
          <span
            className="mm-timestamp-badge"
            onClick={handleTimestampClick}
            title={`点击跳转至视频 ${timestampStr} 并收起导图`}
          >
            {timestampStr}
          </span>
        )}
      </span>
      {!isRoot && <div className="mm-node-underline" />}
      {pos.hasChildren && !isExpanded && (
        <span className="mm-collapse-indicator">+</span>
      )}
    </div>
  );
};