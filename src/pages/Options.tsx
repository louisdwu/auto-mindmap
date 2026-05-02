import { useState, useEffect } from 'react';
import { PluginConfig, DEFAULT_CONFIG, LLMConfig, createDefaultLLMConfig } from '../types/config';
import { StorageService } from '../services/storageService';

// 子组件
import { LLMConfigSection } from './options/LLMConfigSection';
import { PromptSection } from './options/PromptSection';
import { ExclusionSection } from './options/ExclusionSection';
import { CacheSection } from './options/CacheSection';
import { ActionButtons } from './options/ActionButtons';
import { ImportExportSection } from './options/ImportExportSection';
import { AsrSection } from './options/AsrSection';
import { SystemSettingsSection } from './options/SystemSettingsSection';
import { LogSection } from './options/LogSection';

import './options/Options.css';

export default function Options() {
  const tabs = [
    { id: 'content', label: '内容生成', icon: '📝' },
    { id: 'llm', label: '大模型配置', icon: '🤖' },
    { id: 'asr', label: '语音识别', icon: '🎤' },
    { id: 'system', label: '高级设置', icon: '⚙️' },
    { id: 'logs', label: '运行日志', icon: '📋' },
  ];

  const [activeTab, setActiveTab] = useState('content');
  const [config, setConfig] = useState<PluginConfig>(DEFAULT_CONFIG);
  const [llmConfigs, setLLMConfigs] = useState<LLMConfig[]>([]);
  const [editingConfigId, setEditingConfigId] = useState<string>(''); // 当前正在编辑的配置 ID
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadConfig();
    loadLLMConfigs();
  }, []);

  // === 数据加载 ===
  const loadConfig = async () => {
    const savedConfig = await StorageService.getConfig();
    if (savedConfig) {
      setConfig(savedConfig);
    }
  };

  const loadLLMConfigs = async () => {
    const configs = await StorageService.getLLMConfigs();
    setLLMConfigs(configs);

    // 初始化编辑状态
    const pluginConfig = await StorageService.getConfig();
    const selectedId = pluginConfig?.selectedLLMConfigId || 'default';
    const selected = configs.find(c => c.id === selectedId) || configs[0];
    if (selected) {
      if (!editingConfigId) {
        setEditingConfigId(selected.id);
        setEditingConfig(selected);
      }
    }
  };

  const reloadAll = async () => {
    await loadConfig();
    await loadLLMConfigs();
  };

  // === LLM 配置操作 ===
  const handleEditConfig = (id: string) => {
    setEditingConfigId(id);
    const selected = llmConfigs.find(c => c.id === id);
    if (selected) {
      setEditingConfig(selected);
      setIsAddingNew(false);
    }
  };

  const handleAddNewConfig = () => {
    const newConfig = createDefaultLLMConfig('custom');
    newConfig.name = `新配置 ${llmConfigs.length + 1}`;
    setEditingConfig(newConfig);
    setEditingConfigId(newConfig.id);
    setIsAddingNew(true);
  };

  const handleSaveCurrentConfig = async () => {
    if (!editingConfig) return;

    try {
      await StorageService.saveLLMConfig(editingConfig);

      if (isAddingNew) {
        setIsAddingNew(false);
      }

      await reloadAll();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('[Options] 保存配置失败:', error);
      alert('保存失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeleteConfig = async (id: string) => {
    if (llmConfigs.length <= 1) {
      alert('至少需要保留一个配置！');
      return;
    }
    if (!confirm('确定要删除这个配置吗？')) return;

    const success = await StorageService.deleteLLMConfig(id);
    if (success) {
      await reloadAll();
      if (id === editingConfigId) {
        const configs = await StorageService.getLLMConfigs();
        if (configs.length > 0) {
          setEditingConfig(configs[0]);
          setEditingConfigId(configs[0].id);
        }
      }
    }
  };

  const handleCancelAdd = () => {
    setIsAddingNew(false);
    const selected = llmConfigs.find(c => c.id === editingConfigId) || llmConfigs[0];
    if (selected) {
      setEditingConfig(selected);
      setEditingConfigId(selected.id);
    }
  };

  const updateEditingConfig = (updates: Partial<LLMConfig>) => {
    if (editingConfig) {
      setEditingConfig({ ...editingConfig, ...updates });
    }
  };

  // === 全局操作 ===
  const handleSave = async () => {
    await StorageService.saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = async () => {
    if (!confirm('确定要重置所有设置为默认值吗？此操作不可逆。')) return;
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

  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest 
    ? chrome.runtime.getManifest().version 
    : '1.0.0';

  return (
    <div className="options-container">
      <aside className="options-sidebar">
        <div className="sidebar-header">
          <img src="/icons/icon48.png" alt="logo" className="sidebar-logo" />
          <h2>AutoMindmap</h2>
        </div>
        <nav className="sidebar-nav">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-icon">{tab.icon}</span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="footer-info">
            <span className="version-tag">v{version}</span>
            <span className="footer-sep">·</span>
            <span>开源插件</span>
          </div>
        </div>
      </aside>

      <main className="options-content">
        <div className="content-body">
          {activeTab === 'llm' && (
            <LLMConfigSection
              llmConfigs={llmConfigs}
              editingConfigId={editingConfigId}
              editingConfig={editingConfig}
              isAddingNew={isAddingNew}
              saved={saved}
              onEditConfig={handleEditConfig}
              onDeleteConfig={handleDeleteConfig}
              onAddNewConfig={handleAddNewConfig}
              onCancelAdd={handleCancelAdd}
              onSaveCurrentConfig={handleSaveCurrentConfig}
              onUpdateEditingConfig={updateEditingConfig}
            />
          )}

          {activeTab === 'content' && (
            <PromptSection config={config} llmConfigs={llmConfigs} onConfigChange={setConfig} />
          )}

          {activeTab === 'asr' && (
            <AsrSection config={config} onConfigChange={setConfig} />
          )}


          {activeTab === 'system' && (
            <>
              <ExclusionSection config={config} onConfigChange={setConfig} />

              <div className="section-divider" />

              <SystemSettingsSection config={config} onConfigChange={setConfig} />

              <div className="section-divider" />
              
              <CacheSection config={config} onConfigChange={setConfig} />
              
              <div className="section-divider" />
              
              <ImportExportSection
                importStatus={importStatus}
                onReload={reloadAll}
                onSetImportStatus={setImportStatus}
              />

              <div className="section-divider" />
              
              <div className="advanced-actions">
                <h3>全局危险操作</h3>
                <ActionButtons
                  saved={saved}
                  onSave={handleSave}
                  onReset={handleReset}
                  onClearCache={handleClearCache}
                />
              </div>
            </>
          )}

          {activeTab === 'logs' && (
            <LogSection config={config} />
          )}
        </div>

        {/* 底部自动保存提示或全局保存按钮可以在这里添加 */}
        {activeTab !== 'llm' && activeTab !== 'system' && activeTab !== 'asr' && (
          <div className="fixed-footer">
            <button className="btn--primary" onClick={handleSave}>
              {saved ? '✓ 已保存' : '保存设置'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
