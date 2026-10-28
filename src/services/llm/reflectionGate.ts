/**
 * 反思闸门（Reflection Gate）
 *
 * 反思模式此前把「初稿够不够好」交给模型自评，实测模型倾向于只清点
 * 稿子里「有什么」，不核对字幕里「缺什么」，几乎恒返回「优秀」
 * （线上 24 次生成里 23 次直通），第二次调用沦为纯开销。
 *
 * 这里改用确定性规则做同一件事：结构、时间戳、定量数据点召回率。
 * 只有确实不达标时才触发重写，重写结果也按同样规则复核，
 * 不如初稿就丢掉，避免「越改越差」。
 */

/** 低于该节点数基本可判定为严重漏内容 */
const MIN_NODE_COUNT = 6;
/** 带时间戳的列表节点占比下限 */
const MIN_TIMESTAMPED_RATIO = 0.9;
/** 数据点召回率下限（字幕里的百分比/金额/日期等必须落到叶子上） */
const MIN_DATA_RECALL = 0.9;
/** 少于该数量的数据点不做召回判断（短视频本身就没有定量信息） */
const MIN_DATA_POINTS = 5;
/** 首个时间戳允许的滞后（秒），以及按比例放宽的上限 */
const START_TOLERANCE_SEC = 90;
/** 末个时间戳允许的提前量（秒） */
const END_TOLERANCE_SEC = 120;

export interface GateMetrics {
  /** 无序列表节点数（不含根标题） */
  nodeCount: number;
  /** 最大缩进深度 */
  maxDepth: number;
  /** 带时间戳的节点占比 */
  timestampedRatio: number;
  /** 首个时间戳（秒） */
  startSec: number;
  /** 末个时间戳（秒） */
  endSec: number;
  /** 字幕（或压缩稿）末个时间戳（秒） */
  sourceEndSec: number;
  /** 字幕中定量数据点总数 */
  dataPointTotal: number;
  /** 初稿覆盖到的数据点数 */
  dataPointCovered: number;
  /** 数据点召回率 0~1 */
  dataPointRecall: number;
}

export interface GateResult {
  pass: boolean;
  /** 未通过原因（中文，可直接进日志/进度） */
  reasons: string[];
  metrics: GateMetrics;
}

interface ParsedLine {
  depth: number;
  text: string;
  stampSec: number | null;
}

/** 解析 [mm:ss] / [hh:mm:ss]，返回秒数 */
export function parseStamp(stamp: string): number | null {
  const m = stamp.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseLines(markdown: string): { lines: ParsedLine[]; headings: string[]; indentationBad: boolean } {
  const lines: ParsedLine[] = [];
  const headings: string[] = [];
  let indentationBad = false;

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const heading = line.trim().match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      headings.push(heading[0]);
      continue;
    }

    const item = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (!item) continue;

    const indent = item[1].length;
    if (indent % 2 !== 0) indentationBad = true;
    const text = item[2].trim();
    const stamp = text.match(/\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*$/);
    lines.push({
      depth: indent / 2 + 1,
      text,
      stampSec: stamp ? parseStamp(stamp[1]) : null
    });
  }

  return { lines, headings, indentationBad };
}

/** 从字幕里抽取「定量数据点」：百分比、金额、日期、年份 */
export function extractDataPoints(text: string): Set<string> {
  const points = new Set<string>();
  const push = (value: string) => {
    const normalized = value.replace(/\s+/g, '').replace(/％/g, '%');
    if (normalized) points.add(normalized);
  };

  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*[%％]/g)) push(m[1] + '%');
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(万亿|亿|万|美元|美分)/g)) push(m[1] + m[2]);
  for (const m of text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) push(m[1] + '月' + m[2] + '日');
  for (const m of text.matchAll(/(20\d{2})\s*年/g)) push(m[1] + '年');

  return points;
}

function maxStampIn(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/\[(\d{1,3}:\d{2}(?::\d{2})?)\]/g)) {
    const sec = parseStamp(m[1]);
    if (sec !== null && sec > max) max = sec;
  }
  return max;
}

/**
 * 用确定性规则评估初稿质量。
 *
 * @param markdown 初稿（或重写稿）
 * @param source 与该稿对应的输入文本：短字幕用原字幕，长字幕用压缩稿
 */
