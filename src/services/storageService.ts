import { PluginConfig, LLMConfig, DEFAULT_LLM_CONFIG, ExtensionState, DEFAULT_EXTENSION_STATE } from '../types/config';
import { MindmapData } from '../types/mindmap';
import { StorageMigration } from './storage/migration';

const STORAGE_KEYS = {
  CONFIG: 'plugin_config',
  LLM_CONFIGS: 'llm_configs',
  MINDMAPS: 'mindmaps',
  LATEST_MINDMAP_ID: 'latest_mindmap_id',
  EXTENSION_STATE: 'extension_state',
  ASR_CACHE_PREFIX: 'asr_cache_'
};

export class StorageService {
  /**
   * 获取配置
   */
  static async getConfig(): Promise<PluginConfig | null> {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.CONFIG);
    const config = result[STORAGE_KEYS.CONFIG];
    if (!config) return null;
    return StorageMigration.normalizeConfig(config);
  }

  /**
   * 保存配置
   */
  static async saveConfig(config: PluginConfig): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEYS.CONFIG]: config });
  }

  /**
   * 获取所有 LLM 配置（内部方法，不触发迁移）
   */
  private static async getLLMConfigsRaw(): Promise<LLMConfig[]> {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.LLM_CONFIGS);
    return result[STORAGE_KEYS.LLM_CONFIGS] || [];
  }

  /**
   * 获取所有 LLM 配置
   */
  static async getLLMConfigs(): Promise<LLMConfig[]> {
    const configs = await this.getLLMConfigsRaw();
    if (configs.length > 0) return configs;

    // 触发迁移逻辑
    const pluginConfig = await this.getConfig();
    if (pluginConfig) {
      const migrated = StorageMigration.migrateToLLMConfigs(pluginConfig);
      if (migrated) {
        await this.saveLLMConfig(migrated);
        await this.saveConfig({ ...pluginConfig, selectedLLMConfigId: migrated.id });
        return [migrated];
      }
    }
    return [DEFAULT_LLM_CONFIG];
  }

  /**
   * 根据 ID 获取 LLM 配置
   */
  static async getLLMConfigById(id: string): Promise<LLMConfig | null> {
    const configs = await this.getLLMConfigs();
    return configs.find(c => c.id === id) || null;
  }

  /**
   * 获取当前选中的 LLM 配置
   */
  static async getSelectedLLMConfig(): Promise<LLMConfig | null> {
    const pluginConfig = await this.getConfig();
    const selectedId = pluginConfig?.selectedLLMConfigId || 'default';
    const configs = await this.getLLMConfigs();
    return configs.find(c => c.id === selectedId) || configs[0] || null;
  }

  /**
   * 保存单个 LLM 配置
   */
  static async saveLLMConfig(config: LLMConfig): Promise<void> {
    let configs = await this.getLLMConfigsRaw();
    const existingIndex = configs.findIndex(c => c.id === config.id);
    if (existingIndex >= 0) {
      configs[existingIndex] = { ...config, updatedAt: Date.now() };
    } else {
      configs.push({ ...config, updatedAt: Date.now() });
    }
    await chrome.storage.sync.set({ [STORAGE_KEYS.LLM_CONFIGS]: configs });
  }

  /**
   * 删除 LLM 配置
   */
  static async deleteLLMConfig(id: string): Promise<boolean> {
    const configs = await this.getLLMConfigs();
    if (configs.length <= 1) return false;
    const filtered = configs.filter(c => c.id !== id);
    await chrome.storage.sync.set({ [STORAGE_KEYS.LLM_CONFIGS]: filtered });

    const pluginConfig = await this.getConfig();
    if (pluginConfig && pluginConfig.selectedLLMConfigId === id) {
      await this.setSelectedLLMConfig(filtered[0].id);
    }
    return true;
  }

  /**
   * 设置当前选中的 LLM 配置
   */
  static async setSelectedLLMConfig(id: string): Promise<void> {
    const pluginConfig = await this.getConfig();
    const selectedConfig = await this.getLLMConfigById(id);
    if (pluginConfig && selectedConfig) {
      await this.saveConfig({
        ...pluginConfig,
        selectedLLMConfigId: id,
        llm: { ...selectedConfig } // 保持向后兼容
      });
    }
  }

  /**
   * 获取所有思维导图
   */
  static async getMindmaps(): Promise<MindmapData[]> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MINDMAPS);
    return result[STORAGE_KEYS.MINDMAPS] || [];
  }

  /**
   * 保存思维导图
   */
  static async saveMindmap(mindmap: MindmapData): Promise<void> {
    const mindmaps = await this.getMindmaps();
    const existingIndex = mindmaps.findIndex(m => m.id === mindmap.id);
    if (existingIndex >= 0) {
      mindmaps[existingIndex] = mindmap;
    } else {
      mindmaps.unshift(mindmap);
    }
    if (mindmaps.length > 50) mindmaps.splice(50);
    await chrome.storage.local.set({
      [STORAGE_KEYS.MINDMAPS]: mindmaps,
      [STORAGE_KEYS.LATEST_MINDMAP_ID]: mindmap.id
    });
  }

  /**
   * 根据视频URL获取最新的思维导图
   */
  static async getLatestMindmapByUrl(videoUrl: string): Promise<MindmapData | null> {
    const mindmaps = await this.getMindmaps();
    
    const extractVideoId = (url: string): string | null => {
      try {
        if (!url) return null;
        const urlObj = new URL(url);
        const biliMatch = urlObj.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
        if (biliMatch) return biliMatch[1];
        if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
          const v = urlObj.searchParams.get('v');
          if (v) return v;
          const pathParts = urlObj.pathname.split('/').filter(Boolean);
          if (urlObj.hostname === 'youtu.be') return pathParts[0];
          if (pathParts[0] === 'embed') return pathParts[1];
        }
        return null;
      } catch {
        return null;
      }
    };

    const currentVideoId = extractVideoId(videoUrl);
    const matching = mindmaps.filter(m => {
      if (!currentVideoId) return m.videoUrl === videoUrl;
      const storedVideoId = extractVideoId(m.videoUrl);
      return storedVideoId === currentVideoId;
    });
    
    return matching.length > 0 ? matching[0] : null;
  }

  /**
   * 获取最新的思维导图
   */
  static async getLatestMindmap(): Promise<MindmapData | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LATEST_MINDMAP_ID);
    const latestId = result[STORAGE_KEYS.LATEST_MINDMAP_ID];
    if (!latestId) return null;
    const mindmaps = await this.getMindmaps();
    return mindmaps.find(m => m.id === latestId) || null;
  }

  /**
   * 状态管理相关 (保持简洁)
   */
  static async getExtensionState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.EXTENSION_STATE);
    return result[STORAGE_KEYS.EXTENSION_STATE] || DEFAULT_EXTENSION_STATE;
  }

  static async saveExtensionState(state: ExtensionState): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.EXTENSION_STATE]: state });
  }

  static async togglePaused(): Promise<boolean> {
    const state = await this.getExtensionState();
    const newPausedState = !state.isPaused;
    await this.saveExtensionState({ ...state, isPaused: newPausedState });
    return newPausedState;
  }

  /**
   * 获取暂停状态
   */
  static async isPaused(): Promise<boolean> {
    const state = await this.getExtensionState();
    return state.isPaused;
  }

  /**
   * 清空所有思维导图
   */
  static async clearMindmaps(): Promise<void> {
    await chrome.storage.local.remove([
      STORAGE_KEYS.MINDMAPS,
      STORAGE_KEYS.LATEST_MINDMAP_ID
    ]);
  }

  /**
   * 导出配置数据
   */
  static async exportConfig(): Promise<any> {
    const pluginConfig = await this.getConfig();
    const llmConfigs = await this.getLLMConfigs();
    return {
      version: '1.0',
      exportDate: new Date().toISOString(),
      pluginConfig,
      llmConfigs
    };
  }

  /**
   * 下载配置文件
   */
  static async downloadConfigFile(): Promise<void> {
    const exportData = await this.exportConfig();
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `auto_mindmap_config_${new Date().toISOString().slice(0, 10)}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 从文件读取配置
   */
  static async readConfigFromFile(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          resolve(JSON.parse(e.target?.result as string));
        } catch (error) {
          reject(new Error('无法解析配置文件'));
        }
      };
      reader.readAsText(file);
    });
  }

  /**
   * 导入配置数据
   */
  static async importConfig(data: any, options: any = {}): Promise<any> {
    const { overwriteExisting = true } = options;
    try {
      if (data.pluginConfig && overwriteExisting) {
        await this.saveConfig(data.pluginConfig);
      }
      if (data.llmConfigs && data.llmConfigs.length > 0) {
        await chrome.storage.sync.set({ [STORAGE_KEYS.LLM_CONFIGS]: data.llmConfigs });
      }
      return { success: true, message: '配置导入成功' };
    } catch (error) {
      return { success: false, message: '导入失败' };
    }
  }

  // ASR 缓存相关
  static async getAsrCache(videoId: string): Promise<string | null> {
    const key = STORAGE_KEYS.ASR_CACHE_PREFIX + videoId;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  }

  static async saveAsrCache(videoId: string, text: string): Promise<void> {
    const key = STORAGE_KEYS.ASR_CACHE_PREFIX + videoId;
    await chrome.storage.local.set({ [key]: text });
  }

  /**
   * 删除 ASR 缓存
   */
  static async deleteAsrCache(videoId: string): Promise<void> {
    const key = STORAGE_KEYS.ASR_CACHE_PREFIX + videoId;
    await chrome.storage.local.remove(key);
  }
}