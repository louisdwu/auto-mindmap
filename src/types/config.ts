export type LLMProvider = 'openai' | 'gemini' | 'custom' | 'lmstudio' | 'ollama';

// 单个 LLM 配置
export interface LLMConfig {
  id: string;           // 唯一标识符
  name: string;         // 配置名称，用于显示
  provider: LLMProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
  timeout?: number;     // 超时时间（秒）
  maxTokens?: number;   // 最大生成 Token 数
  num_ctx?: number;     // 上下文窗口大小 (Context Window)
  temperature?: number; // 温度
  createdAt: number;    // 创建时间戳
  updatedAt: number;    // 更新时间戳
}

export interface PluginConfig {
  // 当前选中的 LLM 配置 ID
  selectedLLMConfigId: string;
  prompt: {
    systemPrompt: string;
    template: string;
    reflectionPrompt: string;    // 反思优化 Prompt
  };
  settings: {
    language: string;
    cacheDirectory: string;
    enableCache: boolean;  // 是否启用思维导图缓存
    asrProvider: 'official' | 'local'; // 语音识别提供商
    localAsrUrl: string;               // 本地 ASR 服务地址
    asrBeamSize: number;               // ASR 束搜索宽度
    asrVadFilter: boolean;             // ASR 是否开启 VAD 过滤
    mindmapFontSize: number;           // 思维导图基础字号缩放倍数
    concurrencyLimit: number;          // 并发任务数限制
    enableReflection: boolean;         // 是否启用反思模式
    reflectionLLMConfigId: string;     // 反思阶段使用的 LLM 配置 ID
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
      num_ctx: 4096,
    },
    lmstudio: {
      name: 'LM Studio (本地)',
      provider: 'lmstudio',
      apiUrl: 'http://localhost:1234/v1',
      model: 'qwen_qwen3.5-9b',
      num_ctx: 8192,
    },
    ollama: {
      name: 'Ollama (本地/云端)',
      provider: 'ollama',
      apiUrl: 'http://localhost:11434/api',
      model: 'llama3',
      num_ctx: 8192,
    },
  };

  return {
    id: generateLLMConfigId(),
    ...configs[provider],
    apiKey: '',
    timeout: 60,
    maxTokens: 4096,
    temperature: 0.7,
    createdAt: now,
    updatedAt: now,
  } as LLMConfig;
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  id: 'default',
  name: 'Ollama (默认)',
  provider: 'ollama',
  apiUrl: 'https://ollama.com/api',
  // @ts-ignore
  apiKey: import.meta.env.VITE_DEFAULT_API_KEY || '', // 敏感信息已移至 .env 文件
  model: 'gemini-3-flash-preview',
  timeout: 60,
  maxTokens: 40960,
  num_ctx: 16384,
  temperature: 0.5,
  createdAt: 0,
  updatedAt: 0,
};

import systemPromptRaw from '../prompts/System.txt?raw';
import userPromptRaw from '../prompts/User.txt?raw';
import reflectionPromptRaw from '../prompts/Reflection.txt?raw';

// 导出原始默认提示词，用于 UI 对比显示来源
export const DEFAULT_PROMPTS = {
  systemPrompt: systemPromptRaw.trim(),
  template: userPromptRaw.trim(),
  reflectionPrompt: reflectionPromptRaw.trim()
};

export const DEFAULT_CONFIG: PluginConfig = {
  selectedLLMConfigId: 'default',
  prompt: {
    systemPrompt: DEFAULT_PROMPTS.systemPrompt,
    template: DEFAULT_PROMPTS.template,
    reflectionPrompt: DEFAULT_PROMPTS.reflectionPrompt
  },
  settings: {
    language: 'zh-CN',
    cacheDirectory: 'enabled',
    enableCache: true,
    asrProvider: 'local',
    localAsrUrl: 'http://localhost:2233/transcribe',
    asrBeamSize: 5,
    asrVadFilter: true,
    mindmapFontSize: 0.7,
    concurrencyLimit: 3,
    enableReflection: true,
    reflectionLLMConfigId: 'default'
  },
  exclusionKeywords: []
};

// 扩展状态（用于存储运行时状态，如暂停状态）
export interface ExtensionState {
  isPaused: boolean;
}

export const DEFAULT_EXTENSION_STATE: ExtensionState = {
  isPaused: false
};