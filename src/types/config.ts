export type LLMProvider = 'openai' | 'gemini' | 'sensenova' | 'custom' | 'lmstudio' | 'ollama';

/**
 * 各提供商的默认参数。
 *
 * 这些默认值原先分散在 createDefaultLLMConfig 与选项页的 onChange 里，
 * 两处一旦不同步就会出现「新增的配置能用、切换提供商后的配置不能用」这类幽灵问题，
 * 因此收敛到唯一来源：新增配置与 UI 切换提供商都从这里取。
 */
export interface LLMProviderPreset {
  /** 配置列表里展示的提供商名称 */
  label: string;
  /** 新建配置时的默认名称 */
  defaultName: string;
  /** 基址（不是完整 URL，适配器会补 /chat/completions 等路径） */
  apiUrl: string;
  model: string;
  maxTokens?: number;
  numCtx?: number;
  temperature?: number;
}

export const LLM_PROVIDER_PRESETS: Record<LLMProvider, LLMProviderPreset> = {
  openai: {
    label: 'OpenAI',
    defaultName: 'OpenAI GPT',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    maxTokens: 8192,
    numCtx: 128000,
    temperature: 0.6
  },
  gemini: {
    label: 'Gemini',
    defaultName: 'Google Gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-1.5-flash',
    maxTokens: 8192,
    numCtx: 1000000,
    temperature: 0.6
  },
  // 商汤 SenseNova 走 OpenAI 兼容协议。基址必须带 /v1、模型标识必须与官方文档一字不差，
  // 两者任一不对，网关都会返回 404「model route not found」。
  // 文档：https://github.com/OpenSenseNova/SenseNova6.8/blob/main/API_CN.md
  sensenova: {
    label: '商汤 SenseNova',
    defaultName: '商汤 SenseNova',
    apiUrl: 'https://token.sensenova.cn/v1',
    model: 'sensenova-6.8-flash-lite',
    maxTokens: 8192,
    numCtx: 128000,
    temperature: 0.6
  },
  custom: {
    label: '自定义',
    defaultName: '自定义配置',
    apiUrl: '',
    model: '',
    maxTokens: 8192,
    numCtx: 32768
  },
  lmstudio: {
    label: 'LM Studio',
    defaultName: 'LM Studio (本地)',
    apiUrl: 'http://localhost:1234/v1',
    model: 'qwen_qwen3.5-9b',
    maxTokens: 16384,
    numCtx: 32768,
    temperature: 0.7
  },
  ollama: {
    label: 'Ollama',
    defaultName: 'Ollama (本地/云端)',
    apiUrl: 'http://localhost:11434/api',
    model: 'llama3',
    maxTokens: 16384,
    numCtx: 32768,
    temperature: 0.7
  }
};

/** 安全取提供商展示名，兼容历史配置里出现过的未知 provider */
export function getProviderLabel(provider: string): string {
  return LLM_PROVIDER_PRESETS[provider as LLMProvider]?.label || provider || '自定义';
}

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
    language: string;                 // 历史字段：保留用于配置导入/导出兼容，ASR 已改用 asrLanguage
    /** @deprecated 旧版用非空字符串表示「启用本地文件保存」，现由 saveToLocalFile 取代 */
    cacheDirectory: string;
    /** 是否把字幕 / 导图自动保存到 Chrome 下载目录 */
    saveToLocalFile: boolean;
    enableCache: boolean;  // 是否启用思维导图缓存
    asrProvider: 'official' | 'local'; // 语音识别提供商
    asrLanguage: string;               // ASR 识别语言：'auto' = 自动检测（默认，原文转录）
    localAsrUrl: string;               // 本地 ASR 服务地址
    asrBeamSize: number;               // ASR 束搜索宽度
    asrVadFilter: boolean;             // ASR 是否开启 VAD 过滤
    mindmapFontSize: number;           // 思维导图基础字号缩放倍数
    concurrencyLimit: number;          // 并发任务数限制
    enableReflection: boolean;         // 是否启用反思模式
    reflectionLLMConfigId: string;     // 反思阶段使用的 LLM 配置 ID
    /** 长字幕超出上下文时自动分段提炼，避免直接失败 */
    enableChunking: boolean;
    clearLogsOnClose: boolean;         // 退出日志页面时是否清空记录
    enableSoundNotification: boolean;  // 生成完成后是否播放提示音
    soundNotificationVolume: number;   // 提示音音量 (0-1)
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
  const preset = LLM_PROVIDER_PRESETS[provider];

  return {
    id: generateLLMConfigId(),
    name: preset.defaultName,
    provider,
    apiUrl: preset.apiUrl,
    model: preset.model,
    apiKey: '',
    timeout: 120,
    maxTokens: preset.maxTokens ?? 8192,
    temperature: preset.temperature ?? 0.7,
    ...(preset.numCtx ? { num_ctx: preset.numCtx } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 首次安装时的兜底配置。
 *
 * 这里刻意不内嵌任何 API Key：构建期注入的密钥会出现在 dist 产物里，
 * 也会随仓库/打包分发泄露。新用户必须自己填写密钥或选择本地 Ollama。
 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  id: 'default',
  name: 'Ollama (本地默认)',
  provider: 'ollama',
  apiUrl: 'http://localhost:11434/api',
  apiKey: '',
  model: 'llama3',
  timeout: 120,
  maxTokens: 8192,
  num_ctx: 32768,
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

/**
 * ASR 识别语言。
 *
 * 默认 'auto' —— 交给引擎自动检测源语言，输出「原语言原文」。
 * 这一点很关键：强行指定 zh 去识别英文音频时，Whisper 会把英文
 * 改写/翻译成中文（术语、型号、价格全错），字幕彻底失去参考价值。
 * 只有确认视频是单一语言时，才建议手动指定。
 */
export const DEFAULT_ASR_LANGUAGE = 'auto';

export const ASR_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: '自动检测（推荐）' },
  { value: 'zh', label: '中文（含中英混说）' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'ko', label: '韩文' },
  { value: 'yue', label: '粤语' },
];

/** 归一化 ASR 语言取值：空值 / auto / detect 一律回落到自动检测。 */
export function normalizeAsrLanguage(value?: string | null): string {
  const v = (value || '').trim().toLowerCase();
  if (!v || v === 'auto' || v === 'detect' || v === 'none') {
    return DEFAULT_ASR_LANGUAGE;
  }
  // zh-CN / en-US 这类形态统一收敛成主语言代码
  return v.split('-')[0];
}

export const DEFAULT_CONFIG: PluginConfig = {
  selectedLLMConfigId: 'default',
  prompt: {
    systemPrompt: DEFAULT_PROMPTS.systemPrompt,
    template: DEFAULT_PROMPTS.template,
    reflectionPrompt: DEFAULT_PROMPTS.reflectionPrompt
  },
  settings: {
    language: 'zh-CN',
    cacheDirectory: '',
    saveToLocalFile: true,
    enableCache: true,
    asrProvider: 'local',
    asrLanguage: DEFAULT_ASR_LANGUAGE,
    localAsrUrl: 'http://localhost:2233/transcribe',
    asrBeamSize: 5,
    asrVadFilter: true,
    mindmapFontSize: 0.7,
    concurrencyLimit: 3,
    enableReflection: true,
    reflectionLLMConfigId: 'default',
    enableChunking: true,
    clearLogsOnClose: true,
    enableSoundNotification: true,
    soundNotificationVolume: 0.8
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