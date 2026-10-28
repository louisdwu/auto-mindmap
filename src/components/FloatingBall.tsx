import React, { useState } from 'react';
import {
  buildSubtitleFileName,
  copyTextToClipboard,
  downloadTextFile
} from '../utils/subtitleExport';

interface FloatingBallProps {
  showNotification: boolean;
  currentTask?: {
    type: string;
    status: string;
    videoTitle?: string;
    errorMessage?: string;
    statusMessage?: string;
    subtitleText?: string;
    subtitleOnly?: boolean;
  };
  onClick: () => void;
  /** 菜单：仅获取字幕，不生成思维导图 */
  onRightClick?: () => void;
  /** 菜单：重新语音识别（跳过官方字幕与缓存） */
  onReTranscribeAsr?: () => void;
  /** 菜单：取消当前活跃任务 */
  onCancelTask?: () => void;
  isFullscreen: boolean;
  onToast?: (message: string, duration?: number) => void;
}

interface MenuActionProps {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
}

/** 右键菜单里的一行操作 */
const MenuAction: React.FC<MenuActionProps> = ({ icon, label, hint, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        width: '100%',
        padding: '8px 10px',
        border: 'none',
        borderRadius: '8px',
        background: hovered ? '#f1f5f9' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left'
      }}
    >
      <span style={{ fontSize: '15px', lineHeight: '18px' }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{label}</span>
        <span style={{ fontSize: '11px', color: '#64748b' }}>{hint}</span>
      </span>
    </button>
  );
};

