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
    template: '字幕内容：\n{subtitle_content}',
    reflectionPrompt: `# 任务：评价思维导图质量，并在必要时直接进行优化

## 输入：
1. 原视频字幕稿：
{subtitle_content}

2. 初步生成的思维导图：
{initial_mindmap}

## 指令：
请对比字幕稿，评估初步生成的思维导图的完整性、准确性和逻辑性。
1. 如果该导图已经非常优秀且涵盖了所有核心论点，请仅回复“优秀”二字。
2. 如果存在遗漏、错误或逻辑不通，请结合原字幕内容，直接输出一份优化补充后的完整 Markdown 思维导图。

## 输出要求：
- 仅输出结果（“优秀”二字或完整 Markdown 内容）。
- 严禁任何开场白、解释或结束语。
- 确保输出的 Markdown 格式正确。`
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