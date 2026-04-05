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
      {/* 操作按钮 */}
      <div className="btn-row">
        <button className="btn--primary" onClick={onSave}>
          {saved ? '✓ 已保存' : '保存配置'}
        </button>
        <button className="btn--secondary" onClick={onReset}>
          重置默认
        </button>
      </div>

      {/* 清除缓存 */}
      <div className="clear-cache-section">
        <button className="btn--danger" onClick={onClearCache}>
          清除思维导图缓存
        </button>
        <p className="form-hint">清除所有已下载的字幕和思维导图数据</p>
      </div>
    </>
  );
};
