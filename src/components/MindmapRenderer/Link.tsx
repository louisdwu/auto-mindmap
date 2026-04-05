import React from 'react';
import { NodePosition, generateLinkPath } from '../../utils/layout';

interface LinkProps {
  from: NodePosition;
  to: NodePosition;
  branchIndex: number;
}

export const Link: React.FC<LinkProps> = ({
  from,
  to,
  branchIndex
}) => {
  return (
    <path
      d={generateLinkPath(from, to)}
      className={`mm-link branch-${branchIndex} level-${to.level}`}
    />
  );
};
