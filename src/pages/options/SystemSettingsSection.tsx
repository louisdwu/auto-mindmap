import React from 'react';
import { PluginConfig } from '../../types/config';

interface SystemSettingsSectionProps {
  config: PluginConfig;
  onConfigChange: (config: PluginConfig) => void;
}

export const SystemSettingsSection: React.FC<SystemSettingsSectionProps> = ({ config, onConfigChange }) => {
  const handleConcurrencyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = parseInt(e.target.value, 10);
    if (isNaN(value)) value = 1;
    if (value < 1) value = 1;
    if (value > 20) value = 20;

    onConfigChange({
      ...config,
      settings: {
        ...config.settings,
        concurrencyLimit: value
      }
    });
  };

  return (
    <section className="options-section">
      <div className="section-header">
        <h3 className="section-title">任务调度设置</h3>
      </div>

      <div className="form-group">
        <label className="form-label">
          并发任务上限: <span className="value-highlight">{config.settings.concurrencyLimit || 3}</span>
        </label>
        <div className="flex-row">
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            value={config.settings.concurrencyLimit || 3}
            onChange={handleConcurrencyChange}
            className="form-range"
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min="1"
            max="20"
            value={config.settings.concurrencyLimit || 3}
            onChange={handleConcurrencyChange}
            className="form-input"
            style={{ width: '60px', marginLeft: '12px' }}
          />
        </div>
        <p className="form-hint">
          设置同时运行的思维导图生成任务数量。
          建议范围：3-5。如果你的机器性能较好或 API 额度充足，可以适当调高。
          <br />
          <strong>注意：</strong>语音识别 (ASR) 环节始终保持串行（并发数为 1），以保证稳定性。
        </p>
      </div>
    </section>
  );
};
