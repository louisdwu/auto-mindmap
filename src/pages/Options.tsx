import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginConfig, DEFAULT_CONFIG, LLMConfig, createDefaultLLMConfig } from '../types/config';
import { StorageService } from '../services/storageService';

// 子组件
import { LLMConfigSection } from './options/LLMConfigSection';
import { PromptSection } from './options/PromptSection';
import { ExclusionSection } from './options/ExclusionSection';
import { CacheSection } from './options/CacheSection';
import { ActionButtons } from './options/ActionButtons';
import { ImportExportSection } from './options/ImportExportSection';

import './options/Options.css';

function Options() {
  const [config, setConfig] = useState<PluginConfig>(DEFAULT_CONFIG);
  const [llmConfigs, setLLMConfigs] = useState<LLMConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
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
      setSelectedConfigId(savedConfig.selectedLLMConfigId || 'default');
    }
  };

  const loadLLMConfigs = async () => {
    const configs = await StorageService.getLLMConfigs();
    setLLMConfigs(configs);

    const pluginConfig = await StorageService.getConfig();
    const selectedId = pluginConfig?.selectedLLMConfigId || 'default';
    const selected = configs.find(c => c.id === selectedId) || configs[0];
    if (selected) {
      setEditingConfig(selected);
      setSelectedConfigId(selected.id);
    }
  };

  const reloadAll = async () => {
    await loadConfig();
    await loadLLMConfigs();
  };

  // === LLM 配置操作 ===
  const handleSelectConfig = async (id: string) => {
    setSelectedConfigId(id);
    const selected = llmConfigs.find(c => c.id === id);
    if (selected) {
      setEditingConfig(selected);
      await StorageService.setSelectedLLMConfig(id);
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
    if (!editingConfig) return;

    try {
      await StorageService.saveLLMConfig(editingConfig);

      if (isAddingNew) {
        await StorageService.setSelectedLLMConfig(editingConfig.id);
        setSelectedConfigId(editingConfig.id);
        setIsAddingNew(false);
      } else if (editingConfig.id === selectedConfigId) {
        await StorageService.setSelectedLLMConfig(editingConfig.id);
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
    const selected = llmConfigs.find(c => c.id === selectedConfigId);
    if (selected) setEditingConfig(selected);
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

  return (
    <div className="options-page">
      <h1>插件配置</h1>

      <LLMConfigSection
        llmConfigs={llmConfigs}
        selectedConfigId={selectedConfigId}
        editingConfig={editingConfig}
        isAddingNew={isAddingNew}
        saved={saved}
        onSelectConfig={handleSelectConfig}
        onDeleteConfig={handleDeleteConfig}
        onAddNewConfig={handleAddNewConfig}
        onCancelAdd={handleCancelAdd}
        onSaveCurrentConfig={handleSaveCurrentConfig}
        onUpdateEditingConfig={updateEditingConfig}
      />

      <PromptSection config={config} onConfigChange={setConfig} />

      <ExclusionSection config={config} onConfigChange={setConfig} />

      <CacheSection config={config} onConfigChange={setConfig} />

      <ActionButtons
        saved={saved}
        onSave={handleSave}
        onReset={handleReset}
        onClearCache={handleClearCache}
      />

      <ImportExportSection
        importStatus={importStatus}
        onReload={reloadAll}
        onSetImportStatus={setImportStatus}
      />
    </div>
  );
}

// 渲染应用
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Options />);
}