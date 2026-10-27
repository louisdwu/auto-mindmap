/**
 * 字幕文本的复制 / 下载工具（content script 上下文）
 *
 * 悬浮球失败卡片与字幕弹窗共用同一套落盘与剪贴板逻辑，
 * 避免两处实现出现文件名或回退策略不一致。
 */

const DEFAULT_SUBTITLE_NAME = '视频字幕';

/** 将视频标题转为安全的文件名，空标题回退为默认名 */
export function sanitizeSubtitleFileName(title?: string): string {
  const cleaned = (title || DEFAULT_SUBTITLE_NAME)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || DEFAULT_SUBTITLE_NAME;
}

/** 生成下载用文件名，与既有失败卡片保持一致 */
export function buildSubtitleFileName(title?: string): string {
  return `${sanitizeSubtitleFileName(title)}_字幕原文本.txt`;
}

/**
 * 复制文本到剪贴板。
 * 优先使用异步 Clipboard API，失败时回退到 execCommand('copy')，
 * 兼容 B 站 / YouTube 页面上的权限与焦点限制。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    console.warn('[subtitleExport] navigator.clipboard.writeText 失败，尝试回退方案:', e);
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    return success;
  } catch (e) {
    console.error('[subtitleExport] 回退复制失败:', e);
    return false;
  }
}

/** 触发浏览器下载一个文本文件，返回是否成功发起下载 */
export function downloadTextFile(text: string, fileName: string): boolean {
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 立即 revoke 在部分浏览器会中断下载，延迟释放更稳妥
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (e) {
    console.error('[subtitleExport] 下载字幕文件失败:', e);
    return false;
  }
}
