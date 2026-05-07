import { PluginConfig, LLMConfig, DEFAULT_CONFIG } from '../../types/config';

export class StorageMigration {
  /**
   * 规范化 PluginConfig，确保所有新字段都有默认值
   */
  static normalizeConfig(config: any): PluginConfig {
    if (!config) return DEFAULT_CONFIG;

    return {
      ...DEFAULT_CONFIG,
      ...config,
      selectedLLMConfigId: config.selectedLLMConfigId || DEFAULT_CONFIG.selectedLLMConfigId,
      prompt: {
        ...DEFAULT_CONFIG.prompt,
        ...config.prompt,
        systemPrompt: config.prompt?.systemPrompt || DEFAULT_CONFIG.prompt.systemPrompt,
        template: config.prompt?.template || DEFAULT_CONFIG.prompt.template,
        reflectionPrompt: config.prompt?.reflectionPrompt || DEFAULT_CONFIG.prompt.reflectionPrompt
      },
      settings: {
        ...DEFAULT_CONFIG.settings,
        ...config.settings,
        enableCache: config.settings?.enableCache !== undefined ? config.settings.enableCache : true,
        soundNotificationVolume: config.settings?.soundNotificationVolume !== undefined ? config.settings.soundNotificationVolume : 0.8
      },
      exclusionKeywords: config.exclusionKeywords || []
    };
  }

  /**
   * 将旧版单一 LLM 配置迁移到新版 LLMConfig 列表
   */
  static migrateToLLMConfigs(pluginConfig: any): LLMConfig | null {
    if (pluginConfig && pluginConfig.llm && pluginConfig.llm.apiKey) {
      const providerName = pluginConfig.llm.provider === 'openai' ? 'OpenAI' : 
                         pluginConfig.llm.provider === 'gemini' ? 'Gemini' : '自定义';
      
      return {
        id: 'migrated_default',
        name: `${providerName} (已迁移)`,
        provider: pluginConfig.llm.provider,
        apiUrl: pluginConfig.llm.apiUrl,
        apiKey: pluginConfig.llm.apiKey,
        model: pluginConfig.llm.model,
        timeout: pluginConfig.llm.timeout || 60,
        maxTokens: pluginConfig.llm.maxTokens || 4096,
        temperature: pluginConfig.llm.temperature ?? 0.7,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
    return null;
  }
}
