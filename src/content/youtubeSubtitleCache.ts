import { YouTubeUtils } from '../utils/youtubeUtils';

/**
 * YouTube 字幕 / 音频 上下文缓存与主动获取模块
 *
 * 背景：YouTube 的字幕与音频流地址只能从页面的 ytInitialPlayerResponse 中读取，
 * 而 content script 处于隔离世界无法直接访问 window.ytInitialPlayerResponse。
 *
 * 本模块提供两条获取路径：
 *  1. 被动预热：youtubeInterceptor.js（main world）在页面加载时把 captionTracks
 *     通过 postMessage 推送过来，由 YouTubeObserver 写入缓存；
 *  2. 主动兜底（更可靠）：直接 fetch 当前 watch 页面 HTML，用括号匹配提取
 *     ytInitialPlayerResponse 中的 captionTracks 与 adaptiveFormats 音频流。
 *
 * 手动点击悬浮球时，background 通过 FETCH_YOUTUBE_SUBTITLE / FETCH_YOUTUBE_AUDIO_URL
 * 请求本模块，按 "缓存 → 主动 fetch HTML 提取" 两级回退获取。
 */

let cachedCaptionTracks: any[] = [];
let cachedVideoTitle: string = '';
let cachedSubtitleText: string | null = null;
let cachedSubtitleUrl: string | null = null;
let cachedAudioUrl: string | null = null;

export const YouTubeSubtitleCache = {
  /** 缓存 YouTube 播放器中的字幕轨道列表（由 main world 的 interceptor 推送） */
  setCaptionTracks(tracks: any[], title?: string) {
    if (Array.isArray(tracks) && tracks.length > 0) {
      cachedCaptionTracks = tracks;
    }
    if (title) cachedVideoTitle = title;
  },

  /** 缓存拦截到的字幕请求 URL（可能带片段参数 sq=，fetch 时会清理） */
  setSubtitleUrl(url: string) {
    if (url) cachedSubtitleUrl = url;
  },

  /** 缓存已解析完成的字幕纯文本（供手动点击直接复用，避免重复 fetch） */
  setSubtitleText(text: string) {
    if (text && text.trim()) cachedSubtitleText = text;
  },

  getCachedSubtitleText(): string | null {
    return cachedSubtitleText;
  },

  getVideoTitle(): string {
    return cachedVideoTitle || document.title.replace(' - YouTube', '').trim() || 'YouTube 视频';
  },

  /**
   * 切换视频时清理缓存，避免上一个视频的字幕/音频地址污染当前视频判断。
   * YouTube 是 SPA，导航不会重新注入 content script，故必须显式清理。
   */
  clearCache() {
    cachedCaptionTracks = [];
    cachedSubtitleText = null;
    cachedSubtitleUrl = null;
    cachedAudioUrl = null;
  },

  /**
   * 主动获取 YouTube 字幕文本
   * 回退顺序：
   *   1. 已缓存的字幕文本（observer 拦截并解析过）
   *   2. 已缓存的字幕 URL（重新 fetch 完整轨道）
   *   3. 已缓存的 captionTracks（任选一条 fetch）
   *   4. 直接 fetch 当前页面 HTML 提取 captionTracks（最可靠兜底）
   */
  async fetchSubtitle(): Promise<{ subtitleText: string; videoTitle: string } | null> {
    // 1. 已缓存的完整字幕文本
    if (cachedSubtitleText && cachedSubtitleText.trim()) {
      return { subtitleText: cachedSubtitleText, videoTitle: this.getVideoTitle() };
    }

    // 2. 用缓存的字幕 URL 重新 fetch
    if (cachedSubtitleUrl) {
      const text = await this.fetchAndParseUrl(cachedSubtitleUrl);
      if (text) return { subtitleText: text, videoTitle: this.getVideoTitle() };
    }

    // 3. 用已缓存的 captionTracks fetch
    if (cachedCaptionTracks.length > 0) {
      const text = await this.fetchFromTracks(cachedCaptionTracks);
      if (text) return { subtitleText: text, videoTitle: this.getVideoTitle() };
    }

    // 4. 兜底：直接 fetch 当前页面 HTML 提取 captionTracks
    const playerData = await this.fetchPlayerDataFromHtml();
    if (playerData?.captionTracks?.length) {
      cachedCaptionTracks = playerData.captionTracks;
      if (playerData.videoTitle) cachedVideoTitle = playerData.videoTitle;
      const text = await this.fetchFromTracks(playerData.captionTracks);
      if (text) return { subtitleText: text, videoTitle: this.getVideoTitle() };
    }

    return null;
  },

  /**
   * 主动获取 YouTube 音频流 URL（用于无字幕时回退 ASR）
   * 回退顺序：已缓存 → fetch 当前页面 HTML 提取 adaptiveFormats
   */
  async fetchAudioUrl(): Promise<string | null> {
    if (cachedAudioUrl) return cachedAudioUrl;

    const playerData = await this.fetchPlayerDataFromHtml();
    if (playerData?.audioUrl) {
      cachedAudioUrl = playerData.audioUrl;
      if (playerData.videoTitle) cachedVideoTitle = playerData.videoTitle;
      return playerData.audioUrl;
    }
    return null;
  },

  async fetchFromTracks(tracks: any[]): Promise<string | null> {
    if (!tracks || tracks.length === 0) return null;
    // 优先中文，否则取第一条（自动字幕 kind=asr 也能用）
    const track = tracks.find(t => /zh|cn/i.test(t?.languageCode || '')) || tracks[0];
    const baseUrl = track?.baseUrl;
    if (!baseUrl) return null;
    return this.fetchAndParseUrl(baseUrl);
  },

  /** fetch 字幕 URL 并解析为带时间戳纯文本，成功后缓存 */
  async fetchAndParseUrl(url: string): Promise<string | null> {
    try {
      const urlObj = new URL(url, window.location.origin);
      urlObj.searchParams.delete('sq'); // 去除片段参数，拿完整字幕轨道
      if (!urlObj.searchParams.has('fmt')) {
        urlObj.searchParams.set('fmt', 'json3'); // 统一 json3 格式
      }
      const res = await fetch(urlObj.toString());
      if (!res.ok) {
        console.warn('[YouTubeSubtitleCache] fetch subtitle HTTP', res.status);
        return null;
      }
      const data = await res.json();
      const text = YouTubeUtils.parseSubtitle(data);
      if (text && text.trim()) {
        cachedSubtitleText = text;
        return text;
      }
    } catch (e) {
      console.error('[YouTubeSubtitleCache] fetchAndParseUrl failed:', e);
    }
    return null;
  },

  /**
   * 直接 fetch 当前 watch 页面 HTML，提取 ytInitialPlayerResponse 中的
   * captionTracks 与 adaptiveFormats 音频流地址。
   *
   * 这是最可靠的兜底路径，不依赖 main world 的 postMessage 时序，
   * SPA 导航后也能拿到当前视频的真实数据。
   */
  async fetchPlayerDataFromHtml(): Promise<{
    captionTracks: any[];
    audioUrl: string | null;
    videoTitle?: string;
  } | null> {
    try {
      const res = await fetch(window.location.href, { credentials: 'include' });
      if (!res.ok) {
        console.warn('[YouTubeSubtitleCache] fetch page HTML HTTP', res.status);
        return null;
      }
      const html = await res.text();

      const captionTracks = extractArrayAfterKey(html, '"captionTracks"') || [];
      const audioUrl = extractAudioUrlFromHtml(html);
      const videoTitle = extractVideoTitleFromHtml(html);

      return { captionTracks, audioUrl, videoTitle };
    } catch (e) {
      console.error('[YouTubeSubtitleCache] fetchPlayerDataFromHtml failed:', e);
      return null;
    }
  }
};

