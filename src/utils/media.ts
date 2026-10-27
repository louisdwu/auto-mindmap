/**
 * 统一媒体标识（B 站 / YouTube）
 *
 * 这是缓存、任务去重、视图状态与消息过滤的唯一身份来源。
 *
 * 为什么不能只用视频 ID：
 * - B 站同一个 BV 号下可以有多个分 P（?p=2），每个分 P 的字幕、音频、
 *   导图都不同；只用 BV 号会让 P1 的缓存命中到 P2，甚至把 P2 的音频
 *   拿去生成 P1 的导图。
 * - B 站 URL 可能带 av 号、bvid/aid 查询参数，需要统一成同一个逻辑身份。
 *
 * 兼容性约定：
 * - P1 的 cacheId 保持为裸视频 ID（BV... / YouTube ID），所以旧缓存仍可命中。
 * - P2 及以后使用 `<视频ID>_p<N>`，与旧数据天然隔离。
 */

export type MediaPlatform = 'bilibili' | 'youtube';

export interface MediaRef {
  platform: MediaPlatform;
  /** 平台原生视频 ID：BV... / av... / YouTube 视频 ID */
  videoId: string;
  /** B 站分 P，1-based；其他平台恒为 1 */
  page: number;
  /** 任务去重与消息过滤用的唯一标识：bilibili:BV...:p2 / youtube:xxxx */
  key: string;
  /** 缓存键与 ASR video_id 用的稳定标识：P1 为裸 ID，PN 为 ID_pN */
  cacheId: string;
}

/** B 站分 P 上限仅用于防御异常输入，超过 9999 视为非法 */
const MAX_PAGE = 9999;

function normalizePage(raw: string | null | undefined): number {
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_PAGE);
}

function buildBilibili(videoId: string, page: number): MediaRef {
  return {
    platform: 'bilibili',
    videoId,
    page,
    key: `bilibili:${videoId}:p${page}`,
    cacheId: page === 1 ? videoId : `${videoId}_p${page}`
  };
}

function buildYouTube(videoId: string): MediaRef {
  return {
    platform: 'youtube',
    videoId,
    page: 1,
    key: `youtube:${videoId}`,
    cacheId: videoId
  };
}

/**
 * 从 URL 解析出统一媒体标识；非视频页返回 null。
 * 兼容 B 站标准/av/bvid 链接与 YouTube watch/youtu.be/embed/shorts 链接。
 */
export function parseMediaRef(url: string | null | undefined): MediaRef | null {
  if (!url) return null;

  try {
    let urlStr = url.trim();
    if (!urlStr) return null;
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = 'https://' + urlStr;
    }

    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) {
      const match = pathname.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
      let videoId = match?.[1];
      if (!videoId) {
        const bvid = parsed.searchParams.get('bvid');
        const aid = parsed.searchParams.get('aid');
        if (bvid && /^BV[0-9A-Za-z]+$/i.test(bvid)) videoId = bvid;
        else if (aid) videoId = aid.startsWith('av') ? aid : 'av' + aid;
      }
      if (!videoId) return null;
      return buildBilibili(videoId, normalizePage(parsed.searchParams.get('p')));
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be') {
      const v = parsed.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{6,}$/.test(v)) return buildYouTube(v);

      const parts = pathname.split('/').filter(Boolean);
      if (hostname === 'youtu.be' && parts[0]) return buildYouTube(parts[0]);
      if (parts[0] === 'embed' && parts[1]) return buildYouTube(parts[1]);
      if (parts[0] === 'shorts' && parts[1]) return buildYouTube(parts[1]);
      if (parts[0] === 'v' && parts[1]) return buildYouTube(parts[1]);
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

/** 两个 URL 是否指向同一视频的同一分 P */
export function isSameMedia(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const refA = parseMediaRef(a);
  const refB = parseMediaRef(b);
  if (refA && refB) return refA.key === refB.key;
  return a === b;
}

/** 缓存/任务使用的稳定标识；无法解析 URL 时回退为裁剪后的原始 URL */
export function getCacheId(url: string | null | undefined): string | null {
  const ref = parseMediaRef(url);
  if (ref) return ref.cacheId;
  if (!url) return null;
  return url.trim().slice(0, 200) || null;
}
