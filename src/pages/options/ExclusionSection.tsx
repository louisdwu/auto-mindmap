import React, { useState } from 'react';
import { PluginConfig } from '../../types/config';

interface ExclusionSectionProps {
  config: PluginConfig;
  onConfigChange: (config: PluginConfig) => void;
}

export const ExclusionSection: React.FC<ExclusionSectionProps> = ({ config, onConfigChange }) => {
  const [newKeyword, setNewKeyword] = useState('');

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return;
    const keywords = config.exclusionKeywords || [];
    if (!keywords.includes(newKeyword.trim())) {
      onConfigChange({
        ...config,
        exclusionKeywords: [...keywords, newKeyword.trim()]
      });
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (keyword: string) => {
    const keywords = config.exclusionKeywords || [];
    onConfigChange({
      ...config,
      exclusionKeywords: keywords.filter(k => k !== keyword)
    });
  };

  return (
    <section className="options-section">
      <h2>自动运行例外设置</h2>

      <div className="form-group">
        <label className="form-label">排除关键词</label>
        <div className="keyword-input-row">
          <input
            className="form-input"
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
            placeholder="输入关键词后按回车添加"
          />
          <button className="btn--inline" onClick={handleAddKeyword}>添加</button>
        </div>

        <div className="keyword-list">
          {(config.exclusionKeywords || []).map((keyword, index) => (
            <div key={index} className="keyword-tag">
              <span>{keyword}</span>
              <button
                className="keyword-tag__remove"
                onClick={() => handleRemoveKeyword(keyword)}
              >×</button>
            </div>
          ))}
        </div>
        <p className="form-hint" style={{ marginTop: '10px' }}>
          当视频标题包含以上任意关键词时，插件将不会自动生成思维导图
        </p>
      </div>
    </section>
  );
};
