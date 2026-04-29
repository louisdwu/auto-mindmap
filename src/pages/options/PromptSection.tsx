import React from 'react';
import { PluginConfig, LLMConfig } from '../../types/config';

interface PromptSectionProps {
  config: PluginConfig;
  llmConfigs: LLMConfig[];
  onConfigChange: (config: PluginConfig) => void;
}

export const PromptSection: React.FC<PromptSectionProps> = ({ config, llmConfigs, onConfigChange }) => {
  return (
    <section className="options-section">
      <div className="section-header">
        <h3>思维导图生成流配置</h3>
      </div>

      <div className="form-group">
        <label className="form-label">主总结阶段模型 (Initial Summary)</label>
        <select
          className="form-select"
          value={config.selectedLLMConfigId || 'default'}
          onChange={(e) => onConfigChange({
            ...config,
            selectedLLMConfigId: e.target.value
          })}
        >
          <option value="default">默认配置</option>
          {llmConfigs.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <p className="form-hint">负责进行第一遍全文字幕的结构化提炼。</p>
      </div>

      <div className="section-divider" />

      <div className="form-group">
        <div className="flex-row">
          <label className="form-label">启用反思模式 (Reflection Mode)</label>
          <div className="switch-container">
            <input
              type="checkbox"
              id="enableReflection"
              checked={config.settings.enableReflection}
              onChange={(e) => onConfigChange({
                ...config,
                settings: { ...config.settings, enableReflection: e.target.checked }
              })}
            />
            <label htmlFor="enableReflection" className="switch-label"></label>
          </div>
        </div>
        <p className="form-hint">开启后，将进行“生成 &rarr; 评估并优化”两阶段流程。显著提升导图质量，比单阶段更精准。</p>
      </div>

      {config.settings.enableReflection && (
        <div className="reflection-settings animate-fade-in">
          <div className="form-row">
            <div className="form-group flex-1">
              <label className="form-label">反思优化模型 (Reflection/Optimization)</label>
              <select
                className="form-select"
                value={config.settings.reflectionLLMConfigId}
                onChange={(e) => onConfigChange({
                  ...config,
                  settings: { ...config.settings, reflectionLLMConfigId: e.target.value }
                })}
              >
                <option value="default">跟随主模型</option>
                {llmConfigs.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">反思优化 Prompt</label>
            <textarea
              className="form-textarea form-textarea--medium"
              value={config.prompt.reflectionPrompt}
              onChange={(e) => onConfigChange({
                ...config,
                prompt: { ...config.prompt, reflectionPrompt: e.target.value }
              })}
              placeholder="评价初稿并执行优化补全"
            />
            <p className="form-hint">变量：{'{subtitle_content}'}, {'{initial_mindmap}'}</p>
            <p className="form-hint">若内容为空，将自动使用系统内置默认值。</p>
          </div>
        </div>
      )}

      <div className="section-divider" />

      <div className="form-group">
        <label className="form-label">系统提示词 (System Prompt)</label>
        <textarea
          className="form-textarea form-textarea--tall"
          value={config.prompt.systemPrompt}
          onChange={(e) => onConfigChange({
            ...config,
            prompt: { ...config.prompt, systemPrompt: e.target.value }
          })}
          placeholder="请输入系统级指令"
        />
        <p className="form-hint">定义模型角色和任务约束。若为空，将自动使用系统默认值。</p>
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
          placeholder="使用 {subtitle_content} 作为占位符"
        />
        <p className="form-hint">用于主总结阶段。使用 {'{subtitle_content}'} 替代字幕内容。若为空，将自动使用系统默认值。</p>
      </div>
    </section>
  );
};
