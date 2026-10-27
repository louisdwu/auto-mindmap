/**
 * LLM 上下文预算与字幕分段
 *
 * 目的：两小时视频的字幕动辄 3-8 万字，直接塞进 8k/16k/32k 上下文的模型
 * 会直接报「context length exceeded」。这里用保守的 token 估算 + 按行切分，
 * 先分段提炼再合并，让长视频也能走完整流程。
 *
 * 估算不是精确 tokenizer：中文按 1 字 ≈ 1 token，英文按 4 字符 ≈ 1 token，
 * 并留出额外安全边际。宁可少放一点，也不要卡在边界上失败。
 */

const CJK_RANGES: Array<[number, number]> = [
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 基本区
  [0xf900, 0xfaff], // CJK 兼容
  [0x3040, 0x30ff], // 日文假名
  [0xac00, 0xd7af], // 韩文
  [0x3000, 0x303f], // 中文标点
  [0xff00, 0xffef]  // 全角字符
];

function isCjkCodePoint(code: number): boolean {
  for (const [start, end] of CJK_RANGES) {
    if (code >= start && code <= end) return true;
  }
  return false;
}

/** 粗略估算 token 数（偏保守） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (isCjkCodePoint(text.charCodeAt(i))) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4) + 1;
}

/** 依据模型配置估算可用输入预算（已扣除输出与安全边际） */
export function computeInputBudget(params: {
  contextWindow?: number;
  maxOutputTokens?: number;
  systemPromptTokens?: number;
  templateTokens?: number;
  safetyMargin?: number;
}): number {
  const contextWindow = Math.max(2048, Number(params.contextWindow) || 16384);
  const maxOutput = Math.min(
    Math.max(512, Number(params.maxOutputTokens) || 4096),
    Math.max(512, contextWindow - 2048)
  );
  const overhead = (params.systemPromptTokens || 0) + (params.templateTokens || 0);
  const margin = params.safetyMargin ?? 512;
  return Math.max(1000, contextWindow - maxOutput - overhead - margin);
}

/**
 * 按行把字幕切成不超过 token 预算的块。
 * 不重叠：字幕每行自带时间戳，分段处不会丢失定位信息。
 */
export function splitTranscriptByBudget(text: string, budgetTokens: number): string[] {
  const budget = Math.max(200, Math.floor(budgetTokens));
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (estimateTokens(normalized) <= budget) return [normalized];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length > 0) {
      const chunk = current.join('\n').trim();
      if (chunk) chunks.push(chunk);
      current = [];
      currentTokens = 0;
    }
  };

  for (const line of normalized.split('\n')) {
    const lineTokens = estimateTokens(line) + 1;

    if (lineTokens > budget) {
      flush();
      for (const piece of splitLongLine(line, budget)) {
        chunks.push(piece);
      }
      continue;
    }

    if (currentTokens + lineTokens > budget && current.length > 0) {
      flush();
    }
    current.push(line);
    currentTokens += lineTokens;
  }
  flush();

  return chunks;
}

/** 极端情况下单行字幕超长：硬切，并尽量保留行首时间戳 */
function splitLongLine(line: string, budgetTokens: number): string[] {
  const prefixMatch = line.match(/^(\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)/);
  const prefix = prefixMatch?.[1] || '';
  const body = prefix ? line.slice(prefix.length) : line;
  const targetChars = Math.max(80, Math.floor(budgetTokens * 0.9));
  const pieces: string[] = [];

  let start = 0;
  while (start < body.length) {
    let end = Math.min(body.length, start + targetChars);
    if (end < body.length) {
      // 尽量在句读处断开
      const window = body.slice(start, end);
      const lastPunctuation = Math.max(
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('.'),
        window.lastIndexOf('!'),
        window.lastIndexOf('?'),
        window.lastIndexOf('；'),
        window.lastIndexOf(';')
      );
      if (lastPunctuation > targetChars * 0.5) end = start + lastPunctuation + 1;
    }
    const piece = body.slice(start, end).trim();
    if (piece) pieces.push(pieces.length === 0 ? prefix + piece : prefix + piece);
    start = end;
  }

  return pieces.length > 0 ? pieces : [line];
}
