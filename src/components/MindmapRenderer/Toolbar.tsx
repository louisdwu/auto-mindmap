import React from 'react';
import { MindmapStyle } from '../../types/mindmap';
import {
  IconMindmap, IconMarkdown, IconCopy, IconCheck,
  IconDownload, IconPalette, IconRefresh
} from '../Icons';

export interface ViewerActions {
  viewMode: 'mindmap' | 'markdown';
  setViewMode: (mode: 'mindmap' | 'markdown') => void;
  style: MindmapStyle;
  setStyle: (style: MindmapStyle) => void;
  onCopy: () => void;
  isCopied: boolean;
  onDownload: () => void;
  onReTranscribe?: () => void;
  onClose?: () => void;
}

interface ToolbarProps {
  interactionMode: 'move' | 'zoom';
  setInteractionMode: (mode: 'move' | 'zoom') => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onReset: () => void;
  fontSizeBase: number;
  onFontSizeChange: (newSize: number) => void;
  viewerActions?: ViewerActions;
}

const styleOptions: { value: MindmapStyle; label: string }[] = [
  { value: 'modern', label: '现代简约' },
  { value: 'classic', label: '经典商务' },
  { value: 'dark', label: '极客深色' },
  { value: 'colorful', label: '活泼五彩' },
  { value: 'handdrawn', label: '趣味手绘' }
];

export const Toolbar: React.FC<ToolbarProps> = ({
  interactionMode,
  setInteractionMode,
  onExpandAll,
  onCollapseAll,
  onReset,
  fontSizeBase,
  onFontSizeChange,
  viewerActions
}) => {
  const [showStyleMenu, setShowStyleMenu] = React.useState(false);

  return (
    <>
      {/* 样式菜单遮罩 */}
      {showStyleMenu && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 99
          }}
          onClick={() => setShowStyleMenu(false)}
        />
      )}

      <div className="mm-toolbar">
        {/* Viewer 操作：视图切换、样式、复制、下载 */}
        {viewerActions && (
          <>
            <button
              onClick={() => viewerActions.setViewMode('mindmap')}
              className={viewerActions.viewMode === 'mindmap' ? 'active' : ''}
              data-title="思维导图视图"
            >
              <IconMindmap />
            </button>
            <button
              onClick={() => viewerActions.setViewMode('markdown')}
              className={viewerActions.viewMode === 'markdown' ? 'active' : ''}
              data-title="Markdown视图"
            >
              <IconMarkdown />
            </button>

            <div className="mm-toolbar-divider" style={{ width: '1px', height: '16px', background: '#e2e8f0', margin: '0 4px' }} />

            {/* 样式选择 */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowStyleMenu(!showStyleMenu)}
                data-title="切换样式"
              >
                <IconPalette />
              </button>
              {showStyleMenu && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '32px',
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
                        viewerActions.setStyle(option.value);
                        setShowStyleMenu(false);
                      }}
                      style={{
                        padding: '10px 16px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: viewerActions.style === option.value ? '#3b82f6' : '#374151',
                        background: viewerActions.style === option.value ? '#eff6ff' : 'transparent',
                        fontWeight: viewerActions.style === option.value ? 500 : 400,
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (viewerActions.style !== option.value) {
                          e.currentTarget.style.background = '#f3f4f6';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (viewerActions.style !== option.value) {
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

            {/* 复制 */}
            <button
              onClick={viewerActions.onCopy}
              className={viewerActions.isCopied ? 'copied' : ''}
              data-title={viewerActions.isCopied ? '已复制' : '复制Markdown'}
            >
              {viewerActions.isCopied ? <IconCheck /> : <IconCopy />}
            </button>

            {/* 下载 */}
            <button onClick={viewerActions.onDownload} data-title="下载Markdown">
              <IconDownload />
            </button>

            {/* 重新识别 */}
            {viewerActions.onReTranscribe && (
              <button onClick={viewerActions.onReTranscribe} data-title="重新生成">
                <IconRefresh />
              </button>
            )}

            <div className="mm-toolbar-divider" style={{ width: '1px', height: '14px', background: '#e2e8f0', margin: '0 2px' }} />
          </>
        )}

        {/* 原有的导图控制按钮 */}
        <button onClick={onExpandAll} data-title="展开所有节点">展开</button>
        <button onClick={onCollapseAll} data-title="折叠所有子节点">折叠</button>
        <button onClick={onReset} data-title="重置视图">重置</button>
        
        <div className="mm-toolbar-divider" style={{ width: '1px', height: '14px', background: '#e2e8f0', margin: '0 2px' }} />
        
        <div className="mm-font-size-controls" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button 
            onClick={() => onFontSizeChange(fontSizeBase - 0.1)} 
            data-title="减小字体大小"
            style={{ padding: '3px 6px', fontSize: '10px' }}
          >
            A-
          </button>
          <span style={{ fontSize: '10px', color: '#64748b', minWidth: '28px', textAlign: 'center' }}>
            {Math.round(fontSizeBase * 100)}%
          </span>
          <button 
            onClick={() => onFontSizeChange(fontSizeBase + 0.1)} 
            data-title="增大字体大小"
            style={{ padding: '3px 6px', fontSize: '10px' }}
          >
            A+
          </button>
        </div>

        <div className="mm-toolbar-divider" style={{ width: '1px', height: '14px', background: '#e2e8f0', margin: '0 2px' }} />
        
        <div className="mm-mode-toggle">
          <button 
            className={interactionMode === 'move' ? 'active' : ''} 
            onClick={() => setInteractionMode('move')}
            data-title="移动模式：滚轮平移画面"
          >
            移动
          </button>
          <button 
            className={interactionMode === 'zoom' ? 'active' : ''} 
            onClick={() => setInteractionMode('zoom')}
            data-title="缩放模式：滚轮放大缩小"
          >
            缩放
          </button>
        </div>
      </div>
    </>
  );
};
