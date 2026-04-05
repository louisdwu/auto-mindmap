import React, { useState } from 'react';
import { MindmapRenderer } from './MindmapRenderer';
import { MindmapStyle } from '../types/mindmap';
import { 
  IconMindmap, IconMarkdown, IconCopy, IconCheck, 
  IconDownload, IconClose, IconRefresh, IconPalette 
} from './Icons';

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
  const [showStyleMenu, setShowStyleMenu] = useState(false);
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

  const styleOptions: { value: MindmapStyle; label: string }[] = [
    { value: 'modern', label: '现代简约' },
    { value: 'classic', label: '经典商务' },
    { value: 'dark', label: '极客深色' },
    { value: 'colorful', label: '活泼五彩' },
    { value: 'handdrawn', label: '趣味手绘' }
  ];

  // 图标按钮样式
  const iconButtonStyle: React.CSSProperties = {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.9)',
    color: '#374151',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
  };

  const iconButtonActiveStyle: React.CSSProperties = {
    ...iconButtonStyle,
    background: '#3b82f6',
    color: 'white'
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
      {/* 左上角工具栏 */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          zIndex: 1000,
          padding: '8px',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.5)'
        }}
      >
        {/* 视图切换 - 思维导图 */}
        <button
          onClick={() => setViewMode('mindmap')}
          style={viewMode === 'mindmap' ? iconButtonActiveStyle : iconButtonStyle}
          title="思维导图视图"
        >
          <IconMindmap />
        </button>

        {/* 视图切换 - Markdown */}
        <button
          onClick={() => setViewMode('markdown')}
          style={viewMode === 'markdown' ? iconButtonActiveStyle : iconButtonStyle}
          title="Markdown视图"
        >
          <IconMarkdown />
        </button>

        {/* 分隔线 */}
        <div style={{ width: '1px', height: '24px', background: '#e5e7eb', margin: '0 4px' }} />

        {/* 样式选择（仅在思维导图模式下显示） */}
        {viewMode === 'mindmap' && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowStyleMenu(!showStyleMenu)}
              style={iconButtonStyle}
              title="切换样式"
            >
              <IconPalette />
            </button>
            {showStyleMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '44px',
                  left: '0',
                  background: 'white',
                  borderRadius: '8px',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                  border: '1px solid #e5e7eb',
                  overflow: 'hidden',
                  minWidth: '120px'
                }}
              >
                {styleOptions.map((option) => (
                  <div
                    key={option.value}
                    onClick={() => {
                      setStyle(option.value);
                      setShowStyleMenu(false);
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: style === option.value ? '#3b82f6' : '#374151',
                      background: style === option.value ? '#eff6ff' : 'transparent',
                      fontWeight: style === option.value ? 500 : 400,
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      if (style !== option.value) {
                        e.currentTarget.style.background = '#f3f4f6';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (style !== option.value) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    {option.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 复制按钮 */}
        <button
          onClick={handleCopy}
          style={isCopied ? { ...iconButtonStyle, background: '#10b981', color: 'white' } : iconButtonStyle}
          title={isCopied ? '已复制' : '复制Markdown'}
        >
          {isCopied ? <IconCheck /> : <IconCopy />}
        </button>

        {/* 下载按钮 */}
        <button
          onClick={handleDownload}
          style={iconButtonStyle}
          title="下载Markdown文件"
        >
          <IconDownload />
        </button>

        {/* 重新识别按钮 */}
        {onReTranscribe && (
          <button
            onClick={onReTranscribe}
            style={iconButtonStyle}
            title="强制重新语音识别 (清除缓存)"
          >
            <IconRefresh />
          </button>
        )}
      </div>

      {/* 右上角关闭按钮 */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 1000,
        }}
      >
        <button
          onClick={onClose}
          style={{
            ...iconButtonStyle,
            background: '#fee2e2',
            color: '#dc2626',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.5)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#fecaca';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fee2e2';
          }}
          title="关闭"
        >
          <IconClose />
        </button>
      </div>

      {/* 点击遮罩关闭样式菜单 */}
      {showStyleMenu && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={() => setShowStyleMenu(false)}
        />
      )}

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
                {/* 错误图标 */}
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginBottom: '20px' }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                
                <h3 style={{
                  color: '#991b1b',
                  fontSize: '20px',
                  margin: '0 0 15px',
                  fontWeight: 600
                }}>
                  思维导图生成失败
                </h3>
                
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '15px',
                  maxWidth: '500px',
                  width: '100%',
                  marginBottom: '20px'
                }}>
                  <p style={{
                    color: '#991b1b',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    margin: 0
                  }}>
                    {error}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={onClose}
                    style={{
                      padding: '10px 20px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      background: 'white',
                      color: '#374151',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    关闭
                  </button>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      style={{
                        padding: '10px 20px',
                        border: 'none',
                        borderRadius: '6px',
                        background: '#3b82f6',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      重新生成
                    </button>
                  )}
                </div>

                {/* 建议信息 */}
                <div style={{
                  marginTop: '30px',
                  padding: '15px',
                  background: '#f3f4f6',
                  borderRadius: '8px',
                  maxWidth: '500px',
                  width: '100%'
                }}>
                  <h4 style={{
                    color: '#374151',
                    fontSize: '14px',
                    margin: '0 0 10px',
                    fontWeight: 600
                  }}>
                    可能的解决方案：
                  </h4>
                  <ul style={{
                    color: '#6b7280',
                    fontSize: '13px',
                    lineHeight: '1.8',
                    margin: 0,
                    paddingLeft: '20px'
                  }}>
                    <li>检查API密钥和API地址配置是否正确</li>
                    <li>确认网络连接是否正常</li>
                    <li>稍后重试，可能是API服务暂时不可用</li>
                    <li>尝试简化字幕内容后重新生成</li>
                  </ul>
                </div>
              </div>
            ) : error ? (
              <div style={{ color: '#ef4444', textAlign: 'center', padding: '40px' }}>
                <p style={{ fontSize: '16px', marginBottom: '20px' }}>{error}</p>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>
                  点击上方的"Markdown"按钮可查看原文
                </p>
              </div>
            ) : hasValidContent ? (
              <div style={{ width: '100%', height: '100%' }}>
                <MindmapRenderer
                  markdown={markdown}
                  styleName={style}
                  onNodeClick={(node) => {
                    console.log('Node clicked:', node);
                  }}
                />
              </div>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100%',
                padding: '40px'
              }}>
                {/* 空状态图标 */}
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginBottom: '20px' }}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                
                <h3 style={{
                  color: '#374151',
                  fontSize: '20px',
                  margin: '0 0 15px',
                  fontWeight: 600
                }}>
                  暂无思维导图内容
                </h3>
                
                <div style={{
                  background: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '15px',
                  maxWidth: '500px',
                  width: '100%',
                  marginBottom: '20px'
                }}>
                  <p style={{
                    color: '#6b7280',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    margin: 0
                  }}>
                    {mindmapData.errorMessage || '请先从字幕生成思维导图'}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={onClose}
                    style={{
                      padding: '10px 20px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      background: 'white',
                      color: '#374151',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    关闭
                  </button>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      style={{
                        padding: '10px 20px',
                        border: 'none',
                        borderRadius: '6px',
                        background: '#3b82f6',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      重新生成
                    </button>
                  )}
                </div>
              </div>
            )
          ) : (
            <pre
              style={{
                margin: 0,
                padding: '20px',
                background: '#f9fafb',
                fontSize: '14px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                minHeight: '100%'
              }}
            >
              {markdown}
            </pre>
          )}
        </div>
    </div>
  );
};