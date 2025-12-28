import { PluginConfig, LLMConfig, DEFAULT_LLM_CONFIG, DEFAULT_CONFIG } from '../types/config';
import { MindmapData } from '../types/mindmap';

const STORAGE_KEYS = {
  CONFIG: 'plugin_config',
  LLM_CONFIGS: 'llm_configs',  // 存储多个 LLM 配置
  MINDMAPS: 'mindmaps',
  LATEST_MINDMAP_ID: 'latest_mindmap_id'
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
}