import { useCallback, useEffect, useRef, useState } from 'react';
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
import { StatsSection } from './options/StatsSection';
import { StorageSection } from './options/StorageSection';

import './options/Options.css';

export default function Options() {
  const tabs = [
    { id: 'content', label: '内容生成', icon: '📝' },
    { id: 'llm', label: '大模型配置', icon: '🤖' },
    { id: 'asr', label: '语音识别', icon: '🎤' },
    { id: 'system', label: '高级设置', icon: '⚙️' },
    { id: 'stats', label: '数据统计', icon: '📊' },
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
  const configLoadedRef = useRef(false);
  const skipEditingSaveRef = useRef(true);
  const pendingEditingSaveRef = useRef<{
    config: LLMConfig;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(() => {
    void loadConfig();
    void loadLLMConfigs();
  }, []);

  // === 数据加载 ===
  const loadConfig = async () => {
    const savedConfig = await StorageService.getConfig();
    if (savedConfig) {
      setConfig(savedConfig);
    }
    configLoadedRef.current = true;
  };

  const loadLLMConfigs = async () => {
    const configs = await StorageService.getLLMConfigs();
    setLLMConfigs(configs);

    // 初始化编辑状态
    const pluginConfig = await StorageService.getConfig();
    const selectedId = pluginConfig?.selectedLLMConfigId || 'default';
    const selected = configs.find(c => c.id === selectedId) || configs[0];
    if (selected && !editingConfigId) {
      setEditingConfigId(selected.id);
      setEditingConfig(selected);
      // 初始填充不应触发一次无意义的自动保存
      skipEditingSaveRef.current = true;
    } else if (editingConfigId) {
      const current = configs.find(item => item.id === editingConfigId);
      if (current) {
        setEditingConfig(current);
        skipEditingSaveRef.current = true;
      }
    }
  };

  const markSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  // === 自动保存逻辑 ===
  // 1. 自动保存基础配置 (PluginConfig)
  useEffect(() => {
    if (!configLoadedRef.current) return;
    const timer = setTimeout(async () => {
      const savedConfig = await StorageService.getConfig();
      // 深度对比，避免初始加载或无意义重复保存
      if (savedConfig && JSON.stringify(savedConfig) !== JSON.stringify(config)) {
        await StorageService.saveConfig(config);
        markSaved();
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [config]);

  // 2. 自动保存正在编辑的 LLM 配置
  // 注意：切换配置时不能在 cleanup 里 clearTimeout，否则 800ms 内的编辑会丢；
  // 由 flushEditingSave 在切换/删除/卸载前主动落盘。
  useEffect(() => {
    if (!editingConfig || isAddingNew) return;
    if (skipEditingSaveRef.current) {
      skipEditingSaveRef.current = false;
      return;
    }

    if (pendingEditingSaveRef.current) {
      clearTimeout(pendingEditingSaveRef.current.timer);
    }
    const timer = setTimeout(() => {
      pendingEditingSaveRef.current = null;
      void StorageService.saveLLMConfig(editingConfig).then(() => {
        setLLMConfigs(prev => prev.map(c => c.id === editingConfig.id ? editingConfig : c));
        markSaved();
      });
    }, 700);
    pendingEditingSaveRef.current = { config: editingConfig, timer };
  }, [editingConfig, isAddingNew]);

  const flushEditingSave = useCallback(async () => {
    const pending = pendingEditingSaveRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingEditingSaveRef.current = null;
    await StorageService.saveLLMConfig(pending.config);
    setLLMConfigs(prev => prev.map(c => c.id === pending.config.id ? pending.config : c));
    markSaved();
  }, []);

  useEffect(() => {
    return () => {
      // 页面卸载前把未落盘的编辑写掉（fire-and-forget，浏览器通常仍会完成）
      void flushEditingSave();
    };
  }, [flushEditingSave]);

  const reloadAll = async () => {
    await loadConfig();
    await loadLLMConfigs();
  };

  // === LLM 配置操作 ===
  const handleEditConfig = async (id: string) => {
    await flushEditingSave();
    setEditingConfigId(id);
    const selected = llmConfigs.find(c => c.id === id);
    if (selected) {
      setEditingConfig(selected);
      setIsAddingNew(false);
    }
  };

  const handleAddNewConfig = async () => {
    await flushEditingSave();
    const newConfig = createDefaultLLMConfig('custom');
    newConfig.name = `新配置 ${llmConfigs.length + 1}`;

    // 立即保存到存储，实现“即刻生效”
    await StorageService.saveLLMConfig(newConfig);
    const configs = await StorageService.getLLMConfigs();
    setLLMConfigs(configs);

    setEditingConfig(newConfig);
    setEditingConfigId(newConfig.id);
    setIsAddingNew(false);
    skipEditingSaveRef.current = true;
  };



  const handleDeleteConfig = async (id: string) => {
    if (llmConfigs.length <= 1) {
      alert('至少需要保留一个配置！');
      return;
    }
    if (!confirm('确定要删除这个配置吗？')) return;

    await flushEditingSave();
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



  const updateEditingConfig = (updates: Partial<LLMConfig>) => {
    if (editingConfig) {
      setEditingConfig({ ...editingConfig, ...updates });
    }
  };

  // === 全局操作 ===
  const handleSave = async () => {
    await flushEditingSave();
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
              key={editingConfig?.id || 'none'}
              config={config}
              llmConfigs={llmConfigs}
              editingConfigId={editingConfigId}
              editingConfig={editingConfig}
              isAddingNew={isAddingNew}
              saved={saved}
              onEditConfig={handleEditConfig}
              onDeleteConfig={handleDeleteConfig}
              onAddNewConfig={handleAddNewConfig}
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

              <StorageSection />

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

          {activeTab === 'stats' && (
            <StatsSection llmConfigs={llmConfigs} />
          )}
        </div>

        {/* 移除底部固定保存按钮，改为全自动保存 */}
      </main>
    </div>
  );
}