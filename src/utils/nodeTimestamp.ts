/**
 * 节点文本与时间戳徽章的统一解析
 *
 * LLM 输出的导图节点文本形如「标题 [mm:ss]」，渲染层会把它剥离成
 * 「标题 + 可点击的时间戳徽章」。这里提供全项目唯一的切分实现，
 * 供渲染（Node / 根标题）与布局估算（layout / exportMindmap）共用，
 * 避免各处正则不一致，导致「布局量的是原始文本、画的是标题加徽章」：
 * 徽章比 [mm:ss] 原字符更宽，会把节点内容挤到第二行、压到下划线上。
 *
 * 只认贴着文本首/尾的时间戳：正文中间的 [16:9]、(3:2) 之类比例、
 * 比分内容一律不剥离，防止误截标题、误生成跳转徽章。
 */

export interface NodeTextParts {
  /** 剥离时间戳后的节点标题；纯时间戳节点为空字符串 */
  title: string;
  /** 时间戳（mm:ss 或 hh:mm:ss）；未命中为 null */
  timestamp: string | null;
}

// 半角 [] () 与全角 【】（）都支持，LLM 中文输出常混用两种括号
const OPEN = '\\[\\(【（';
const CLOSE = '\\]\\)】）';
const STAMP = '\\d{1,2}:\\d{2}(?::\\d{2})?';

const TRAILING_STAMP = new RegExp(`[${OPEN}](${STAMP})[${CLOSE}]\\s*$`);
const LEADING_STAMP = new RegExp(`^[${OPEN}](${STAMP})[${CLOSE}]\\s*`);

/**
 * 时间戳渲染成徽章后，相对「等字符数的普通文本」多占的宽度：
 * margin-left 6 + 左右 padding 12 + 边框 2 + 舍入余量 2
 */
export const TIMESTAMP_BADGE_EXTRA_WIDTH = 22;

export function splitNodeTimestamp(raw: string | null | undefined): NodeTextParts {
  const text = (raw ?? '').trim();
  if (!text) return { title: '', timestamp: null };

  const trailing = text.match(TRAILING_STAMP);
  if (trailing && trailing.index !== undefined) {
    return { title: text.slice(0, trailing.index).trim(), timestamp: trailing[1] };
  }

  const leading = text.match(LEADING_STAMP);
  if (leading) {
    return { title: text.slice(leading[0].length).trim(), timestamp: leading[1] };
  }

  return { title: text, timestamp: null };
}
