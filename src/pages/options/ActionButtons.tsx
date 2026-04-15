import React from 'react';

interface ActionButtonsProps {
  saved: boolean;
  onSave: () => void;
  onReset: () => void;
  onClearCache: () => void;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  saved,
  onSave,
  onReset,
  onClearCache
}) => {
  return (
    <>
    <div className="action-buttons-group">
      <div className="btn-row">
        <button className="btn--primary" onClick={onSave}>
          <span className="btn-icon">💾</span>
          {saved ? '✓ 已保存' : '保存全局设置'}
        </button>
        <button className="btn--secondary-outline" onClick={onReset}>
          <span className="btn-icon">🔄</span>
          恢复初始默认
        </button>
      </div>

      <div className="danger-zone">
        <div className="danger-zone__title">
          <span>⚠️</span> 危险操作区
        </div>
        <div className="danger-zone__content">
          <button className="btn--danger-soft" onClick={onClearCache}>
            <span className="btn-icon">🧹</span>
            清除思维导图缓存
          </button>
          <p className="danger-zone__hint">这将删除所有本地存储的思维导图数据和已生成的摘要，此操作不可撤销。</p>
        </div>
      </div>
    </div>
    </>
  );
};
