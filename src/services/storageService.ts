import { PluginConfig, LLMConfig, DEFAULT_LLM_CONFIG, DEFAULT_CONFIG, ExtensionState, DEFAULT_EXTENSION_STATE } from '../types/config';
import { MindmapData } from '../types/mindmap';

const STORAGE_KEYS = {
  CONFIG: 'plugin_config',
  LLM_CONFIGS: 'llm_configs',  // 存储多个 LLM 配置
  MINDMAPS: 'mindmaps',
  LATEST_MINDMAP_ID: 'latest_mindmap_id',
  EXTENSION_STATE: 'extension_state'  // 扩展运行时状态
};

export class StorageService {
  /**
   * 获取配置
   */
  static async getConfig(): Promise<PluginConfig | null> {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.CONFIG);
    const config = result[STORAGE_KEYS.CONFIG];
    if (!config) return null;

    // 兼容性处理：确保所有新字段都有默认值
    return {
      ...config,
      selectedLLMConfigId: config.selectedLLMConfigId || 'default',
      llm: {
        ...config.llm,
        timeout: config.llm.timeout || 60
      },
      settings: {
        ...config.settings,
        enableCache: config.settings.enableCache !== undefined ? config.settings.enableCache : true
      },
      exclusionKeywords: config.exclusionKeywords || []
    };
  }

  /**
   * 保存配置
   */
  static async saveConfig(config: PluginConfig): Promise<void> {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.CONFIG]: config
    });
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
    
    if (configs.length === 0) {
      // 如果没有配置，检查是否有旧版本的配置需要迁移
      const pluginConfig = await this.getConfig();
      if (pluginConfig && pluginConfig.llm.apiKey) {
        // 迁移旧配置
        const migratedConfig: LLMConfig = {
          id: 'migrated_default',
          name: `${pluginConfig.llm.provider === 'openai' ? 'OpenAI' : pluginConfig.llm.provider === 'gemini' ? 'Gemini' : '自定义'} (已迁移)`,
          provider: pluginConfig.llm.provider,
          apiUrl: pluginConfig.llm.apiUrl,
          apiKey: pluginConfig.llm.apiKey,
          model: pluginConfig.llm.model,
          timeout: pluginConfig.llm.timeout || 60,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        
        // 直接保存到存储，避免递归
        await chrome.storage.sync.set({
          [STORAGE_KEYS.LLM_CONFIGS]: [migratedConfig]
        });
        
        // 更新选中的配置 ID
        await this.saveConfig({
          ...pluginConfig,
          selectedLLMConfigId: migratedConfig.id,
        });
        
        return [migratedConfig];
      }
      
      // 返回默认配置
      return [DEFAULT_LLM_CONFIG];
    }
    
    return configs;
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
    const selected = configs.find(c => c.id === selectedId);
    
    // 如果找不到选中的配置，返回第一个配置
    return selected || configs[0] || null;
  }

  /**
   * 保存单个 LLM 配置
   */
  static async saveLLMConfig(config: LLMConfig): Promise<void> {
    console.log('[StorageService] saveLLMConfig: 开始保存', config);
    
    // 使用 getLLMConfigsRaw 避免递归
    let configs = await this.getLLMConfigsRaw();
    
    // 如果没有配置，初始化为空数组
    if (!configs || configs.length === 0) {
      configs = [];
    }
    
    console.log('[StorageService] saveLLMConfig: 当前配置列表', configs);
    
    // 检查是否已存在
    const existingIndex = configs.findIndex(c => c.id === config.id);
    console.log('[StorageService] saveLLMConfig: existingIndex =', existingIndex);
    
    if (existingIndex >= 0) {
      // 更新现有配置
      configs[existingIndex] = {
        ...config,
        updatedAt: Date.now(),
      };
      console.log('[StorageService] saveLLMConfig: 更新现有配置');
    } else {
      // 添加新配置
      configs.push({
        ...config,
        updatedAt: Date.now(),
      });
      console.log('[StorageService] saveLLMConfig: 添加新配置');
    }

    console.log('[StorageService] saveLLMConfig: 准备保存的配置列表', configs);
    
    await chrome.storage.sync.set({
      [STORAGE_KEYS.LLM_CONFIGS]: configs
    });
    
    console.log('[StorageService] saveLLMConfig: 保存完成');
  }

  /**
   * 删除 LLM 配置
   */
  static async deleteLLMConfig(id: string): Promise<boolean> {
    const configs = await this.getLLMConfigs();
    
    // 不允许删除最后一个配置
    if (configs.length <= 1) {
      return false;
    }
    
    const filtered = configs.filter(c => c.id !== id);
    
    await chrome.storage.sync.set({
      [STORAGE_KEYS.LLM_CONFIGS]: filtered
    });

    // 如果删除的是当前选中的配置，自动选择第一个
    const pluginConfig = await this.getConfig();
    if (pluginConfig && pluginConfig.selectedLLMConfigId === id) {
      await this.saveConfig({
        ...pluginConfig,
        selectedLLMConfigId: filtered[0].id,
      });
    }
    
    return true;
  }

  /**
   * 设置当前选中的 LLM 配置
   */
  static async setSelectedLLMConfig(id: string): Promise<void> {
    let pluginConfig = await this.getConfig();
    
    // 如果配置不存在，使用默认配置
    if (!pluginConfig) {
      pluginConfig = { ...DEFAULT_CONFIG };
    }
    
    // 同时更新 llm 字段以保持兼容性
    const selectedConfig = await this.getLLMConfigById(id);
    if (selectedConfig) {
      await this.saveConfig({
        ...pluginConfig,
        selectedLLMConfigId: id,
        llm: {
          provider: selectedConfig.provider,
          apiUrl: selectedConfig.apiUrl,
          apiKey: selectedConfig.apiKey,
          model: selectedConfig.model,
          timeout: selectedConfig.timeout,
        },
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
    
    // 检查是否已存在
    const existingIndex = mindmaps.findIndex(m => m.id === mindmap.id);
    if (existingIndex >= 0) {
      mindmaps[existingIndex] = mindmap;
    } else {
      mindmaps.unshift(mindmap);
    }

    // 限制存储数量（最多保存50个）
    if (mindmaps.length > 50) {
      mindmaps.splice(50);
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.MINDMAPS]: mindmaps,
      [STORAGE_KEYS.LATEST_MINDMAP_ID]: mindmap.id
    });
  }

  /**
   * 获取最新的思维导图
   */
  static async getLatestMindmap(): Promise<MindmapData | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LATEST_MINDMAP_ID);
    const latestId = result[STORAGE_KEYS.LATEST_MINDMAP_ID];
    
    if (!latestId) {
      return null;
    }

    const mindmaps = await this.getMindmaps();
    return mindmaps.find(m => m.id === latestId) || null;
  }

  /**
   * 根据ID获取思维导图
   */
  static async getMindmapById(id: string): Promise<MindmapData | null> {
    const mindmaps = await this.getMindmaps();
    return mindmaps.find(m => m.id === id) || null;
  }

  /**
   * 根据视频URL获取最新的思维导图
   */
  static async getLatestMindmapByUrl(videoUrl: string): Promise<MindmapData | null> {
    console.log('[StorageService] getLatestMindmapByUrl 被调用, URL:', videoUrl);
    
    const mindmaps = await this.getMindmaps();
    console.log('[StorageService] 存储的思维导图数量:', mindmaps.length);
    
    if (mindmaps.length > 0) {
      console.log('[StorageService] 存储的思维导图列表:', mindmaps.map(m => ({
        id: m.id,
        videoTitle: m.videoTitle,
        videoUrl: m.videoUrl
      })));
    }
    
    // 提取视频ID（从URL中获取 /video/BVxxx 或 /video/avxxx）
    const extractVideoId = (url: string): string | null => {
      try {
        const urlObj = new URL(url);
        const match = urlObj.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
        return match ? match[1] : null;
      } catch {
        return null;
      }
    };

    const currentVideoId = extractVideoId(videoUrl);
    console.log('[StorageService] 提取的视频ID:', currentVideoId);
    
    // 找到匹配URL的最新思维导图
    const matching = mindmaps.filter(m => {
      if (!currentVideoId) return m.videoUrl === videoUrl;
      const storedVideoId = extractVideoId(m.videoUrl);
      return storedVideoId === currentVideoId;
    });
    
    console.log('[StorageService] 匹配的思维导图数量:', matching.length);
    
    return matching.length > 0 ? matching[0] : null;
  }

  /**
   * 删除思维导图
   */
  static async deleteMindmap(id: string): Promise<void> {
    const mindmaps = await this.getMindmaps();
    const filtered = mindmaps.filter(m => m.id !== id);
    
    await chrome.storage.local.set({
      [STORAGE_KEYS.MINDMAPS]: filtered
    });
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
   * 获取扩展状态
   */
  static async getExtensionState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.EXTENSION_STATE);
    return result[STORAGE_KEYS.EXTENSION_STATE] || DEFAULT_EXTENSION_STATE;
  }

  /**
   * 保存扩展状态
   */
  static async saveExtensionState(state: ExtensionState): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEYS.EXTENSION_STATE]: state
    });
  }

  /**
   * 获取暂停状态
   */
  static async isPaused(): Promise<boolean> {
    const state = await this.getExtensionState();
    return state.isPaused;
  }

  /**
   * 设置暂停状态
   */
  static async setPaused(isPaused: boolean): Promise<void> {
    const state = await this.getExtensionState();
    await this.saveExtensionState({
      ...state,
      isPaused
    });
  }

  /**
   * 切换暂停状态
   */
  static async togglePaused(): Promise<boolean> {
    const state = await this.getExtensionState();
    const newPausedState = !state.isPaused;
    await this.saveExtensionState({
      ...state,
      isPaused: newPausedState
    });
    return newPausedState;
  }

  /**
   * 导出配置数据
   * 导出所有配置，包括插件配置和 LLM 配置列表
   */
  static async exportConfig(): Promise<{
    version: string;
    exportDate: string;
    pluginConfig: PluginConfig | null;
    llmConfigs: LLMConfig[];
  }> {
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
   * 导入配置数据
   * @param data 导入的配置数据
   * @param options 导入选项
   */
  static async importConfig(
    data: {
      version?: string;
      pluginConfig?: PluginConfig | null;
      llmConfigs?: LLMConfig[];
    },
    options: {
      overwriteExisting?: boolean;  // 是否覆盖现有配置
      mergeLLMConfigs?: boolean;    // 是否合并 LLM 配置（而非替换）
    } = {}
  ): Promise<{
    success: boolean;
    message: string;
    importedLLMConfigsCount: number;
  }> {
    const { overwriteExisting = true, mergeLLMConfigs = false } = options;
    
    try {
      let importedLLMConfigsCount = 0;
      
      // 导入插件配置
      if (data.pluginConfig && overwriteExisting) {
        await this.saveConfig(data.pluginConfig);
      }
      
      // 导入 LLM 配置
      if (data.llmConfigs && data.llmConfigs.length > 0) {
        if (mergeLLMConfigs) {
          // 合并模式：添加不存在的配置
          const existingConfigs = await this.getLLMConfigsRaw();
          const existingIds = new Set(existingConfigs.map(c => c.id));
          
          for (const config of data.llmConfigs) {
            if (!existingIds.has(config.id)) {
              // 生成新 ID 避免冲突
              const newConfig = {
                ...config,
                id: `imported_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                name: config.name + ' (导入)',
                updatedAt: Date.now()
              };
              existingConfigs.push(newConfig);
              importedLLMConfigsCount++;
            }
          }
          
          await chrome.storage.sync.set({
            [STORAGE_KEYS.LLM_CONFIGS]: existingConfigs
          });
        } else {
          // 替换模式：直接替换所有配置
          const configsToImport = data.llmConfigs.map(config => ({
            ...config,
            updatedAt: Date.now()
          }));
          
          await chrome.storage.sync.set({
            [STORAGE_KEYS.LLM_CONFIGS]: configsToImport
          });
          
          importedLLMConfigsCount = configsToImport.length;
          
          // 确保选中的配置 ID 有效
          const pluginConfig = await this.getConfig();
          if (pluginConfig) {
            const selectedExists = configsToImport.some(c => c.id === pluginConfig.selectedLLMConfigId);
            if (!selectedExists && configsToImport.length > 0) {
              await this.saveConfig({
                ...pluginConfig,
                selectedLLMConfigId: configsToImport[0].id
              });
            }
          }
        }
      }
      
      return {
        success: true,
        message: '配置导入成功',
        importedLLMConfigsCount
      };
    } catch (error) {
      console.error('[StorageService] 导入配置失败:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '导入失败',
        importedLLMConfigsCount: 0
      };
    }
  }

  /**
   * 下载配置文件
   * 使用浏览器下载 API 将配置保存为 JSON 文件
   */
  static async downloadConfigFile(): Promise<void> {
    const exportData = await this.exportConfig();
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const filename = `auto_mindmap_config_${new Date().toISOString().slice(0, 10)}.json`;
    
    // 创建下载链接并触发下载
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
   * @param file 要导入的文件
   */
  static async readConfigFromFile(file: File): Promise<{
    version?: string;
    pluginConfig?: PluginConfig | null;
    llmConfigs?: LLMConfig[];
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const data = JSON.parse(content);
          resolve(data);
        } catch (error) {
          reject(new Error('无法解析配置文件，请确保文件格式正确'));
        }
      };
      
      reader.onerror = () => {
        reject(new Error('读取文件失败'));
      };
      
      reader.readAsText(file);
    });
  }
}