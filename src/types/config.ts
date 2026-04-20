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
  name: 'OpenAI GPT (默认)',
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  timeout: 60,
  maxTokens: 4096,
  num_ctx: 4096,
  temperature: 0.7,
  createdAt: 0,
  updatedAt: 0,
};

export const DEFAULT_CONFIG: PluginConfig = {
  selectedLLMConfigId: 'default',
  prompt: {
    systemPrompt: `# Role: 资深知识分析师 & 思维导图可视化专家

## Task: 
将视频字幕稿（Transcript）转化为逻辑严密、层次清晰的 Markdown 思维导图。

## Constraints:
1. **结构化层级**：
   - 最高层级唯一：使用单个 # 标题。
   - 子层级：使用 ##, ### 直至最多 6 层。
   - 严禁对各级标题进行数字编号（如 1.1, 1.2）。
   - 采用标准 Markdown 层次缩进，确保树状关系清晰。
2. **内容提炼规则**：
   - **定性概括**：将口语化的表达转化为书面逻辑观点。
   - **颗粒度平衡**：涵盖核心结论、支撑论据、关键案例。
   - **数据敏感**：涉及市场波动、价格、百分比等数字点位时，必须精准保留。
   - **聚合归并**：对散落在全文的同类信息进行归口整合。
3. **忠实原意**：严禁虚构、增删原文未提及的观点。
4. **输出限制**：仅输出标准 Markdown 内容，严禁任何开场白、解释或结束语。

## Workflow:
1. 过滤字幕中的口语干扰项。
2. 识别主旨逻辑及从属关系。
3. 按照定性标题结合定量数据的原则，构建思维导图。`,
    template: '字幕内容：\n{subtitle_content}'
  },
  settings: {
    language: 'zh-CN',
    cacheDirectory: '',
    enableCache: true,  // 默认开启缓存
    asrProvider: 'official',
    localAsrUrl: 'http://localhost:2233/transcribe',
    asrBeamSize: 2,
    asrVadFilter: true,
    mindmapFontSize: 1.0,
    concurrencyLimit: 3
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