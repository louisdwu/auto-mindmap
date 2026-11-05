import React, { useMemo, useState } from 'react';
import {
  LLMConfig,
  LLMProvider,
  PluginConfig,
  getModelChain,
  getProviderLabel
} from '../../types/config';
import { ConnectionTestResult, LLMService, ModelsFetchResult } from '../../services/llmService';

interface LLMConfigSectionProps {
  config: PluginConfig;
  llmConfigs: LLMConfig[];
  editingConfigId: string;
  editingConfig: LLMConfig | null;
  saved: boolean;
  onEditConfig: (id: string) => void;
  onDeleteConfig: (id: string) => void;
  onAddNewConfig: () => void;
  onSetActiveConfig: (id: string) => void;
  onUpdateEditingConfig: (updates: Partial<LLMConfig>) => void;
}

function providerNote(provider: LLMProvider): string {
  if (provider === 'custom') {
    return '填写任意兼容 OpenAI /chat/completions 的基址即可，插件会自动补全请求路径。';
  }
  const label = getProviderLabel(provider);
  return `该配置沿用历史 ${label} 协议，可继续正常使用；新建配置已统一为自定义（OpenAI 兼容）。`;
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
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ModelsFetchResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [modelInput, setModelInput] = useState('');

  const activeId = llmConfigs.some(cfg => cfg.id === config.selectedLLMConfigId)
    ? config.selectedLLMConfigId
    : (llmConfigs[0]?.id || '');

  const isActive = !!editingConfig && editingConfig.id === activeId;
  const provider = editingConfig?.provider || 'custom';

  /** 通过 API 端点获取到的模型清单（成功时非空） */
  const fetchedList = fetchedModels?.ok ? fetchedModels.models : [];

  /** 当前编辑配置的模型优先级链（兼容旧单模型字段） */
  const modelChain = useMemo(
    () => editingConfig ? getModelChain(editingConfig) : [],
    [editingConfig]
  );

  const modelSuggestions = useMemo(() => {
    const values = [
      ...fetchedList,
      ...(testResult?.models || [])
    ].filter((value): value is string => Boolean(value && value.trim()));
    return Array.from(new Set(values)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedModels, testResult]);

  /** 地址/密钥变化后，旧的探测与清单结果都不再可信，一起清空 */
  const resetModelInfo = () => {
    setTestResult(null);
    setFetchedModels(null);
  };

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

  const handleFetchModels = async () => {
    if (!editingConfig || fetchingModels) return;
    setFetchingModels(true);
    try {
      const result = await LLMService.fetchModels(editingConfig);
      setFetchedModels(result);
    } finally {
      setFetchingModels(false);
    }
  };

  // === 模型优先级链管理 ===

  /** 写回链，并保持 model 字段与链首一致（兼容旧展示与旧数据） */
  const persistChain = (models: string[]) => {
    onUpdateEditingConfig({ models, model: models[0] || '' });
  };

  /** 新模型追加到链尾（添加顺序即优先级），已存在则不重复添加 */
  const addModel = (raw: string) => {
    const name = (raw || '').trim();
    if (!name) return;
    setModelInput('');
    if (modelChain.includes(name)) return;
    persistChain([...modelChain, name]);
  };

  const removeModel = (name: string) => {
    persistChain(modelChain.filter(m => m !== name));
  };

  const moveModel = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= modelChain.length) return;
    const next = [...modelChain];
    [next[index], next[target]] = [next[target], next[index]];
    persistChain(next);
  };

  return (
    <section className="options-section llm-section">
      <div className="llm-section__head">
        <div>
          <h2 className="llm-section__title">大模型</h2>
          <p className="llm-section__desc">
            填入兼容 OpenAI 的 API 地址、密钥和模型即可；可配置多个模型按序兜底。
          </p>
        </div>
        <button
          type="button"
          className="btn--primary llm-add-btn"
          onClick={onAddNewConfig}
        >
          ＋ 添加配置
        </button>
      </div>

      <div className="llm-config-list">
        {llmConfigs.map(cfg => {
          const chain = getModelChain(cfg);
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
                resetModelInfo();
                onEditConfig(cfg.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  resetModelInfo();
                  onEditConfig(cfg.id);
                }
              }}
            >
              <div className="llm-config-card__icon">🤖</div>
              <div className="llm-config-card__body">
                <div className="llm-config-card__name">
                  {cfg.name || '未命名配置'}
                  {active && <span className="llm-config-card__badge">使用中</span>}
                </div>
                <div className="llm-config-card__detail">
                  {chain.length > 0
                    ? (chain.length > 1 ? `${chain[0]} 等 ${chain.length} 个模型` : chain[0])
                    : '未填写模型'}
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
                {getProviderLabel(provider)}
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
                    resetModelInfo();
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
                placeholder="例如：主力配置、本地兜底"
              />
            </div>

            <div className="form-group">
              <label className="form-label">API 地址</label>
              <input
                className="form-input form-input--mono"
                type="text"
                value={editingConfig.apiUrl}
                onChange={(event) => onUpdateEditingConfig({ apiUrl: event.target.value })}
                placeholder="https://example.com/v1"
                spellCheck={false}
              />
              <p className="form-hint">{providerNote(provider)}</p>
              {editingConfig.apiUrl && (
                <div className="url-preview">
                  <div className="url-preview__label">实际请求地址</div>
                  <code>{LLMService.getFullRequestUrl(editingConfig.provider, editingConfig.apiUrl, modelChain[0] || '')}</code>
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
                placeholder={provider === 'ollama' ? '本地 Ollama 可留空；云端需填写' : 'sk-...'}
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
            {provider !== 'ollama' && !editingConfig.apiKey.trim() && (
              <div className="llm-inline-warning">
                该端点通常需要 API 密钥，留空会导致生成任务失败。
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">模型（按顺序尝试，失败自动切换）</label>
            {modelChain.length > 0 && (
              <div className="llm-model-chain">
                {modelChain.map((model, index) => (
                  <div
                    key={model}
                    className={index === 0 ? 'llm-model-chain__item llm-model-chain__item--primary' : 'llm-model-chain__item'}
                  >
                    <span className="llm-model-chain__order">{index + 1}</span>
                    <code className="llm-model-chain__name" title={model}>{model}</code>
                    {index === 0 && <span className="llm-model-chain__badge">优先</span>}
                    <div className="llm-model-chain__ops">
                      <button
                        type="button"
                        onClick={() => moveModel(index, -1)}
                        disabled={index === 0}
                        title="上移（提高优先级）"
                        aria-label={`上移模型 ${model}`}
                      >↑</button>
                      <button
                        type="button"
                        onClick={() => moveModel(index, 1)}
                        disabled={index === modelChain.length - 1}
                        title="下移（降低优先级）"
                        aria-label={`下移模型 ${model}`}
                      >↓</button>
                      <button
                        type="button"
                        onClick={() => removeModel(model)}
                        title="从链中移除"
                        aria-label={`移除模型 ${model}`}
                      >×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="llm-key-row">
              <input
                className="form-input"
                type="text"
                value={modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addModel(modelInput);
                  }
                }}
                placeholder="输入模型名后回车添加，如 gpt-4o-mini"
                list="llm-model-suggestions"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn--secondary-outline"
                onClick={() => addModel(modelInput)}
                disabled={!modelInput.trim()}
              >
                添加
              </button>
              <button
                type="button"
                className="btn--secondary-outline"
                onClick={handleFetchModels}
                disabled={fetchingModels || !editingConfig.apiUrl.trim()}
                title={`通过 API 端点拉取可用模型清单，不发探测请求${fetchedModels?.url ? `\n${fetchedModels.url}` : ''}`}
              >
                {fetchingModels ? '获取中…' : '获取模型'}
              </button>
            </div>
            <datalist id="llm-model-suggestions">
              {modelSuggestions.map(model => <option key={model} value={model} />)}
            </datalist>
            {(fetchedList.length > 0 || modelSuggestions.length > 0) && (
              <div className={'llm-model-chips' + (fetchedList.length > 1 ? ' llm-model-chips--scroll' : '')}>
                {(fetchedList.length > 0 ? fetchedList : modelSuggestions).map(model => {
                  const inChain = modelChain.includes(model);
                  const chipClass = inChain
                    ? 'llm-model-chip llm-model-chip--active'
                    : 'llm-model-chip';
                  return (
                    <button
                      key={model}
                      type="button"
                      className={chipClass}
                      onClick={() => addModel(model)}
                      title={inChain ? '已在模型链中' : '点击添加到模型链末尾'}
                    >
                      {model}
                    </button>
                  );
                })}
              </div>
            )}
            {fetchedModels && (
              fetchedModels.ok ? (
                <p className="llm-fetch-status llm-fetch-status--ok">
                  已从清单端点获取 {fetchedModels.models.length} 个模型（{fetchedModels.latencyMs}ms），点击模型名即可加入模型链。
                </p>
              ) : (
                <p className="llm-fetch-status llm-fetch-status--error">
                  获取模型清单失败：{fetchedModels.error}
                  <br />
                  <code>{fetchedModels.url || '(未填写 API 地址)'}</code>
                </p>
              )
            )}
            {modelChain.length > 1 && (
              <p className="form-hint">
                生成时按 1 → {modelChain.length} 顺序尝试：当前模型请求失败会自动切换到下一个，全部失败才报错。
              </p>
            )}
          </div>

          <div className="llm-advanced">
            <button
              type="button"
              className="llm-advanced__toggle"
              onClick={() => setShowAdvanced(value => !value)}
            >
              <span>
                <strong>高级设置</strong>
                <small>超时、Max Tokens、上下文、温度</small>
              </span>
              <span>{showAdvanced ? '收起' : '展开'}</span>
            </button>

            {showAdvanced && (
              <div className="llm-advanced__body">
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
              disabled={testing || !editingConfig.apiUrl.trim() || modelChain.length === 0}
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
            <span className="form-hint">
              用当前地址、密钥和链首模型发一次最小请求，并顺带取回可用模型清单。
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
                模型：<code>{modelChain[0] || '(未填写)'}</code>
              </div>
              <div className="conn-test__detail">{testResult.detail}</div>

              {testResult.models && testResult.models.length > 0 && (
                <div className="conn-test__models">
                  <div className="conn-test__models-title">
                    该密钥可用模型（{testResult.models.length}），点击可加入模型链：
                  </div>
                  <div className="conn-test__models-list">
                    {testResult.models.map(id => {
                      const inChain = modelChain.includes(id);
                      const modelClass = inChain
                        ? 'conn-test__model conn-test__model--active'
                        : 'conn-test__model';
                      return (
                        <button
                          key={id}
                          type="button"
                          className={modelClass}
                          onClick={() => addModel(id)}
                          title={inChain ? '已在模型链中' : '点击添加到模型链末尾'}
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
          <p className="llm-empty__desc">添加配置，填入 API 地址与密钥后即可自动生成思维导图。</p>
          <button type="button" className="btn--primary" onClick={onAddNewConfig}>
            ＋ 添加配置
          </button>
        </div>
      )}
    </section>
  );
};
