export type LLMProvider = 'openai' | 'gemini' | 'custom';

// 单个 LLM 配置
export interface LLMConfig {
  id: string;           // 唯一标识符
  name: string;         // 配置名称，用于显示
  provider: LLMProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
  timeout?: number;     // 超时时间（秒）
  createdAt: number;    // 创建时间戳
  updatedAt: number;    // 更新时间戳
}

export interface PluginConfig {
  // 当前选中的 LLM 配置 ID
  selectedLLMConfigId: string;
  // 兼容旧版本的单一配置（将被迁移）
  llm: {
    provider: LLMProvider;
    apiUrl: string;
    apiKey: string;
    model: string;
    timeout?: number;  // 超时时间（秒）
  };
  prompt: {
    template: string;
  };
  settings: {
    language: string;
    cacheDirectory: string;
    enableCache: boolean;  // 是否启用思维导图缓存
  };
  // 排除关键词列表
  exclusionKeywords: string[];
}

// 生成唯一 ID
export function generateLLMConfigId(): string {
  return `llm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// 创建默认 LLM 配置
export function createDefaultLLMConfig(provider: LLMProvider = 'openai'): LLMConfig {
  const now = Date.now();
  const configs: Record<LLMProvider, Partial<LLMConfig>> = {
    openai: {
      name: 'OpenAI GPT',
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-3.5-turbo',
    },
    gemini: {
      name: 'Google Gemini',
      provider: 'gemini',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-1.5-flash',
    },
    custom: {
      name: '自定义配置',
      provider: 'custom',
      apiUrl: '',
      model: '',
    },
  };

  return {
    id: generateLLMConfigId(),
    ...configs[provider],
    apiKey: '',
    timeout: 60,
    createdAt: now,
    updatedAt: now,
  } as LLMConfig;
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  id: 'default',
  name: 'OpenAI GPT (默认)',
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  timeout: 60,
  createdAt: 0,
  updatedAt: 0,
};

export const DEFAULT_CONFIG: PluginConfig = {
  selectedLLMConfigId: 'default',
  llm: {
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    timeout: 60  // 默认 60 秒
  },
  prompt: {
    template: `请将以下视频字幕内容总结为一个思维导图，使用纯Markdown格式。

要求：
1. 使用标准的Markdown标题层级（# 一级标题、## 二级标题等）表示思维导图结构
2. 使用无序列表（-）表示分支节点
3. 提取主要观点和关键信息
4. 保持逻辑层次清晰
5. 使用简洁的语言
6. 不要使用任何特殊语法或Mermaid

字幕内容：
{subtitle_content}

请直接输出Markdown格式的思维导图，不要包含其他说明文字。`
  },
  settings: {
    language: 'zh-CN',
    cacheDirectory: '',
    enableCache: true  // 默认开启缓存
  },
  exclusionKeywords: []
};