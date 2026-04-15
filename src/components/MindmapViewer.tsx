import React, { useState } from 'react';
import { MindmapRenderer } from './MindmapRenderer';
import { MindmapStyle } from '../types/mindmap';

interface MindmapViewerProps {
  mindmapData: {
    id: string;
    videoTitle: string;
    mindmapMarkdown: string;
    subtitleText: string;
    errorMessage?: string;
  };
  onClose: () => void;
  onRetry?: () => void;
  onReTranscribe?: () => void;
}

export const MindmapViewer: React.FC<MindmapViewerProps> = ({
  mindmapData,
  onClose,
  onRetry,
  onReTranscribe
}) => {
  const [viewMode, setViewMode] = useState<'mindmap' | 'markdown'>('mindmap');
  const [style, setStyle] = useState<MindmapStyle>('modern');
  const [isCopied, setIsCopied] = useState(false);
  // error 状态保留，用于可能的扩展功能
  const [error] = useState<string | null>(null);

  // 处理键盘事件 - ESC 关闭
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // 检查是否需要显示错误状态
  const isErrorState = error && (
    mindmapData.errorMessage?.includes('失败') ||
    mindmapData.errorMessage?.includes('错误') ||
    mindmapData.errorMessage?.includes('超时') ||
    mindmapData.errorMessage?.includes('为空') ||
    mindmapData.mindmapMarkdown.trim().length === 0
  );

  // 检查markdown内容是否为空
  const rawMarkdown = mindmapData.mindmapMarkdown.trim();
  const hasValidContent = rawMarkdown.length > 0 && !mindmapData.errorMessage;

  // 清洗 Markdown 内容，去除包裹的代码块标记
  const cleanMarkdown = (md: string) => {
    let cleaned = md.trim();
    if (cleaned.startsWith('```markdown')) {
      cleaned = cleaned.replace(/^```markdown\n?/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n?/, '');
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.replace(/\n?```$/, '');
    }
    return cleaned.trim();
  };

  const markdown = cleanMarkdown(rawMarkdown);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], {
      type: 'text/markdown'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mindmapData.videoTitle}_思维导图.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'white',
        zIndex: 999999,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 内容区域 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto'
        }}
      >
          {viewMode === 'mindmap' ? (
            error && isErrorState ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100%',
                padding: '40px'
              }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '20px' }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <h3 style={{ color: '#991b1b', fontSize: '20px', margin: '0 0 15px', fontWeight: 600 }}>思维导图生成失败</h3>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '15px', maxWidth: '500px', width: '100%', marginBottom: '20px' }}>
                  <p style={{ color: '#991b1b', fontSize: '14px', lineHeight: '1.6', margin: 0 }}>{error}</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={onClose} style={{ padding: '10px 20px', border: '1px solid #d1d5db', borderRadius: '6px', background: 'white', color: '#374151', cursor: 'pointer', fontSize: '14px' }}>关闭</button>
                  {onRetry && <button onClick={onRetry} style={{ padding: '10px 20px', border: 'none', borderRadius: '6px', background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: '14px' }}>重新生成</button>}
                </div>
              </div>
            ) : error ? (
              <div style={{ color: '#ef4444', textAlign: 'center', padding: '40px' }}>
                <p style={{ fontSize: '16px', marginBottom: '20px' }}>{error}</p>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>点击下方工具栏切换视图</p>
              </div>
            ) : hasValidContent ? (
              <div style={{ width: '100%', height: '100%' }}>
                <MindmapRenderer
                  markdown={markdown}
                  styleName={style}
                  onNodeClick={(node) => { console.log('Node clicked:', node); }}
                  viewerActions={{
                    viewMode, setViewMode, style, setStyle,
                    onCopy: handleCopy, isCopied,
                    onDownload: handleDownload, onReTranscribe, onClose,
                    markdown, title: mindmapData.videoTitle
                  }}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: '40px' }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '20px' }}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <h3 style={{ color: '#374151', fontSize: '20px', margin: '0 0 15px', fontWeight: 600 }}>暂无思维导图内容</h3>
                <div style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '15px', maxWidth: '500px', width: '100%', marginBottom: '20px' }}>
                  <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: '1.6', margin: 0 }}>{mindmapData.errorMessage || '请先从字幕生成思维导图'}</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={onClose} style={{ padding: '10px 20px', border: '1px solid #d1d5db', borderRadius: '6px', background: 'white', color: '#374151', cursor: 'pointer', fontSize: '14px' }}>关闭</button>
                  {onRetry && <button onClick={onRetry} style={{ padding: '10px 20px', border: 'none', borderRadius: '6px', background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: '14px' }}>重新生成</button>}
                </div>
              </div>
            )
          ) : (
            <>
              <pre style={{ margin: 0, padding: '20px', background: '#f9fafb', fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordWrap: 'break-word', minHeight: '100%' }}>
                {markdown}
              </pre>
              {/* Markdown 视图底部工具栏 */}
              <div style={{
                position: 'fixed', bottom: '4px', left: '50%', transform: 'translateX(-50%)',
                display: 'flex', gap: '3px', padding: '4px 8px',
                background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)',
                borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                border: '1px solid rgba(226,232,240,0.5)', zIndex: 1000, alignItems: 'center'
              }}>
                <button onClick={() => setViewMode('mindmap')} style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc', color: '#334155', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>思维导图</button>
                <button onClick={handleCopy} style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', background: isCopied ? '#10b981' : '#f8fafc', color: isCopied ? '#fff' : '#334155', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>{isCopied ? '已复制' : '复制'}</button>
                <button onClick={handleDownload} style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc', color: '#334155', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>下载</button>
                <button onClick={onClose} style={{ padding: '4px 8px', border: '1px solid #fecaca', borderRadius: '6px', background: '#fee2e2', color: '#dc2626', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>关闭</button>
              </div>
            </>
          )}
        </div>
    </div>
  );
};