import React, { useMemo, useState } from 'react';
import {
  LLMConfig,
  LLMProvider,
  LLM_PROVIDER_PRESETS,
  PluginConfig,
  getProviderLabel
} from '../../types/config';
import { ConnectionTestResult, LLMService } from '../../services/llmService';

interface LLMConfigSectionProps {
  config: PluginConfig;
  llmConfigs: LLMConfig[];
  editingConfigId: string;
  editingConfig: LLMConfig | null;
  saved: boolean;
  onEditConfig: (id: string) => void;
  onDeleteConfig: (id: string) => void;
  onAddNewConfig: (provider?: LLMProvider) => void;
  onSetActiveConfig: (id: string) => void;
  onUpdateEditingConfig: (updates: Partial<LLMConfig>) => void;
}

const PROVIDER_ORDER: LLMProvider[] = [
  'openai',
  'gemini',
  'sensenova',
  'ollama',
  'lmstudio',
  'custom'
];

/** 每个提供商只保留一条真正需要用户知道的信息，避免表单变成说明书 */
function providerNote(provider: LLMProvider): string {
  switch (provider) {
    case 'openai':
      return '基址通常以 /v1 结尾，插件会自动补 /chat/completions。';
    case 'gemini':
      return '中国大陆通常需要全局代理或反向代理地址；模型名可点「测试连接」后从清单里选。';
    case 'sensenova':
      return '内地基址必须带 /v1（https://token.sensenova.cn/v1），与海外 Key 不通用。';
    case 'ollama':
      return '本地默认 http://localhost:11434/api；Ollama Cloud 用 https://ollama.com/api 并填写 Key。';
    case 'lmstudio':
      return '本地默认 http://localhost:1234/v1；通常不需要 API Key。';
    case 'custom':
      return '填写任意兼容 OpenAI /chat/completions 的基址即可。';
    default:
      return '';
  }
}

