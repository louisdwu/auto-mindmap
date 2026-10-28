import { PluginConfig, LLMConfig, DEFAULT_CONFIG, normalizeAsrLanguage, getProviderLabel, REFLECTION_PROMPT_MARKER } from '../../types/config';

export class StorageMigration {
  /**
   * 规范化 PluginConfig，确保所有新字段都有默认值
   */
  static normalizeConfig(config: any): PluginConfig {
    if (!config) return DEFAULT_CONFIG;

    const userSystemPrompt = config.prompt?.systemPrompt;
    const systemPrompt = (!userSystemPrompt || !userSystemPrompt.includes('时间戳'))
      ? DEFAULT_CONFIG.prompt.systemPrompt
      : userSystemPrompt;

    const userTemplate = config.prompt?.template;
    const template = (!userTemplate || !userTemplate.includes('时间戳'))
      ? DEFAULT_CONFIG.prompt.template
      : userTemplate;

    // 旧版反思 Prompt 把「是否优秀」交给模型自评（实测几乎恒为优秀），
    // 新版改为在初稿基础上补漏纠错，因此缺少新版标记的旧文案一律替换。
    const userReflectionPrompt = config.prompt?.reflectionPrompt;
    const reflectionPrompt = (
      typeof userReflectionPrompt === 'string'
      && userReflectionPrompt.includes('时间戳')
      && userReflectionPrompt.includes(REFLECTION_PROMPT_MARKER)
    )
      ? userReflectionPrompt
      : DEFAULT_CONFIG.prompt.reflectionPrompt;

    return {
      ...DEFAULT_CONFIG,
      ...config,
      selectedLLMConfigId: config.selectedLLMConfigId || DEFAULT_CONFIG.selectedLLMConfigId,
      prompt: {
        ...DEFAULT_CONFIG.prompt,
        ...config.prompt,
        systemPrompt,
        template,
        reflectionPrompt
      },
      settings: {
        ...DEFAULT_CONFIG.settings,
        ...config.settings,
        enableCache: config.settings?.enableCache !== undefined ? config.settings.enableCache : true,
        soundNotificationVolume: config.settings?.soundNotificationVolume !== undefined ? config.settings.soundNotificationVolume : 0.8,
        // 旧版本用 cacheDirectory 非空表示「保存到下载目录」；新版本改用布尔字段。
        saveToLocalFile: typeof config.settings?.saveToLocalFile === 'boolean'
          ? config.settings.saveToLocalFile
          : !!(config.settings?.cacheDirectory && String(config.settings.cacheDirectory).trim()),
        enableChunking: config.settings?.enableChunking !== false,
        // 旧版本没有这个字段，且此前的实现是「写死中文」——统一迁移成自动检测，
        // 否则老配置会继续把英文视频识别成中文译文。
        asrLanguage: normalizeAsrLanguage(config.settings?.asrLanguage)
      },
      exclusionKeywords: config.exclusionKeywords || []
    };
  }

  /**
   * 将旧版单一 LLM 配置迁移到新版 LLMConfig 列表
   */
  static migrateToLLMConfigs(pluginConfig: any): LLMConfig | null {
    if (pluginConfig && pluginConfig.llm && pluginConfig.llm.apiKey) {
      const providerName = getProviderLabel(pluginConfig.llm.provider);
      
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