export const FloatingBall: React.FC<FloatingBallProps> = ({
  showNotification,
  currentTask,
  onClick,
  onRightClick,
  onReTranscribeAsr,
  onCancelTask,
  isFullscreen,
  onToast
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopySubtitle = async (text: string) => {
    const success = await copyTextToClipboard(text);
    if (success) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
      onToast?.(`✅ 已复制字幕原文本（共 ${text.length} 字）`);
    } else {
      onToast?.('❌ 复制失败，请在预览框中手动选中文本复制');
    }
  };

  const handleDownloadSubtitle = (text: string, title?: string) => {
    const success = downloadTextFile(text, buildSubtitleFileName(title));
    onToast?.(success ? '📥 字幕文件已开始下载' : '❌ 下载失败，请直接复制文本');
  };

  const isFailed = currentTask?.status === 'failed';
  const isCancelled = currentTask?.status === 'cancelled';
  const background = isFailed
    ? 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)'
    : isCancelled
      ? 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)'
      : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

  const getTaskDescription = () => {
    if (!currentTask) return '暂无任务';
    
    const typeMap: Record<string, string> = {
      'download_subtitle': currentTask.subtitleOnly ? '仅获取字幕' : '获取字幕',
      'generate_mindmap': '生成思维导图'
    };
    
    let typeText = typeMap[currentTask.type] || currentTask.type;
    
    // 识别 ASR 状态：如果是在获取字幕阶段，且消息包含识别相关字样，则显示为“语音识别”
    if (currentTask.type === 'download_subtitle') {
      const msg = currentTask.statusMessage || '';
      if (msg.includes('识别') || msg.includes('ASR') || msg.includes('语音')) {
        typeText = '语音识别';
      }
    }
    const statusMap: Record<string, { text: string; color: string }> = {
      'pending': { text: '等待中', color: '#f39c12' },
      'running': { text: '进行中', color: '#27ae60' },
      'completed': { text: '已完成', color: '#3498db' },
      'failed': { text: '失败', color: '#e74c3c' },
      'cancelled': { text: '已取消', color: '#94a3b8' }
    };

    const statusInfo = statusMap[currentTask.status] || { text: currentTask.status, color: '#95a5a6' };

    return (
      <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
        <div style={{ fontWeight: 500, marginBottom: '4px' }}>{typeText}</div>
        <div style={{ color: statusInfo.color, fontSize: '12px' }}>
          {currentTask.status === 'running' && currentTask.statusMessage 
            ? currentTask.statusMessage 
            : statusInfo.text}
        </div>
        {isFailed && currentTask.errorMessage && (
          <div style={{
            color: '#f39c12',
            fontSize: '11px',
            marginTop: '6px',
            maxWidth: '220px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {currentTask.subtitleText ? '点击复制字幕 / 查看详情' : '点击查看详情'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => {
          if (isFailed && currentTask?.errorMessage) {
            setShowErrorModal(true);
          } else {
            onClick();
          }
        }}
        onContextMenu={(e) => {
          // 右键：弹出操作菜单（仅获取字幕 / 重新语音识别）
          e.preventDefault();
          e.stopPropagation();
          setShowMenu(true);
          setShowTooltip(false);
        }}
        title="左键：生成思维导图 · 右键：获取字幕 / 重新语音识别 / 取消任务"
        onMouseEnter={(e) => {
          setShowTooltip(true);
          e.currentTarget.style.transform = 'scale(1.1)';
          e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.4)';
        }}
        onMouseLeave={(e) => {
          setShowTooltip(false);
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)';
        }}
        style={{
          position: 'fixed',
          bottom: '30px',
          left: '30px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: background,
          boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
          cursor: 'pointer',
          zIndex: 999998,
          display: isFullscreen ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.2s, box-shadow 0.2s'
        }}
      >
        {/* 图标 */}
        {isFailed ? (
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ) : (
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        )}

        {/* 红点提醒 */}
        {showNotification && (
          <div
            style={{
              position: 'absolute',
              top: '5px',
              right: '5px',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: '#ff4757',
              border: '2px solid white',
              animation: 'pulse 2s infinite'
            }}
          />
        )}

        <style>{`
          @keyframes pulse {
            0%, 100% {
              transform: scale(1);
              opacity: 1;
            }
            50% {
              transform: scale(1.2);
              opacity: 0.8;
            }
          }
        `}</style>
      </div>

      {/* 右键操作菜单 */}
      {showMenu && !isFullscreen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999999, background: 'transparent' }}
            onClick={() => setShowMenu(false)}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowMenu(false);
            }}
          />
          <div
            style={{
              position: 'fixed',
              bottom: '100px',
              left: '30px',
              zIndex: 1000000,
              minWidth: '228px',
              padding: '6px',
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.22)',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}
          >
            {(currentTask?.status === 'running' || currentTask?.status === 'pending') && onCancelTask && (
              <MenuAction
                icon="🛑"
                label="取消当前任务"
                hint="停止字幕下载 / 语音识别 / 导图生成"
                onClick={() => {
                  setShowMenu(false);
                  onCancelTask();
                }}
              />
            )}
            <MenuAction
              icon="📝"
              label="获取字幕"
              hint="只提取字幕，不生成导图"
              onClick={() => {
                setShowMenu(false);
                onRightClick?.();
              }}
            />
            <MenuAction
              icon="🎙️"
              label="重新语音识别"
              hint="跳过官方字幕与缓存，重跑 ASR"
              onClick={() => {
                setShowMenu(false);
                onReTranscribeAsr?.();
              }}
            />
          </div>
        </>
      )}

      {/* 悬浮提示 */}
      {showTooltip && !isFullscreen && (
        <div
          style={{
            position: 'fixed',
            bottom: '100px',
            left: '30px',
            background: 'rgba(0, 0, 0, 0.85)',
            color: 'white',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            zIndex: 999999,
            minWidth: '180px',
            maxWidth: '320px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            animation: 'fadeIn 0.2s ease-out',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {getTaskDescription()}
          {!isFailed && (
            <div
              style={{
                marginTop: '8px',
                paddingTop: '8px',
                borderTop: '1px solid rgba(255, 255, 255, 0.2)',
                color: 'rgba(255, 255, 255, 0.72)',
                fontSize: '11px',
                lineHeight: '1.6'
              }}
            >
              左键：生成思维导图 · 右键：获取字幕 / 重新语音识别
            </div>
          )}
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(5px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}

      {/* 错误详情弹窗 */}
      {showErrorModal && !isFullscreen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setShowErrorModal(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '440px',
              width: '92%',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '15px',
              color: '#e74c3c'
            }}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: '10px' }}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h3 style={{ margin: 0, fontSize: '18px' }}>
                {currentTask?.subtitleOnly ? '字幕获取失败' : '任务失败'}
              </h3>
            </div>

            {/* 针对 429 额度耗尽的特别提示（仅字幕模式不涉及 LLM） */}
            {!currentTask?.subtitleOnly && (currentTask?.errorMessage?.includes('429') ||
              currentTask?.errorMessage?.includes('entitlement exhausted') ||
              currentTask?.errorMessage?.includes('quota')) && (
              <div style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                padding: '10px 12px',
                color: '#92400e',
                fontSize: '12px',
                lineHeight: '1.5',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span style={{ fontSize: '14px' }}>💡</span>
                <span>大模型 API 配额已用尽或请求受限 (HTTP 429)。字幕原文本已保留在下方，可一键复制使用。</span>
              </div>
            )}

            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '12px',
              color: '#991b1b',
              fontSize: '13px',
              lineHeight: '1.6',
              marginBottom: currentTask?.subtitleText ? '12px' : '15px',
              maxHeight: '100px',
              overflowY: 'auto',
              wordBreak: 'break-word'
            }}>
              {currentTask?.errorMessage || '未知错误'}
            </div>

            {/* 字幕原文本预览与复制卡片 */}
            {currentTask?.subtitleText && (
              <div style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '15px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '14px' }}>📝</span>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#166534' }}>
                      视频字幕原文本
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: '#15803d',
                      background: '#dcfce7',
                      padding: '1px 6px',
                      borderRadius: '4px'
                    }}>
                      共 {currentTask.subtitleText.length} 字
                    </span>
                  </div>
                  <button
                    onClick={() => handleDownloadSubtitle(currentTask.subtitleText!, currentTask.videoTitle)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#15803d',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      textDecoration: 'underline'
                    }}
                    title="下载为 .txt 文件"
                  >
                    下载 .txt
                  </button>
                </div>

                {/* 文本预览 */}
                <div style={{
                  maxHeight: '80px',
                  overflowY: 'auto',
                  background: 'white',
                  border: '1px solid #dcfce7',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: '#374151',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  marginBottom: '10px'
                }}>
                  {currentTask.subtitleText.slice(0, 300)}
                  {currentTask.subtitleText.length > 300 ? '...' : ''}
                </div>

                {/* 一键复制按钮 */}
                <button
                  onClick={() => handleCopySubtitle(currentTask.subtitleText!)}
                  style={{
                    width: '100%',
                    padding: '8px 14px',
                    border: 'none',
                    borderRadius: '6px',
                    background: isCopied ? '#10b981' : '#16a34a',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.2s',
                    boxShadow: isCopied ? '0 2px 6px rgba(16, 185, 129, 0.4)' : '0 2px 6px rgba(22, 163, 74, 0.3)'
                  }}
                >
                  {isCopied ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      ✓ 已复制字幕原文本到剪贴板！
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      📋 复制字幕原文本
                    </>
                  )}
                </button>
              </div>
            )}

            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px'
            }}>
              <button
                onClick={() => setShowErrorModal(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  background: 'white',
                  color: '#374151',
                  cursor: 'pointer'
                }}
              >
                关闭
              </button>
              <button
                onClick={() => {
                  setShowErrorModal(false);
                  if (currentTask?.subtitleOnly) {
                    onRightClick?.();
                  } else {
                    onClick();
                  }
                }}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '6px',
                  background: '#3b82f6',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                {currentTask?.subtitleOnly ? '重新获取字幕' : '重新生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};