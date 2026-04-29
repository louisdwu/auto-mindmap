import { PluginConfig, LLMConfig, DEFAULT_LLM_CONFIG, ExtensionState, DEFAULT_EXTENSION_STATE } from '../types/config';
import { MindmapData } from '../types/mindmap';
import { StorageMigration } from './storage/migration';
import { VideoUtils } from '../utils/videoUtils';

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
    const normalized = StorageMigration.normalizeConfig(config);
    return normalized;
  }

  /**
   * 保存配置
   */
  static async saveConfig(config: PluginConfig): Promise<void> {
    const { llm, ...cleanConfig } = config as any;
    await chrome.storage.sync.set({ [STORAGE_KEYS.CONFIG]: cleanConfig });
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
        selectedLLMConfigId: id
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
    
    const currentVideoId = VideoUtils.extractVideoId(videoUrl);
    const matching = mindmaps.filter(m => {
      if (!currentVideoId) return m.videoUrl === videoUrl;
      const storedVideoId = VideoUtils.extractVideoId(m.videoUrl);
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
    
    // 方案校验 (LD 风格：轻量化手动校验)
    if (!data || typeof data !== 'object') {
      return { success: false, message: '无效的数据格式' };
    }

    try {
      // 1. 校验 LLM 配置
      if (data.llmConfigs && Array.isArray(data.llmConfigs)) {
        for (const config of data.llmConfigs) {
          if (!config.id || !config.provider || !config.apiUrl) {
            return { success: false, message: 'LLM 配置结构非法' };
          }
        }
        await chrome.storage.sync.set({ [STORAGE_KEYS.LLM_CONFIGS]: data.llmConfigs });
      }

      // 2. 校验插件基础配置
      if (data.pluginConfig && typeof data.pluginConfig === 'object') {
        if (overwriteExisting) {
          await this.saveConfig(data.pluginConfig);
        }
      }

      return { success: true, message: '数据验证通过并导入完成' };
    } catch (error) {
      console.error('[StorageService] Import failed:', error);
      return { success: false, message: '导入过程中发生未知错误' };
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

  // Phase 1 缓存相关
  static async getPhase1Cache(videoId: string): Promise<string | null> {
    const key = 'phase1_cache_' + videoId;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  }

  static async savePhase1Cache(videoId: string, text: string): Promise<void> {
    const key = 'phase1_cache_' + videoId;
    await chrome.storage.local.set({ [key]: text });
  }

  static async deletePhase1Cache(videoId: string): Promise<void> {
    const key = 'phase1_cache_' + videoId;
    await chrome.storage.local.remove(key);
  }
}