/**
 * 在 HTML 文本中找到 `"key"`（带冒号）后紧跟的 JSON 数组/对象，用括号匹配提取并解析。
 * 用于从 ytInitialPlayerResponse 中安全提取 captionTracks / adaptiveFormats 等子结构，
 * 无需解析整个（可能数 MB 的）播放器对象。
 */
function extractArrayAfterKey(html: string, key: string): any[] | null {
  let idx = html.indexOf(key);
  while (idx >= 0) {
    // 跳过 key 后的 ":"
    let i = idx + key.length;
    while (i < html.length && (html[i] === ':' || /\s/.test(html[i]))) i++;
    // 必须是数组或对象起点
    if (html[i] === '[' || html[i] === '{') {
      const balanced = extractBalanced(html, i);
      if (balanced) {
        try {
          const parsed = JSON.parse(balanced);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // 继续找下一个出现位置
        }
      }
    }
    idx = html.indexOf(key, idx + key.length);
  }
  return null;
}

/**
 * 从 HTML 提取音频流 URL：优先 adaptiveFormats，再 formats。
 * 选 mimeType 含 "audio" 的最高码率且 url 直接可用的流。
 */
function extractAudioUrlFromHtml(html: string): string | null {
  for (const key of ['"adaptiveFormats"', '"formats"']) {
    const arr = extractArrayAfterKey(html, key);
    if (!arr) continue;
    let best: { bitrate: number; url: string } | null = null;
    for (const f of arr) {
      if (!f || typeof f !== 'object') continue;
      const mime: string = f.mimeType || '';
      if (!mime.toLowerCase().includes('audio')) continue;
      // 只接受 url 直接可用（未签名加密）的流；signatureCipher 流暂不支持
      const url: string | undefined = f.url;
      if (!url) continue;
      const bitrate = Number(f.bitrate) || 0;
      if (!best || bitrate > best.bitrate) {
        best = { bitrate, url };
      }
    }
    if (best) return best.url;
  }
  return null;
}

/** 从 HTML 中提取 videoDetails.title */
function extractVideoTitleFromHtml(html: string): string | undefined {
  const key = '"title":"';
  let idx = html.indexOf(key);
  // 取第一个合理的 title（playerResponse 里 videoDetails.title 靠前）
  while (idx >= 0) {
    const start = idx + key.length;
    const end = findStringEnd(html, start);
    if (end > start) {
      try {
        const titleStr = JSON.parse('"' + html.slice(start, end) + '"');
        if (titleStr && titleStr.length > 0 && titleStr.length < 500) {
          return titleStr;
        }
      } catch {
        // 继续找
      }
    }
    idx = html.indexOf(key, end > start ? end : idx + key.length);
  }
  return undefined;
}

/** 从 start 位置（指向字符串内容起点，不含开引号）找到未转义结束引号位置 */
function findStringEnd(html: string, start: number): number {
  let i = start;
  let escape = false;
  while (i < html.length) {
    const c = html[i];
    if (escape) {
      escape = false;
    } else if (c === '\\') {
      escape = true;
    } else if (c === '"') {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * 从 start 处的 '{' 或 '[' 开始，做括号匹配提取一段完整 JSON 子串。
 * 正确处理字符串字面量内的括号与转义。
 */
function extractBalanced(text: string, start: number): string | null {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
