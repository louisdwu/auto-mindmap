import React from 'react';
import { PluginConfig } from '../../types/config';

interface CacheSectionProps {
  config: PluginConfig;
  onConfigChange: (config: PluginConfig) => void;
}

export const CacheSection: React.FC<CacheSectionProps> = ({ config, onConfigChange }) => {
  return (
    <section className="options-section">
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
