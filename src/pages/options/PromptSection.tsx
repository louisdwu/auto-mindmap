import React from 'react';
import { PluginConfig } from '../../types/config';

interface PromptSectionProps {
  config: PluginConfig;
  onConfigChange: (config: PluginConfig) => void;
}

export const PromptSection: React.FC<PromptSectionProps> = ({ config, onConfigChange }) => {
  return (
    <section className="options-section">
      <h2>Prompt设置</h2>

      <div className="form-group">
        <label className="form-label">系统提示词 (System Prompt)</label>
        <textarea
          className="form-textarea form-textarea--tall"
          value={config.prompt.systemPrompt}
          onChange={(e) => onConfigChange({
            ...config,
            prompt: { ...config.prompt, systemPrompt: e.target.value }
          })}
          placeholder="请输入系统级指令，用于定义模型的身份、任务和约束（推荐放入逻辑指令）"
        />
        <p className="form-hint">用于定义模型角色和任务约束。对于 Claude/Qwen 等模型效果显著。</p>
      </div>

      <div className="form-group">
        <label className="form-label">用户消息模板 (User Prompt Template)</label>
        <textarea
          className="form-textarea form-textarea--medium"
          value={config.prompt.template}
          onChange={(e) => onConfigChange({
            ...config,
            prompt: { ...config.prompt, template: e.target.value }
          })}
          placeholder="请输入用户消息模板，使用 {subtitle_content} 作为占位符"
        />
        <p className="form-hint">使用 {'{subtitle_content}'} 作为字幕内容的占位符</p>
      </div>
    </section>
  );
};