export function evaluateMindmapDraft(markdown: string, source: string): GateResult {
  const reasons: string[] = [];
  const { lines, headings, indentationBad } = parseLines(markdown || '');

  const rootHeadings = headings.filter(h => /^#\s/.test(h));
  if (rootHeadings.length !== 1) {
    reasons.push(`结构：根标题应为 1 个 '# '，实际 ${rootHeadings.length} 个`);
  }
  if (headings.length !== rootHeadings.length) {
    reasons.push(`结构：混用了二级及以下标题（${headings.length - rootHeadings.length} 处）`);
  }
  if (indentationBad) {
    reasons.push('结构：列表缩进不是 2 的空格整数倍，解析会塌陷');
  }

  const nodeCount = lines.length;
  if (nodeCount < MIN_NODE_COUNT) {
    reasons.push(`结构：仅 ${nodeCount} 个列表节点，明显少于一份完整导图`);
  }

  const stamped = lines.filter(l => l.stampSec !== null);
  const timestampedRatio = nodeCount === 0 ? 0 : stamped.length / nodeCount;
  if (timestampedRatio < MIN_TIMESTAMPED_RATIO) {
    reasons.push(`时间戳：仅 ${Math.round(timestampedRatio * 100)}% 的节点带 [mm:ss]`);
  }

  const startSec = stamped.length ? Math.min(...stamped.map(l => l.stampSec as number)) : 0;
  const endSec = stamped.length ? Math.max(...stamped.map(l => l.stampSec as number)) : 0;
  const sourceEndSec = maxStampIn(source || '');

  if (sourceEndSec > 0) {
    const slack = Math.max(START_TOLERANCE_SEC, sourceEndSec * 0.1);
    if (startSec > slack) {
      reasons.push(`时间戳：从 ${formatSec(startSec)} 才开始，遗漏了开头的 ${formatSec(startSec)} 内容`);
    }
    const tailSlack = Math.max(END_TOLERANCE_SEC, sourceEndSec * 0.1);
    if (sourceEndSec - endSec > tailSlack) {
      reasons.push(`时间戳：只覆盖到 ${formatSec(endSec)}，结尾约 ${formatSec(sourceEndSec - endSec)} 未覆盖`);
    }
  }

  const points = extractDataPoints(source || '');
  const flat = (markdown || '').replace(/\s+/g, '').replace(/％/g, '%');
  let covered = 0;
  for (const point of points) {
    if (flat.includes(point)) covered += 1;
  }
  const dataPointRecall = points.size === 0 ? 1 : covered / points.size;
  if (points.size >= MIN_DATA_POINTS && dataPointRecall < MIN_DATA_RECALL) {
    reasons.push(
      `数据点：字幕中 ${points.size} 个百分比/金额/日期只保留 ${covered} 个（${Math.round(dataPointRecall * 100)}%）`
    );
  }

  return {
    pass: reasons.length === 0,
    reasons,
    metrics: {
      nodeCount,
      maxDepth: lines.length ? Math.max(...lines.map(l => l.depth)) : 0,
      timestampedRatio,
      startSec,
      endSec,
      sourceEndSec,
      dataPointTotal: points.size,
      dataPointCovered: covered,
      dataPointRecall
    }
  };
}

export interface VerdictResult {
  adopt: boolean;
  reason: string;
}

/**
 * 判断重写稿是否值得替换初稿。
 * 初稿已通过但被重写命中时保留初稿：闸门通过意味着没有需要修的缺陷。
 */
export function compareDrafts(draftMarkdown: string, rewriteMarkdown: string, source: string): VerdictResult {
  const draft = evaluateMindmapDraft(draftMarkdown, source);
  const rewrite = evaluateMindmapDraft(rewriteMarkdown, source);

  if (rewrite.metrics.nodeCount === 0) {
    return { adopt: false, reason: '重写稿为空' };
  }
  if (!rewrite.pass) {
    const draftRecall = draft.metrics.dataPointRecall;
    const rewriteRecall = rewrite.metrics.dataPointRecall;
    if (rewriteRecall <= draftRecall + 0.02) {
      return { adopt: false, reason: `重写稿仍未达标且没有提升（${rewrite.reasons.join('；')}）` };
    }
    if (rewrite.metrics.nodeCount < draft.metrics.nodeCount * 0.8) {
      return { adopt: false, reason: '重写稿明显比初稿更单薄' };
    }
  }
  return { adopt: true, reason: rewrite.pass ? '重写稿通过校验' : '重写稿数据点更完整' };
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
