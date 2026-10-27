import React, { useState } from 'react';
import { LLMConfig, LLMProvider, LLM_PROVIDER_PRESETS, PluginConfig, getProviderLabel } from '../../types/config';
import { ConnectionTestResult, LLMService } from '../../services/llmService';

interface LLMConfigSectionProps {
  config: PluginConfig;
  llmConfigs: LLMConfig[];
  editingConfigId: string;
  editingConfig: LLMConfig | null;
  isAddingNew: boolean;
  saved: boolean;
  onEditConfig: (id: string) => void;
  onDeleteConfig: (id: string) => void;
  onAddNewConfig: () => void;
  onUpdateEditingConfig: (updates: Partial<LLMConfig>) => void;
}

export const LLMConfigSection: React.FC<LLMConfigSectionProps> = ({
  config,
  llmConfigs,
  editingConfigId,
  editingConfig,
  isAddingNew,
  saved,
  onEditConfig,
  onDeleteConfig,
  onAddNewConfig,
  onUpdateEditingConfig
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // 切换配置时清掉上一份测试结果，避免把 A 配置的结论误读成 B 配置的
  const resetTestResult = () => setTestResult(null);

  const handleTestConnection = async () => {
    if (!editingConfig || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await LLMService.testConnection(config, editingConfig);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="options-section">
      {/* 配置列表 */}
      <div className="form-group">
        <div className="llm-config-list">
          {llmConfigs.map(cfg => (
            <div
              key={cfg.id}
              className={`llm-config-card ${editingConfigId === cfg.id ? 'llm-config-card--selected' : ''}`}
              onClick={() => {
                if (isAddingNew) return;
                resetTestResult();
                onEditConfig(cfg.id);
              }}
            >
              <div style={{ flex: 1 }}>
                <div className="llm-config-card__name">
                  {cfg.name}
                </div>
                <div className="llm-config-card__detail">
                  {getProviderLabel(cfg.provider)} · {cfg.model}
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
                >
                  <span className="icon-delete">🗑️</span>
                </button>
              )}
            </div>
          ))}
          <button
            className="btn--add"
            onClick={onAddNewConfig}
            disabled={isAddingNew}
          >
            <span>+</span> 新增配置
          </button>
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
                const preset = LLM_PROVIDER_PRESETS[provider];
                // 默认值来自唯一来源（LLM_PROVIDER_PRESETS），与「新增配置」保持一致
                const updates: Partial<LLMConfig> = {
                  provider,
                  apiUrl: preset.apiUrl,
                  model: preset.model
                };
                if (preset.maxTokens) updates.maxTokens = preset.maxTokens;
                if (preset.numCtx) updates.num_ctx = preset.numCtx;
                if (preset.temperature) updates.temperature = preset.temperature;
                resetTestResult();
                onUpdateEditingConfig(updates);
              }}
            >
              <option value="openai">OpenAI (GPT-3.5/GPT-4)</option>
              <option value="gemini">Google Gemini</option>
              <option value="sensenova">商汤 SenseNova (6.8 Flash-Lite)</option>
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
                : editingConfig.provider === 'sensenova'
                ? '商汤 SenseNova 基址为 https://token.sensenova.cn/v1（必须带 /v1），插件会自动补 /chat/completions'
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

            {/* 商汤 SenseNova 提示 */}
            {editingConfig.provider === 'sensenova' && (
              <div className="alert--info">
                <strong>商汤 SenseNova 提示：</strong>
                内地基址 <code>https://token.sensenova.cn/v1</code>，海外基址 <code>https://token.sensenova.ai/v1</code>（两边 key 不通用）。
                模型标识按官方文档填写（6.8 预览版为 <code>sensenova-6.8-flash-lite</code>，6.7 版为 <code>sensenova-6.7-flash-lite</code>）。
                基址漏写 <code>/v1</code>、模型被上游改名/下线，网关都会返回 <code>HTTP 404: model route not found</code>。
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
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="form-input"
                type={showApiKey ? 'text' : 'password'}
                value={editingConfig.apiKey}
                onChange={(e) => onUpdateEditingConfig({ apiKey: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn--secondary-outline"
                onClick={() => setShowApiKey(v => !v)}
                title={showApiKey ? '隐藏密钥' : '显示密钥'}
                style={{ whiteSpace: 'nowrap', padding: '0 12px' }}
              >
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
            <p className="form-hint">
              密钥只保存在本机 <code>chrome.storage.local</code>，不会同步到云端；导出配置时默认脱敏。
            </p>
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
              placeholder={LLM_PROVIDER_PRESETS[editingConfig.provider]?.model || 'gpt-3.5-turbo'}
            />
            {editingConfig.provider === 'sensenova' && (
              <p className="form-hint">
                必须是服务商文档里的模型标识（区分大小写与连字符），例如 <code>sensenova-6.8-flash-lite</code>。
              </p>
            )}
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
                value={editingConfig.maxTokens || 16384}
                onChange={(e) => onUpdateEditingConfig({ maxTokens: parseInt(e.target.value) || 16384 })}
                min="1"
                max="128000"
              />
              <p className="form-hint">单次请求最大生成的 Token 数。推理模型建议设为 4096 以上。</p>
            </div>
            <div>
              <label className="form-label">温度 (Temperature)</label>
              <input
                className="form-input"
                type="number"
                value={editingConfig.temperature ?? 0.7}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  onUpdateEditingConfig({ temperature: isNaN(val) ? 0.7 : val });
                }}
                step="0.1"
                min="0"
                max="2"
              />
              <p className="form-hint">控制输出的随机性。思维导图建议 0.5 - 0.7 之间。</p>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">上下文窗口大小 (Context Window)</label>
            <input
              className="form-input"
              type="number"
              value={editingConfig.num_ctx || 16384}
              onChange={(e) => onUpdateEditingConfig({ num_ctx: parseInt(e.target.value) || 16384 })}
              min="512"
              max="1048576"
              step="512"
            />
            <p className="form-hint">
              模型允许的总 Token 数（输入+输出）。Ollama 默认 4096。长视频建议设为 16384 或更大。
              {editingConfig.provider === 'openai' || editingConfig.provider === 'gemini' || editingConfig.provider === 'sensenova'
                ? ' (对于 OpenAI/Gemini/商汤，此参数由模型硬性决定，不会随请求发送)' 
                : ' (对于 Ollama/LM Studio，此参数会发送给后端生效)'}
            </p>
          </div>

          {/* 连通性测试 */}
          <div className="form-group">
            <label className="form-label">连接测试</label>
            <div className="conn-test">
              <button
                type="button"
                className="btn--secondary-outline conn-test__btn"
                onClick={handleTestConnection}
                disabled={testing || !editingConfig.apiUrl || !editingConfig.model}
              >
                {testing ? '测试中…' : '测试连接'}
              </button>
              <p className="form-hint">
                用当前填写的地址、密钥和模型发一次最小请求，并顺带取回<strong>该密钥可用的模型清单</strong>（点一下即可填入）。
                404 / 401 这类错误只有看到「实际请求地址 + 模型 + 可用模型」才能定位，不必先跑一遍完整的导图生成。
              </p>

              {testResult && (
                <div className={`conn-test__result ${testResult.ok ? 'conn-test__result--ok' : 'conn-test__result--error'}`}>
                  <div className="conn-test__headline">
                    <strong>{testResult.ok ? '✅ 连接成功' : '❌ 连接失败'}</strong>
                    <span className="conn-test__latency">{testResult.latencyMs}ms</span>
                  </div>
                  <div className="conn-test__line">
                    实际请求地址：<code>{testResult.url || '(未填写)'}</code>
                  </div>
                  <div className="conn-test__line">
                    模型：<code>{editingConfig.model || '(未填写)'}</code>
                  </div>
                  <div className="conn-test__detail">{testResult.detail}</div>

                  {testResult.models && testResult.models.length > 0 && (
                    <div className="conn-test__models">
                      <div className="conn-test__models-title">
                        该密钥可用模型（{testResult.models.length}），点击可填入模型名称：
                      </div>
                      <div className="conn-test__models-list">
                        {testResult.models.map(id => (
                          <button
                            key={id}
                            type="button"
                            className={`conn-test__model ${id === editingConfig.model?.trim() ? 'conn-test__model--active' : ''}`}
                            onClick={() => onUpdateEditingConfig({ model: id })}
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(!testResult.models || testResult.models.length === 0) && testResult.modelsError && (
                    <div className="conn-test__models-title">
                      可用模型清单获取失败：{testResult.modelsError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 自动保存提示 */}
          <div style={{ marginTop: '24px', textAlign: 'right' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
              {saved ? '✓ 所有更改已自动保存' : '修改将自动保存...'}
            </span>
          </div>

        </>
      )}
    </section>
  );
};