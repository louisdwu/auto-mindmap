import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginConfig, DEFAULT_CONFIG, LLMProvider, LLMConfig, createDefaultLLMConfig } from '../types/config';
import { StorageService } from '../services/storageService';
import { LLMService } from '../services/llmService';

function Options() {
  const [config, setConfig] = useState<PluginConfig>(DEFAULT_CONFIG);
  const [llmConfigs, setLLMConfigs] = useState<LLMConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadConfig();
    loadLLMConfigs();
  }, []);

  const loadConfig = async () => {
    const savedConfig = await StorageService.getConfig();
    if (savedConfig) {
      setConfig(savedConfig);
      setSelectedConfigId(savedConfig.selectedLLMConfigId || 'default');
    }
  };

  const loadLLMConfigs = async () => {
    const configs = await StorageService.getLLMConfigs();
    setLLMConfigs(configs);
    
    // 设置当前编辑的配置
    const pluginConfig = await StorageService.getConfig();
    const selectedId = pluginConfig?.selectedLLMConfigId || 'default';
    const selected = configs.find(c => c.id === selectedId) || configs[0];
    if (selected) {
      setEditingConfig(selected);
      setSelectedConfigId(selected.id);
    }
  };

  const handleSelectConfig = async (id: string) => {
    setSelectedConfigId(id);
    const selected = llmConfigs.find(c => c.id === id);
    if (selected) {
      setEditingConfig(selected);
      await StorageService.setSelectedLLMConfig(id);
      // 重新加载配置以同步 llm 字段
      await loadConfig();
    }
  };

  const handleAddNewConfig = () => {
    const newConfig = createDefaultLLMConfig('custom');
    newConfig.name = `新配置 ${llmConfigs.length + 1}`;
    setEditingConfig(newConfig);
    setIsAddingNew(true);
  };

  const handleSaveCurrentConfig = async () => {
    if (!editingConfig) {
      console.log('[Options] handleSaveCurrentConfig: editingConfig is null');
      return;
    }
    
    console.log('[Options] handleSaveCurrentConfig: 开始保存配置', editingConfig);
    console.log('[Options] handleSaveCurrentConfig: API Key =', editingConfig.apiKey ? editingConfig.apiKey.substring(0, 8) + '...' : '(空)');
    
    try {
      await StorageService.saveLLMConfig(editingConfig);
      console.log('[Options] handleSaveCurrentConfig: saveLLMConfig 成功');
      
      if (isAddingNew) {
        // 新增配置后选中它
        console.log('[Options] handleSaveCurrentConfig: 设置选中配置', editingConfig.id);
        await StorageService.setSelectedLLMConfig(editingConfig.id);
        setSelectedConfigId(editingConfig.id);
        setIsAddingNew(false);
      } else {
        // 如果修改的是当前选中的配置，也需要同步更新 plugin_config.llm 字段
        if (editingConfig.id === selectedConfigId) {
          console.log('[Options] handleSaveCurrentConfig: 同步更新当前选中的配置');
          await StorageService.setSelectedLLMConfig(editingConfig.id);
        }
      }
      
      await loadLLMConfigs();
      await loadConfig();
      
      console.log('[Options] handleSaveCurrentConfig: 保存完成');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('[Options] handleSaveCurrentConfig: 保存失败', error);
      alert('保存失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeleteConfig = async (id: string) => {
    if (llmConfigs.length <= 1) {
      alert('至少需要保留一个配置！');
      return;
    }
    
    if (!confirm('确定要删除这个配置吗？')) {
      return;
    }
    
    const success = await StorageService.deleteLLMConfig(id);
    if (success) {
      await loadLLMConfigs();
      await loadConfig();
      
      // 如果删除的是当前编辑的配置，选择第一个
      if (id === editingConfig?.id) {
        const configs = await StorageService.getLLMConfigs();
        if (configs.length > 0) {
          setEditingConfig(configs[0]);
          setSelectedConfigId(configs[0].id);
        }
      }
    }
  };

  const handleCancelAdd = () => {
    setIsAddingNew(false);
    // 恢复到之前选中的配置
    const selected = llmConfigs.find(c => c.id === selectedConfigId);
    if (selected) {
      setEditingConfig(selected);
    }
  };

  const handleSave = async () => {
    await StorageService.saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = async () => {
    setConfig(DEFAULT_CONFIG);
    await StorageService.saveConfig(DEFAULT_CONFIG);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearCache = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_MINDMAPS' });
      alert('缓存已清除！');
    } catch (error) {
      console.error('清除缓存失败:', error);
      alert('清除缓存失败');
    }
  };

  const updateEditingConfig = (updates: Partial<LLMConfig>) => {
    if (editingConfig) {
      setEditingConfig({ ...editingConfig, ...updates });
    }
  };

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return;
    
    const keywords = config.exclusionKeywords || [];
    if (!keywords.includes(newKeyword.trim())) {
      setConfig({
        ...config,
        exclusionKeywords: [...keywords, newKeyword.trim()]
      });
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (keyword: string) => {
    const keywords = config.exclusionKeywords || [];
    setConfig({
      ...config,
      exclusionKeywords: keywords.filter(k => k !== keyword)
    });
  };

  const handleExportConfig = async () => {
    try {
      await StorageService.downloadConfigFile();
      setImportStatus({ type: 'success', message: '配置已导出' });
      setTimeout(() => setImportStatus(null), 3000);
    } catch (error) {
      console.error('导出配置失败:', error);
      setImportStatus({ type: 'error', message: '导出失败' });
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  const handleImportConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = await StorageService.readConfigFromFile(file);
      const result = await StorageService.importConfig(data, {
        overwriteExisting: true,
        mergeLLMConfigs: false
      });

      if (result.success) {
        // 重新加载配置
        await loadConfig();
        await loadLLMConfigs();
        setImportStatus({
          type: 'success',
          message: `配置导入成功，共导入 ${result.importedLLMConfigsCount} 个 LLM 配置`
        });
      } else {
        setImportStatus({ type: 'error', message: result.message });
      }
    } catch (error) {
      console.error('导入配置失败:', error);
      setImportStatus({
        type: 'error',
        message: error instanceof Error ? error.message : '导入失败'
      });
    }

    // 清除文件输入
    event.target.value = '';
    
    // 3秒后清除状态
    setTimeout(() => setImportStatus(null), 3000);
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '30px' }}>插件配置</h1>

      {/* 大模型配置 */}
      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ marginBottom: '15px' }}>大模型配置</h2>
        
        {/* 配置列表 */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
            已保存的配置
          </label>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '15px'
          }}>
            {llmConfigs.map(cfg => (
              <div
                key={cfg.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  border: selectedConfigId === cfg.id ? '2px solid #3b82f6' : '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: selectedConfigId === cfg.id ? '#eff6ff' : 'white',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onClick={() => !isAddingNew && handleSelectConfig(cfg.id)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{cfg.name}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    {cfg.provider === 'openai' ? 'OpenAI' : cfg.provider === 'gemini' ? 'Gemini' : '自定义'} · {cfg.model}
                  </div>
                </div>
                {llmConfigs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConfig(cfg.id);
                    }}
                    style={{
                      padding: '4px 8px',
                      background: 'transparent',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: '16px'
                    }}
                    title="删除配置"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            
            {/* 添加新配置按钮 */}
            <button
              onClick={handleAddNewConfig}
              disabled={isAddingNew}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '8px 16px',
                border: '2px dashed #d1d5db',
                borderRadius: '8px',
                backgroundColor: 'white',
                cursor: isAddingNew ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                color: '#6b7280',
                transition: 'all 0.2s'
              }}
            >
              + 新增配置
            </button>
          </div>
          
          {isAddingNew && (
            <div style={{
              padding: '10px',
              background: '#fef3c7',
              borderRadius: '6px',
              marginBottom: '15px',
              fontSize: '14px',
              color: '#92400e'
            }}>
              正在添加新配置，请填写下方信息后点击"保存当前配置"
            </div>
          )}
        </div>

        {editingConfig && (
          <>
            {/* 配置名称 */}
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                配置名称
              </label>
              <input
                type="text"
                value={editingConfig.name}
                onChange={(e) => updateEditingConfig({ name: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
                placeholder="例如：GPT-4、Claude API、本地 Ollama"
              />
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
                为这个配置起一个便于识别的名称
              </p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                LLM 提供商
              </label>
              <select
                value={editingConfig.provider}
                onChange={(e) => {
                  const provider = e.target.value as LLMProvider;
                  const updates: Partial<LLMConfig> = { provider };

                  // 根据提供商自动填充默认配置
                  if (provider === 'openai') {
                    updates.apiUrl = 'https://api.openai.com/v1';
                    updates.model = 'gpt-3.5-turbo';
                  } else if (provider === 'gemini') {
                    updates.apiUrl = 'https://generativelanguage.googleapis.com/v1beta';
                    updates.model = 'gemini-1.5-flash';
                  } else if (provider === 'custom') {
                    updates.apiUrl = '';
                    updates.model = '';
                  }

                  updateEditingConfig(updates);
                }}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: 'white'
                }}
              >
                <option value="openai">OpenAI (GPT-3.5/GPT-4)</option>
                <option value="gemini">Google Gemini</option>
                <option value="custom">自定义 (OpenAI 兼容)</option>
              </select>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
                选择您要使用的 LLM 服务提供商
              </p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                API地址
              </label>
              <input
                type="text"
                value={editingConfig.apiUrl}
                onChange={(e) => updateEditingConfig({ apiUrl: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
                placeholder="https://api.openai.com/v1"
              />
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
                {editingConfig.provider === 'gemini'
                  ? 'Gemini API 地址，例如：https://generativelanguage.googleapis.com/v1beta'
                  : editingConfig.provider === 'openai'
                  ? 'OpenAI API 地址，例如：https://api.openai.com/v1'
                  : '自定义 API 地址，需兼容 OpenAI API 格式'}
              </p>
              {/* 实际请求地址预览 */}
              {editingConfig.apiUrl && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb'
                }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                    实际请求地址：
                  </div>
                  <code style={{
                    fontSize: '12px',
                    color: '#1f2937',
                    wordBreak: 'break-all',
                    fontFamily: 'monospace'
                  }}>
                    {LLMService.getFullRequestUrl(
                      editingConfig.provider,
                      editingConfig.apiUrl,
                      editingConfig.model
                    )}
                  </code>
                </div>
              )}
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                API密钥
              </label>
              <input
                type="text"
                value={editingConfig.apiKey}
                onChange={(e) => updateEditingConfig({ apiKey: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
                placeholder="sk-..."
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                模型名称
              </label>
              <input
                type="text"
                value={editingConfig.model}
                onChange={(e) => updateEditingConfig({ model: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
                placeholder={editingConfig.provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-3.5-turbo'}
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                超时时间 (秒)
              </label>
              <input
                type="number"
                value={editingConfig.timeout || 60}
                onChange={(e) => updateEditingConfig({ timeout: parseInt(e.target.value) || 60 })}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
                min="5"
                max="300"
              />
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
                API 请求的超时时间，建议 30-120 秒
              </p>
            </div>

            {/* 保存当前配置按钮 */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <button
                onClick={handleSaveCurrentConfig}
                style={{
                  padding: '10px 20px',
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {saved ? '✓ 已保存' : (isAddingNew ? '保存新配置' : '保存当前配置')}
              </button>
              
              {isAddingNew && (
                <button
                  onClick={handleCancelAdd}
                  style={{
                    padding: '10px 20px',
                    background: '#6b7280',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  取消
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* Prompt配置 */}
      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ marginBottom: '15px' }}>Prompt模板</h2>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Prompt模板
          </label>
          <textarea
            value={config.prompt.template}
            onChange={(e) => setConfig({
              ...config,
              prompt: { ...config.prompt, template: e.target.value }
            })}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              minHeight: '200px',
              fontFamily: 'monospace'
            }}
            placeholder="请输入Prompt模板，使用 {subtitle_content} 作为字幕内容的占位符"
          />
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
            使用 {'{subtitle_content}'} 作为字幕内容的占位符
          </p>
        </div>
      </section>

      {/* 排除配置 */}
      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ marginBottom: '15px' }}>自动运行例外设置</h2>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            排除关键词
          </label>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
              placeholder="输入关键词后按回车添加"
              style={{
                flex: 1,
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
            <button
              onClick={handleAddKeyword}
              style={{
                padding: '0 20px',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              添加
            </button>
          </div>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {(config.exclusionKeywords || []).map((keyword, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  background: '#f3f4f6',
                  borderRadius: '20px',
                  fontSize: '14px',
                  color: '#374151'
                }}
              >
                <span>{keyword}</span>
                <button
                  onClick={() => handleRemoveKeyword(keyword)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '0 2px',
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '10px' }}>
            当视频标题包含以上任意关键词时，插件将不会自动生成思维导图
          </p>
        </div>
      </section>

      {/* 缓存配置 */}
      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ marginBottom: '15px' }}>缓存设置</h2>
        
        {/* 思维导图缓存开关 */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            启用思维导图缓存
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              checked={config.settings.enableCache}
              onChange={(e) => setConfig({
                ...config,
                settings: {
                  ...config.settings,
                  enableCache: e.target.checked
                }
              })}
              style={{ width: '18px', height: '18px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              {config.settings.enableCache
                ? '已启用 - 相同视频会优先使用缓存的思维导图'
                : '未启用 - 每次都会重新生成思维导图'
              }
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
            开启后，相同视频会优先使用已生成的思维导图，节省API调用次数
          </p>
        </div>

        {/* 本地文件缓存 */}
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            启用本地文件缓存
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              checked={config.settings.cacheDirectory.trim().length > 0}
              onChange={(e) => setConfig({
                ...config,
                settings: {
                  ...config.settings,
                  cacheDirectory: e.target.checked ? 'enabled' : ''
                }
              })}
              style={{ width: '18px', height: '18px' }}
            />
            <span style={{ fontSize: '14px', color: '#374151' }}>
              {config.settings.cacheDirectory.trim().length > 0
                ? '已启用 - 文件将保存到 Chrome 下载目录的 bilibili_mindmap 文件夹'
                : '未启用 - 文件只保存在插件内存中'
              }
            </span>
          </div>
        </div>

        {config.settings.cacheDirectory.trim().length > 0 && (
          <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #86efac' }}>
            <p style={{ fontSize: '13px', color: '#166534', margin: 0 }}>
              <strong>缓存说明：</strong>生成的字幕(.txt)和思维导图(.md)文件将自动保存到
              Chrome 默认下载目录下的 <code>bilibili_mindmap</code> 文件夹中。
              请在 Chrome 设置中确认下载目录位置。
            </p>
          </div>
        )}
      </section>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleSave}
          style={{
            padding: '12px 24px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          {saved ? '✓ 已保存' : '保存配置'}
        </button>
        
        <button
          onClick={handleReset}
          style={{
            padding: '12px 24px',
            background: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          重置默认
        </button>
      </div>

      {/* 清除缓存按钮 */}
      <div style={{ marginTop: '20px' }}>
        <button
          onClick={handleClearCache}
          style={{
            padding: '10px 20px',
            background: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          清除思维导图缓存
        </button>
        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
          清除所有已下载的字幕和思维导图数据
        </p>
      </div>

      {/* 配置导出/导入 */}
      <section style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
        <h2 style={{ marginBottom: '15px' }}>配置备份与恢复</h2>
        
        <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* 导出按钮 */}
          <div>
            <button
              onClick={handleExportConfig}
              style={{
                padding: '10px 20px',
                background: '#8b5cf6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>📤</span> 导出配置
            </button>
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
              将所有配置导出为 JSON 文件
            </p>
          </div>
          
          {/* 导入按钮 */}
          <div>
            <label
              style={{
                padding: '10px 20px',
                background: '#06b6d4',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>📥</span> 导入配置
              <input
                type="file"
                accept=".json"
                onChange={handleImportConfig}
                style={{ display: 'none' }}
              />
            </label>
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
              从 JSON 文件恢复配置
            </p>
          </div>
        </div>

        {/* 导入状态提示 */}
        {importStatus && (
          <div
            style={{
              marginTop: '15px',
              padding: '12px 16px',
              borderRadius: '6px',
              backgroundColor: importStatus.type === 'success' ? '#dcfce7' : '#fee2e2',
              color: importStatus.type === 'success' ? '#166534' : '#991b1b',
              fontSize: '14px'
            }}
          >
            {importStatus.type === 'success' ? '✓' : '✗'} {importStatus.message}
          </div>
        )}
        
        <div style={{
          marginTop: '15px',
          padding: '12px',
          background: '#f3f4f6',
          borderRadius: '6px',
          border: '1px solid #e5e7eb'
        }}>
          <p style={{ fontSize: '13px', color: '#4b5563', margin: 0 }}>
            <strong>提示：</strong>导出的配置文件包含所有 LLM 配置（包括 API 密钥）和插件设置。
            请妥善保管导出的文件，避免泄露敏感信息。
          </p>
        </div>
      </section>

    </div>
  );
}

// 渲染应用
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Options />);
}