import React, { useCallback, useEffect, useState } from 'react';
import { StorageService } from '../../services/storageService';

interface Usage {
  bytes: number;
  quotaBytes: number;
  cacheEntries: number;
  cacheChars: number;
  mindmaps: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 存储维护面板
 *
 * 扩展会把字幕、ASR 结果和导图都放在本地，长期使用可能积累大量旧数据。
 * 这里给出「用了多少 / 清什么」，避免用户只能靠「清空所有导图」一刀切。
 */
export const StorageSection: React.FC = () => {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsage(await StorageService.getStorageUsage());
    } catch (error) {
      console.warn('[StorageSection] 读取存储用量失败:', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (error: any) {
      setMessage('操作失败：' + (error?.message || error));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const handlePrune = () => run(async () => {
    const removed = await StorageService.pruneCaches({ force: true });
    return removed > 0 ? `已清理 ${removed} 条过期/超量缓存` : '没有需要清理的缓存';
  });

  const handleClearText = () => {
    if (!confirm('清空所有字幕与语音识别缓存？导图会保留，但重新生成时需要重新获取字幕。')) return;
    void run(async () => {
      const removed = await StorageService.clearTextCaches();
      return `已清空 ${removed} 条字幕 / 语音识别缓存`;
    });
  };

  const handleClearMindmaps = () => {
    if (!confirm('清空所有思维导图缓存？此操作不可撤销。')) return;
    void run(async () => {
      await StorageService.clearMindmaps();
      return '已清空思维导图缓存';
    });
  };

  const usedPercent = usage && usage.quotaBytes > 0
    ? Math.min(100, Math.round((usage.bytes / usage.quotaBytes) * 100))
    : 0;

  return (
    <section className="options-section">
      <div className="section-header">
        <h3 className="section-title">本地存储</h3>
      </div>

      <p className="form-hint" style={{ marginTop: 0 }}>
        字幕、语音识别结果和思维导图都保存在浏览器本地。缓存按 30 天（阶段 1 初稿 3 天）
        自动过期，超出容量时优先淘汰最久未使用的内容。
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '10px',
          margin: '16px 0'
        }}
      >
        <div className="cache-info" style={{ margin: 0 }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>已用空间</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>
            {usage ? formatBytes(usage.bytes) : '—'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {usage ? `约占 ${usedPercent}% / ${formatBytes(usage.quotaBytes)}` : ''}
          </div>
        </div>
        <div className="cache-info" style={{ margin: 0 }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>文本缓存</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>
            {usage ? usage.cacheEntries : '—'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {usage ? `约 ${(usage.cacheChars / 1000).toFixed(0)} 千字` : ''}
          </div>
        </div>
        <div className="cache-info" style={{ margin: 0 }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>思维导图</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>
            {usage ? usage.mindmaps : '—'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>最多保留 30 张</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        <button className="btn--secondary-outline" onClick={handlePrune} disabled={busy}>
          🧹 清理过期缓存
        </button>
        <button className="btn--secondary-outline" onClick={handleClearText} disabled={busy}>
          清空字幕 / ASR 缓存
        </button>
        <button className="btn--danger-soft" onClick={handleClearMindmaps} disabled={busy}>
          清空思维导图缓存
        </button>
      </div>

      {message && (
        <p className="form-hint" style={{ color: '#047857', marginTop: '12px' }}>
          {message}
        </p>
      )}
    </section>
  );
};
