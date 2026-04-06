import React from 'react';
import { PluginConfig } from '../../types/config';

interface CacheSectionProps {
  config: PluginConfig;
  onConfigChange: (config: PluginConfig) => void;
}

export const CacheSection: React.FC<CacheSectionProps> = ({ config, onConfigChange }) => {
  return (
    <section className="options-section">
      <h2>缓存设置</h2>

      {/* 思维导图缓存开关 */}
      <div className="form-group">
        <label className="form-label">启用思维导图缓存</label>
        <div className="checkbox-row">
          <input
            className="form-checkbox"
            type="checkbox"
            checked={config.settings.enableCache}
            onChange={(e) => onConfigChange({
              ...config,
              settings: { ...config.settings, enableCache: e.target.checked }
            })}
          />
          <span className="checkbox-label">
            {config.settings.enableCache
              ? '已启用 - 相同视频会优先使用缓存的思维导图'
              : '未启用 - 每次都会重新生成思维导图'
            }
          </span>
        </div>
        <p className="form-hint">
          开启后，相同视频会优先使用已生成的思维导图，节省API调用次数
        </p>
      </div>

      {/* 思维导图基础字号 */}
      <div className="form-group">
        <label className="form-label">思维导图基础字号 ({Math.round(config.settings.mindmapFontSize * 100)}%)</label>
        <div className="flex-row">
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={config.settings.mindmapFontSize || 1.0}
            onChange={(e) => onConfigChange({
              ...config,
              settings: { ...config.settings, mindmapFontSize: parseFloat(e.target.value) }
            })}
            style={{ flex: 1 }}
          />
          <span style={{ marginLeft: '10px', fontSize: '13px', color: '#64748b', minWidth: '40px' }}>
            {config.settings.mindmapFontSize.toFixed(1)}x
          </span>
        </div>
        <p className="form-hint">
          调整思维导图节点的全局字体大小，布局将自动适配。建议范围：0.8 - 1.5。
        </p>
      </div>

      {/* ASR 设置 */}
      <div className="asr-panel">
        <label className="form-label--large">语音识别 (ASR) 配置</label>

        <div className="form-group">
          <div className="asr-radio-group">
            <label className="asr-radio-label">
              <input
                type="radio"
                name="asrProvider"
                checked={config.settings.asrProvider === 'official'}
                onChange={() => onConfigChange({
                  ...config,
                  settings: { ...config.settings, asrProvider: 'official' }
                })}
              />
              优先使用官方字幕
            </label>
            <label className="asr-radio-label">
              <input
                type="radio"
                name="asrProvider"
                checked={config.settings.asrProvider === 'local'}
                onChange={() => onConfigChange({
                  ...config,
                  settings: { ...config.settings, asrProvider: 'local' }
                })}
              />
              本地 Whisper 识别 (2080ti 加速)
            </label>
          </div>
        </div>

        {config.settings.asrProvider === 'local' && (
          <div style={{ marginTop: '10px' }}>
            <label className="form-label" style={{ fontSize: '13px' }}>本地 ASR 服务地址</label>
            <input
              className="form-input--small-mono"
              type="text"
              value={config.settings.localAsrUrl}
              onChange={(e) => onConfigChange({
                ...config,
                settings: { ...config.settings, localAsrUrl: e.target.value }
              })}
              placeholder="http://localhost:5000/transcribe"
            />
            <p className="form-hint">
              请运行 <code>scripts/whisper_server.py</code> 后填入地址
            </p>

            {/* ASR 性能参数 */}
            <div className="asr-params">
              <div>
                <label className="form-label">Beam Size (搜索宽度)</label>
                <input
                  className="form-input--small"
                  type="number"
                  min="1"
                  max="10"
                  value={config.settings.asrBeamSize || 2}
                  onChange={(e) => onConfigChange({
                    ...config,
                    settings: { ...config.settings, asrBeamSize: parseInt(e.target.value) || 1 }
                  })}
                />
              </div>
              <div>
                <label className="form-label">VAD 过滤 (静音检测)</label>
                <div className="asr-vad-row">
                  <input
                    className="form-checkbox"
                    type="checkbox"
                    checked={config.settings.asrVadFilter}
                    onChange={(e) => onConfigChange({
                      ...config,
                      settings: { ...config.settings, asrVadFilter: e.target.checked }
                    })}
                  />
                  <span>{config.settings.asrVadFilter ? '已开启' : '已关闭'}</span>
                </div>
              </div>
            </div>
            <p className="form-hint">
              优化建议：值越小速度越快。开启 VAD 可过滤静音，显著提升转录效率。
            </p>
          </div>
        )}
      </div>

      {/* 本地文件缓存 */}
      <div className="form-group">
        <label className="form-label">启用本地文件缓存</label>
        <div className="checkbox-row">
          <input
            className="form-checkbox"
            type="checkbox"
            checked={config.settings.cacheDirectory.trim().length > 0}
            onChange={(e) => onConfigChange({
              ...config,
              settings: {
                ...config.settings,
                cacheDirectory: e.target.checked ? 'enabled' : ''
              }
            })}
          />
          <span className="checkbox-label">
            {config.settings.cacheDirectory.trim().length > 0
              ? '已启用 - 文件将保存到 Chrome 下载目录的 bilibili_mindmap 文件夹'
              : '未启用 - 文件只保存在插件内存中'
            }
          </span>
        </div>
      </div>

      {config.settings.cacheDirectory.trim().length > 0 && (
        <div className="cache-info">
          <p>
            <strong>缓存说明：</strong>生成的字幕(.txt)和思维导图(.md)文件将自动保存到
            Chrome 默认下载目录下的 <code>bilibili_mindmap</code> 文件夹中。
            请在 Chrome 设置中确认下载目录位置。
          </p>
        </div>
      )}
    </section>
  );
};
