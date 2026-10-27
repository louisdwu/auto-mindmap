/**
 * 「仅获取字幕」模式的结果数据
 *
 * 与思维导图任务的结果区分开：该模式只产出字幕原文本，
 * 不包含 mindmapMarkdown，也不会触发 LLM 调用。
 */
export interface SubtitleResultData {
  videoUrl?: string;
  videoTitle?: string;
  subtitleText: string;
  /** 字幕是否来自 ASR 语音识别（而非官方 CC 字幕） */
  isAsr?: boolean;
  /** 后台是否已按「本地文件缓存」设置自动保存了 .txt 文件 */
  savedToFile?: boolean;
}
