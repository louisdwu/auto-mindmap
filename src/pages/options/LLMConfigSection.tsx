import React from 'react';
import { LLMConfig, LLMProvider } from '../../types/config';
import { LLMService } from '../../services/llmService';

interface LLMConfigSectionProps {
  llmConfigs: LLMConfig[];
  selectedConfigId: string;
  editingConfig: LLMConfig | null;
  isAddingNew: boolean;
  saved: boolean;
  onSelectConfig: (id: string) => void;
  onDeleteConfig: (id: string) => void;
  onAddNewConfig: () => void;
  onCancelAdd: () => void;
  onSaveCurrentConfig: () => void;
  onUpdateEditingConfig: (updates: Partial<LLMConfig>) => void;
}

export const LLMConfigSection: React.FC<LLMConfigSectionProps> = ({
  llmConfigs,
  selectedConfigId,
  editingConfig,
  isAddingNew,
  saved,
  onSelectConfig,
  onDeleteConfig,
  onAddNewConfig,
  onCancelAdd,
  onSaveCurrentConfig,
  onUpdateEditingConfig
}) => {
  return (
    <section className="options-section">
      <h2>大模型配置</h2>

      {/* 配置列表 */}
      <div className="form-group">
        <label className="form-label--large">已保存的配置</label>
        <div className="llm-config-list">
          {llmConfigs.map(cfg => (
            <div
              key={cfg.id}
              className={`llm-config-card ${selectedConfigId === cfg.id ? 'llm-config-card--selected' : ''}`}
              onClick={() => !isAddingNew && onSelectConfig(cfg.id)}
            >
              <div style={{ flex: 1 }}>
                <div className="llm-config-card__name">{cfg.name}</div>
                <div className="llm-config-card__detail">
                  {cfg.provider === 'openai' ? 'OpenAI' : cfg.provider === 'gemini' ? 'Gemini' : '自定义'} · {cfg.model}
                </div>
              </div>
              {llmConfigs.length > 1 && (
                <button
                  className="llm-config-card__delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConfig(cfg.id);
                  }}
                  title="删除配置"
                >×</button>
              )}
            </div>
          ))}
          <button
            className="btn--add"
            onClick={onAddNewConfig}
            disabled={isAddingNew}
          >+ 新增配置</button>
        </div>

        {isAddingNew && (
          <div className="alert--adding">
            正在添加新配置，请填写下方信息后点击"保存当前配置"
          </div>
        )}
      </div>

      {editingConfig && (
        <>
          {/* 配置名称 */}
          <div className="form-group">
            <label className="form-label">配置名称</label>
            <input
              className="form-input"
              type="text"
              value={editingConfig.name}
              onChange={(e) => onUpdateEditingConfig({ name: e.target.value })}
              placeholder="例如：GPT-4、Claude API、本地 Ollama"
            />
            <p className="form-hint">为这个配置起一个便于识别的名称</p>
          </div>

          {/* LLM 提供商 */}
          <div className="form-group">
            <label className="form-label">LLM 提供商</label>
            <select
              className="form-select"
              value={editingConfig.provider}
              onChange={(e) => {
                const provider = e.target.value as LLMProvider;
                const updates: Partial<LLMConfig> = { provider };
                if (provider === 'openai') {
                  updates.apiUrl = 'https://api.openai.com/v1';
                  updates.model = 'gpt-3.5-turbo';
                } else if (provider === 'gemini') {
                  updates.apiUrl = 'https://generativelanguage.googleapis.com/v1beta';
                  updates.model = 'gemini-1.5-flash';
                } else if (provider === 'lmstudio') {
                  updates.apiUrl = 'http://localhost:1234/v1';
                  updates.model = 'qwen_qwen3.5-9b';
                  updates.maxTokens = 4096;
                  updates.temperature = 0.7;
                } else if (provider === 'ollama') {
                  updates.apiUrl = 'http://localhost:11434/api';
                  updates.model = 'llama3';
                  updates.maxTokens = 4096;
                  updates.temperature = 0.7;
                } else if (provider === 'custom') {
                  updates.apiUrl = '';
                  updates.model = '';
                }
                onUpdateEditingConfig(updates);
              }}
            >
              <option value="openai">OpenAI (GPT-3.5/GPT-4)</option>
              <option value="gemini">Google Gemini</option>
              <option value="ollama">Ollama (本地/云端)</option>
              <option value="lmstudio">LM Studio (本地模型)</option>
              <option value="custom">自定义 (OpenAI 兼容)</option>
            </select>
            <p className="form-hint">选择您要使用的 LLM 服务提供商</p>
          </div>

          {/* API 地址 */}
          <div className="form-group">
            <label className="form-label">API地址</label>
            <input
              className="form-input"
              type="text"
              value={editingConfig.apiUrl}
              onChange={(e) => onUpdateEditingConfig({ apiUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
            <p className="form-hint">
              {editingConfig.provider === 'gemini'
                ? 'Gemini API 地址，例如：https://generativelanguage.googleapis.com/v1beta'
                : editingConfig.provider === 'openai'
                ? 'OpenAI API 地址，例如：https://api.openai.com/v1'
                : editingConfig.provider === 'ollama'
                ? 'Ollama API 地址，本地通常为 http://localhost:11434/api，云端为 https://ollama.com/api'
                : '自定义 API 地址，需兼容 OpenAI API 格式'}
            </p>

            {/* Gemini 地区提示 */}
            {editingConfig.provider === 'gemini' && (
              <div className="alert--warning">
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <div>
                  <strong>地区限制提醒：</strong>
                  如果您在中国大陆使用，直接访问上述地址会报错。请确保开启<strong>全局代理</strong>，或使用可靠的<strong>反向代理地址</strong>。
                </div>
              </div>
            )}

            {/* Ollama 提示 */}
            {editingConfig.provider === 'ollama' && (
              <div className="alert--info">
                <strong>Ollama 提示：</strong>
                本地使用建议填写 <code>http://localhost:11434/api</code>。使用 Ollama Cloud 请填写 <code>https://ollama.com/api</code> 并提供 API Key。
              </div>
            )}

            {/* 实际请求地址预览 */}
            {editingConfig.apiUrl && (
              <div className="url-preview">
                <div className="url-preview__label">实际请求地址：</div>
                <code className="url-preview__url">
                  {LLMService.getFullRequestUrl(editingConfig.provider, editingConfig.apiUrl, editingConfig.model)}
                </code>
              </div>
            )}
          </div>

          {/* API 密钥 */}
          <div className="form-group">
            <label className="form-label">API密钥</label>
            <input
              className="form-input"
              type="text"
              value={editingConfig.apiKey}
              onChange={(e) => onUpdateEditingConfig({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
            {editingConfig.provider === 'lmstudio' && (
              <p className="form-hint">本地 LM Studio 通常不需要 API 密钥，可以留空。</p>
            )}
            {editingConfig.provider === 'ollama' && (
              <p className="form-hint">本地 Ollama 不需要 API 密钥；Ollama Cloud 请填入官方生成的 API Key。</p>
            )}
          </div>

          {/* 模型名称 */}
          <div className="form-group">
            <label className="form-label">模型名称</label>
            <input
              className="form-input"
              type="text"
              value={editingConfig.model}
              onChange={(e) => onUpdateEditingConfig({ model: e.target.value })}
              placeholder={editingConfig.provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-3.5-turbo'}
            />
          </div>

          {/* 超时时间 */}
          <div className="form-group">
            <label className="form-label">超时时间 (秒)</label>
            <input
              className="form-input"
              type="number"
              value={editingConfig.timeout || 60}
              onChange={(e) => onUpdateEditingConfig({ timeout: parseInt(e.target.value) || 60 })}
              min="5"
              max="300"
            />
            <p className="form-hint">API 请求的超时时间，建议 30-120 秒</p>
          </div>

          {/* Max Tokens & Temperature */}
          <div className="form-group--row">
            <div>
              <label className="form-label">Max Tokens</label>
              <input
                className="form-input"
                type="number"
                value={editingConfig.maxTokens || 4096}
                onChange={(e) => onUpdateEditingConfig({ maxTokens: parseInt(e.target.value) || 4096 })}
                min="1"
                max="32768"
              />
              <p className="form-hint">单次请求最大生成的 Token 数。推理模型建议设为 4096 以上。</p>
            </div>
            <div>
              <label className="form-label">温度 (Temperature)</label>
              <input
                className="form-input"
                type="number"
                value={editingConfig.temperature ?? 0.7}
                onChange={(e) => onUpdateEditingConfig({ temperature: parseFloat(e.target.value) || 0.7 })}
                step="0.1"
                min="0"
                max="2"
              />
              <p className="form-hint">控制输出的随机性。思维导图建议 0.5 - 0.7 之间。</p>
            </div>
          </div>

          {/* 保存按钮 */}
          <div className="btn-row--spaced">
            <button className="btn--success" onClick={onSaveCurrentConfig}>
              {saved ? '✓ 已保存' : (isAddingNew ? '保存新配置' : '保存当前配置')}
            </button>
            {isAddingNew && (
              <button className="btn--cancel" onClick={onCancelAdd}>取消</button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
