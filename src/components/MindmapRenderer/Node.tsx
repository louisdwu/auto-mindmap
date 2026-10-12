import React, { useMemo } from 'react';
import { NodePosition } from '../../utils/layout';
import { VideoUtils } from '../../utils/videoUtils';

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

  // 正则匹配时间戳，例如 [01:23] 或 (01:23:45)
  const { titleText, timestampStr } = useMemo(() => {
    const raw = pos.text || '';
    const match = raw.match(/(?:\[|\()(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))/);
    if (!match) {
      return { titleText: raw, timestampStr: null };
    }
    const cleanText = raw.replace(match[0], '').trim();
    return {
      titleText: cleanText || raw,
      timestampStr: match[1]
    };
  }, [pos.text]);

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
        top: pos.y - pos.baseHeight / 2,
        width: pos.width,
        height: pos.baseHeight,
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
