import React from 'react';
import { PluginConfig } from '../../types/config';

interface AsrSectionProps {
  config: PluginConfig;
  onConfigChange: (config: PluginConfig) => void;
}

export const AsrSection: React.FC<AsrSectionProps> = ({ config, onConfigChange }) => {
  const isEnabled = config.settings.asrProvider === 'local';

  return (
    <div className="asr-container animate-fade-in">
      <section className="options-section">
        <label className="form-label--large">语音识别状态</label>
        <div className="selection-cards">
          <div 
            className={`selection-card ${!isEnabled ? 'selection-card--active' : ''}`}
            onClick={() => onConfigChange({
              ...config,
              settings: { ...config.settings, asrProvider: 'official' }
            })}
          >
            <div className="selection-card__title">
              <span>🔇</span> 关闭
            </div>
            <div className="selection-card__desc">
              仅使用视频原有的官方字幕或自动生成的字幕。
            </div>
          </div>

          <div 
            className={`selection-card ${isEnabled ? 'selection-card--active' : ''}`}
            onClick={() => onConfigChange({
              ...config,
              settings: { ...config.settings, asrProvider: 'local' }
            })}
          >
            <div className="selection-card__title">
              <span>🚀</span> 开启
            </div>
            <div className="selection-card__desc">
              使用本地 Whisper 服务，支持 GPU 加速，无字幕时自动驱动。
            </div>
          </div>
        </div>
      </section>

      {isEnabled && (
        <section className="options-section animate-fade-in" style={{ marginTop: '24px' }}>
          <div className="form-group">
            <label className="form-label">本地 ASR 服务地址</label>
            <input
              className="form-input--mono"
              type="text"
              value={config.settings.localAsrUrl}
              onChange={(e) => onConfigChange({
                ...config,
                settings: { ...config.settings, localAsrUrl: e.target.value }
              })}
              placeholder="http://localhost:2233/transcribe"
            />
            <p className="form-hint">
              请确保后端服务 <code>scripts/whisper_server.py</code> 已启动。
            </p>
          </div>

          <div className="form-group--row">
            <div>
              <label className="form-label">Beam Size (搜索宽度)</label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="10"
                value={config.settings.asrBeamSize || 2}
                onChange={(e) => onConfigChange({
                  ...config,
                  settings: { ...config.settings, asrBeamSize: parseInt(e.target.value) || 1 }
                })}
              />
              <p className="form-hint">影响识别精度与速度，建议值为 2-5。</p>
            </div>
            <div>
              <label className="form-label">VAD 过滤 (静音检测)</label>
              <div className="checkbox-row" style={{ padding: '10px 0' }}>
                <input
                  className="form-checkbox"
                  type="checkbox"
                  checked={config.settings.asrVadFilter}
                  onChange={(e) => onConfigChange({
                    ...config,
                    settings: { ...config.settings, asrVadFilter: e.target.checked }
                  })}
                />
                <span className="checkbox-label" style={{ fontWeight: 500 }}>
                  {config.settings.asrVadFilter ? '已启用高精过滤' : '未启用'}
                </span>
              </div>
              <p className="form-hint">过滤背景噪音和空白片段，提升转录效率。</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