export const LLMConfigSection: React.FC<LLMConfigSectionProps> = ({
  config,
  llmConfigs,
  editingConfigId,
  editingConfig,
  saved,
  onEditConfig,
  onDeleteConfig,
  onAddNewConfig,
  onSetActiveConfig,
  onUpdateEditingConfig
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showProviderPicker, setShowProviderPicker] = useState(false);

  const activeId = llmConfigs.some(cfg => cfg.id === config.selectedLLMConfigId)
    ? config.selectedLLMConfigId
    : (llmConfigs[0]?.id || '');

  const preset = editingConfig ? LLM_PROVIDER_PRESETS[editingConfig.provider] : null;
  const isActive = !!editingConfig && editingConfig.id === activeId;
  const needsManualUrl = editingConfig
    ? ['custom', 'ollama', 'lmstudio'].includes(editingConfig.provider)
    : false;

  const modelSuggestions = useMemo(() => {
    const values = [
      preset?.model,
      ...(testResult?.models || [])
    ].filter((value): value is string => Boolean(value && value.trim()));
    return Array.from(new Set(values)).slice(0, 8);
  }, [preset?.model, testResult]);

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

  const applyProvider = (provider: LLMProvider) => {
    const nextPreset = LLM_PROVIDER_PRESETS[provider];
    const updates: Partial<LLMConfig> = {
      provider,
      apiUrl: nextPreset.apiUrl,
      model: nextPreset.model
    };
    if (nextPreset.maxTokens) updates.maxTokens = nextPreset.maxTokens;
    if (nextPreset.numCtx) updates.num_ctx = nextPreset.numCtx;
    if (nextPreset.temperature !== undefined) updates.temperature = nextPreset.temperature;
    resetTestResult();
    onUpdateEditingConfig(updates);
  };

  const handlePickProvider = (provider: LLMProvider) => {
    setShowProviderPicker(false);
    onAddNewConfig(provider);
  };

  return (
    <section className="options-section llm-section">
      <div className="llm-section__head">
        <div>
          <h2 className="llm-section__title">大模型</h2>
          <p className="llm-section__desc">
            选一个服务商，填入密钥和模型即可。超时、上下文等参数默认折叠，通常不需要改。
          </p>
        </div>
        <button
          type="button"
          className="btn--primary llm-add-btn"
          onClick={() => setShowProviderPicker(value => !value)}
        >
          ＋ 添加模型
        </button>
      </div>

      {showProviderPicker && (
        <div className="llm-provider-picker">
          <div className="llm-provider-picker__head">
            <strong>选择服务商</strong>
            <span>添加后可在下方填写密钥与模型</span>
          </div>
          <div className="llm-provider-grid">
            {PROVIDER_ORDER.map(provider => {
              const item = LLM_PROVIDER_PRESETS[provider];
              const badgeClass = item.badge === '本地'
                ? 'llm-provider-card__badge--local'
                : item.badge === '兼容'
                  ? 'llm-provider-card__badge--compat'
                  : 'llm-provider-card__badge--cloud';
              return (
                <button
                  key={provider}
                  type="button"
                  className="llm-provider-card"
                  onClick={() => handlePickProvider(provider)}
                >
                  <span className="llm-provider-card__icon">{item.icon}</span>
                  <span className="llm-provider-card__body">
                    <strong>{item.label}</strong>
                    <small title={item.tagline}>{item.tagline}</small>
                  </span>
                  <span className={'llm-provider-card__badge ' + badgeClass}>
                    {item.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="llm-config-list">
        {llmConfigs.map(cfg => {
          const item = LLM_PROVIDER_PRESETS[cfg.provider];
          const active = cfg.id === activeId;
          const cardClass = [
            'llm-config-card',
            editingConfigId === cfg.id ? 'llm-config-card--selected' : '',
            active ? 'llm-config-card--active' : ''
          ].filter(Boolean).join(' ');
          return (
            <div
              key={cfg.id}
              className={cardClass}
              role="button"
              tabIndex={0}
              onClick={() => {
                resetTestResult();
                onEditConfig(cfg.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  resetTestResult();
                  onEditConfig(cfg.id);
                }
              }}
            >
              <div className="llm-config-card__icon">{item?.icon || '🤖'}</div>
              <div className="llm-config-card__body">
                <div className="llm-config-card__name">
                  {cfg.name || '未命名配置'}
                  {active && <span className="llm-config-card__badge">使用中</span>}
                </div>
                <div className="llm-config-card__detail">
                  {getProviderLabel(cfg.provider)} · {cfg.model || '未填写模型'}
                </div>
              </div>
              <div className="llm-config-card__actions">
                {!active && (
                  <button
                    type="button"
                    className="llm-config-card__use"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetActiveConfig(cfg.id);
                    }}
                  >
                    使用
                  </button>
                )}
                {llmConfigs.length > 1 && (
                  <button
                    type="button"
                    className="llm-config-card__delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteConfig(cfg.id);
                    }}
                    title="删除配置"
                    aria-label="删除配置"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editingConfig ? (
        <div className="llm-editor">
          <div className="llm-editor__head">
            <div>
              <div className="llm-editor__title">
                编辑 · {editingConfig.name || '未命名配置'}
              </div>
              <div className="llm-editor__sub">
                {getProviderLabel(editingConfig.provider)}
                {isActive ? ' · 当前生成使用此配置' : ' · 尚未设为当前使用'}
              </div>
            </div>
            <div className="llm-editor__actions">
              {isActive ? (
                <span className="llm-status-pill">✓ 使用中</span>
              ) : (
                <button
                  type="button"
                  className="btn--secondary-outline"
                  onClick={() => {
                    resetTestResult();
                    onSetActiveConfig(editingConfig.id);
                  }}
                >
                  设为当前使用
                </button>
              )}
              <span className="llm-save-status">{saved ? '✓ 已保存' : '修改自动保存'}</span>
            </div>
          </div>

          <div className="llm-form-grid">
            <div className="form-group">
              <label className="form-label">配置名称</label>
              <input
                className="form-input"
                type="text"
                value={editingConfig.name}
                onChange={(event) => onUpdateEditingConfig({ name: event.target.value })}
                placeholder="例如：GPT-4o、SenseNova、本地 Ollama"
              />
            </div>

            <div className="form-group">
              <label className="form-label">模型</label>
              <input
                className="form-input"
                type="text"
                value={editingConfig.model}
                onChange={(event) => onUpdateEditingConfig({ model: event.target.value })}
                placeholder={preset?.model || '例如：gpt-4o-mini'}
                list="llm-model-suggestions"
                spellCheck={false}
              />
              <datalist id="llm-model-suggestions">
                {modelSuggestions.map(model => <option key={model} value={model} />)}
              </datalist>
              {modelSuggestions.length > 1 && (
                <div className="llm-model-chips">
                  {modelSuggestions.slice(0, 6).map(model => {
                    const chipClass = model === editingConfig.model
                      ? 'llm-model-chip llm-model-chip--active'
                      : 'llm-model-chip';
                    return (
                      <button
                        key={model}
                        type="button"
                        className={chipClass}
                        onClick={() => onUpdateEditingConfig({ model })}
                      >
                        {model}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">API 密钥</label>
            <div className="llm-key-row">
              <input
                className="form-input"
                type={showApiKey ? 'text' : 'password'}
                value={editingConfig.apiKey}
                onChange={(event) => onUpdateEditingConfig({ apiKey: event.target.value })}
                placeholder={editingConfig.provider === 'ollama' ? '本地 Ollama 可留空；云端需填写' : 'sk-...'}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn--secondary-outline"
                onClick={() => setShowApiKey(value => !value)}
                title={showApiKey ? '隐藏密钥' : '显示密钥'}
              >
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
            <p className="form-hint">
              只保存在本机 <code>chrome.storage.local</code>，不会同步到云端；导出配置时默认脱敏。
            </p>
            {['openai', 'gemini', 'sensenova'].includes(editingConfig.provider)
              && !editingConfig.apiKey.trim() && (
                <div className="llm-inline-warning">
                  该服务商需要 API 密钥，留空会导致生成任务失败。
                </div>
              )}
          </div>

          {needsManualUrl && (
            <div className="form-group">
              <label className="form-label">API 地址</label>
              <input
                className="form-input form-input--mono"
                type="text"
                value={editingConfig.apiUrl}
                onChange={(event) => onUpdateEditingConfig({ apiUrl: event.target.value })}
                placeholder={preset?.apiUrl || 'https://example.com/v1'}
                spellCheck={false}
              />
              <p className="form-hint">{providerNote(editingConfig.provider)}</p>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">服务商</label>
            <div className="llm-provider-grid llm-provider-grid--compact">
              {PROVIDER_ORDER.map(provider => {
                const item = LLM_PROVIDER_PRESETS[provider];
                const providerClass = editingConfig.provider === provider
                  ? 'llm-provider-card llm-provider-card--compact llm-provider-card--active'
                  : 'llm-provider-card llm-provider-card--compact';
                return (
                  <button
                    key={provider}
                    type="button"
                    className={providerClass}
                    onClick={() => applyProvider(provider)}
                  >
                    <span className="llm-provider-card__icon">{item.icon}</span>
                    <span className="llm-provider-card__body">
                      <strong>{item.shortLabel || item.label}</strong>
                      <small>{item.badge}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            {!needsManualUrl && <p className="form-hint">{providerNote(editingConfig.provider)}</p>}
          </div>

          <div className="llm-advanced">
            <button
              type="button"
              className="llm-advanced__toggle"
              onClick={() => setShowAdvanced(value => !value)}
            >
              <span>
                <strong>高级设置</strong>
                <small>API 地址、超时、Max Tokens、上下文、温度、请求地址预览</small>
              </span>
              <span>{showAdvanced ? '收起' : '展开'}</span>
            </button>

            {showAdvanced && (
              <div className="llm-advanced__body">
                <div className="form-group">
                  <label className="form-label">API 地址</label>
                  <input
                    className="form-input form-input--mono"
                    type="text"
                    value={editingConfig.apiUrl}
                    onChange={(event) => onUpdateEditingConfig({ apiUrl: event.target.value })}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                  />
                  <p className="form-hint">{providerNote(editingConfig.provider)}</p>
                  {editingConfig.apiUrl && (
                    <div className="url-preview">
                      <div className="url-preview__label">实际请求地址</div>
                      <code>{LLMService.getFullRequestUrl(editingConfig.provider, editingConfig.apiUrl, editingConfig.model)}</code>
                    </div>
                  )}
                </div>

                <div className="llm-form-grid">
                  <div className="form-group">
                    <label className="form-label">超时时间（秒）</label>
                    <input
                      className="form-input"
                      type="number"
                      value={editingConfig.timeout || 60}
                      onChange={(event) => onUpdateEditingConfig({ timeout: parseInt(event.target.value) || 60 })}
                      min="5"
                      max="300"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Tokens</label>
                    <input
                      className="form-input"
                      type="number"
                      value={editingConfig.maxTokens || 8192}
                      onChange={(event) => onUpdateEditingConfig({ maxTokens: parseInt(event.target.value) || 8192 })}
                      min="1"
                      max="128000"
                    />
                    <p className="form-hint">实际输出会被限制在上下文窗口的 30% 以内。</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">上下文窗口</label>
                    <input
                      className="form-input"
                      type="number"
                      value={editingConfig.num_ctx || 32768}
                      onChange={(event) => onUpdateEditingConfig({ num_ctx: parseInt(event.target.value) || 32768 })}
                      min="512"
                      max="1048576"
                      step="512"
                    />
                    <p className="form-hint">决定长视频分段阈值；本地模型请与服务端设置一致。</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">温度</label>
                    <input
                      className="form-input"
                      type="number"
                      value={editingConfig.temperature ?? 0.7}
                      onChange={(event) => {
                        const value = parseFloat(event.target.value);
                        onUpdateEditingConfig({ temperature: Number.isNaN(value) ? 0.7 : value });
                      }}
                      step="0.1"
                      min="0"
                      max="2"
                    />
                    <p className="form-hint">思维导图建议 0.5 - 0.7，越低越稳定。</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="llm-testbar">
            <button
              type="button"
              className="btn--primary"
              onClick={handleTestConnection}
              disabled={testing || !editingConfig.apiUrl || !editingConfig.model}
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
            <span className="form-hint">
              用当前地址、密钥和模型发一次最小请求，并顺带取回可用模型清单。
            </span>
          </div>

          {testResult && (
            <div className={testResult.ok ? 'conn-test__result conn-test__result--ok' : 'conn-test__result conn-test__result--error'}>
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
                    该密钥可用模型（{testResult.models.length}），点击可填入：
                  </div>
                  <div className="conn-test__models-list">
                    {testResult.models.map(id => {
                      const modelClass = id === editingConfig.model?.trim()
                        ? 'conn-test__model conn-test__model--active'
                        : 'conn-test__model';
                      return (
                        <button
                          key={id}
                          type="button"
                          className={modelClass}
                          onClick={() => onUpdateEditingConfig({ model: id })}
                        >
                          {id}
                        </button>
                      );
                    })}
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
      ) : (
        <div className="llm-empty">
          <div className="llm-empty__icon">🤖</div>
          <div className="llm-empty__title">还没有配置大模型</div>
          <p className="llm-empty__desc">添加一个服务商，填入密钥后即可自动生成思维导图。</p>
          <button type="button" className="btn--primary" onClick={() => setShowProviderPicker(true)}>
            ＋ 添加模型
          </button>
        </div>
      )}
    </section>
  );
};