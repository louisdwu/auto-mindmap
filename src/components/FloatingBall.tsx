import React, { useState } from 'react';

interface FloatingBallProps {
  showNotification: boolean;
  currentTask?: {
    type: string;
    status: string;
    videoTitle?: string;
    errorMessage?: string;
  };
  onClick: () => void;
}

export const FloatingBall: React.FC<FloatingBallProps> = ({
  showNotification,
  currentTask,
  onClick
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  const isFailed = currentTask?.status === 'failed';
  const background = isFailed
    ? 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)'
    : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

  const getTaskDescription = () => {
    if (!currentTask) return '暂无任务';
    
    const typeMap: Record<string, string> = {
      'download_subtitle': '下载字幕',
      'generate_mindmap': '生成思维导图'
    };
    
    const statusMap: Record<string, { text: string; color: string }> = {
      'pending': { text: '等待中', color: '#f39c12' },
      'running': { text: '进行中', color: '#27ae60' },
      'completed': { text: '已完成', color: '#3498db' },
      'failed': { text: '失败', color: '#e74c3c' }
    };

    const typeText = typeMap[currentTask.type] || currentTask.type;
    const statusInfo = statusMap[currentTask.status] || { text: currentTask.status, color: '#95a5a6' };

    return (
      <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
        <div style={{ fontWeight: 500, marginBottom: '4px' }}>{typeText}</div>
        <div style={{ color: statusInfo.color, fontSize: '12px' }}>{statusInfo.text}</div>
        {isFailed && currentTask.errorMessage && (
          <div style={{
            color: '#f39c12',
            fontSize: '11px',
            marginTop: '6px',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            点击查看详情
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
          display: 'flex',
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

      {/* 悬浮提示 */}
      {showTooltip && (
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
            maxWidth: '280px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          {getTaskDescription()}
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(5px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}

      {/* 错误详情弹窗 */}
      {showErrorModal && (
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
              maxWidth: '400px',
              width: '90%',
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
              <h3 style={{ margin: 0, fontSize: '18px' }}>任务失败</h3>
            </div>
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '12px',
              color: '#991b1b',
              fontSize: '14px',
              lineHeight: '1.6',
              marginBottom: '15px'
            }}>
              {currentTask?.errorMessage || '未知错误'}
            </div>
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
                  onClick();
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
                重新生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};