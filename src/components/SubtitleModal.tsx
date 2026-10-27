import React, { useEffect, useState } from 'react';
import { SubtitleResultData } from '../types/subtitle';
import {
  buildSubtitleFileName,
  copyTextToClipboard,
  downloadTextFile
} from '../utils/subtitleExport';

interface SubtitleModalProps {
  data: SubtitleResultData;
  onClose: () => void;
  onToast?: (message: string, duration?: number) => void;
}

/**
 * 仅字幕模式的结果面板
 *
 * 只展示字幕原文本，提供「复制全文」与「下载 .txt」两个出口，
 * 不进入思维导图查看器，避免用户被迫等待 LLM 生成。
 */
export const SubtitleModal: React.FC<SubtitleModalProps> = ({ data, onClose, onToast }) => {
  const [isCopied, setIsCopied] = useState(false);

  const { subtitleText, videoTitle, isAsr } = data;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    const success = await copyTextToClipboard(subtitleText);
    if (success) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
      onToast?.(`✅ 已复制字幕原文本（共 ${subtitleText.length} 字）`);
    } else {
      onToast?.('❌ 复制失败，请在预览框中手动选中文本复制');
    }
  };

  const handleDownload = () => {
    const success = downloadTextFile(subtitleText, buildSubtitleFileName(videoTitle));
    onToast?.(success ? '📥 字幕文件已开始下载' : '❌ 下载失败，请改用复制');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="视频字幕"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        boxSizing: 'border-box'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.35)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '18px 20px 14px',
            borderBottom: '1px solid #e2e8f0'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
              <span>📝</span>
              <span>视频字幕</span>
            </div>
            {videoTitle && (
              <div
                style={{
                  marginTop: '6px',
                  fontSize: '13px',
                  color: '#64748b',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={videoTitle}
              >
                {videoTitle}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: '#1d4ed8', background: '#dbeafe', padding: '2px 8px', borderRadius: '999px' }}>
                共 {subtitleText.length} 字
              </span>
              <span style={{ fontSize: '11px', color: '#047857', background: '#d1fae5', padding: '2px 8px', borderRadius: '999px' }}>
                {isAsr ? '🎤 ASR 语音识别' : '官方 / 页面字幕'}
              </span>
              {data.savedToFile && (
                <span style={{ fontSize: '11px', color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: '999px' }}>
                  已保存到下载目录
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            style={{
              flexShrink: 0,
              width: '30px',
              height: '30px',
              border: 'none',
              borderRadius: '8px',
              background: '#f1f5f9',
              color: '#475569',
              fontSize: '16px',
              lineHeight: 1,
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>

        {/* 字幕预览 */}
        <pre
          style={{
            flex: 1,
            minHeight: '160px',
            margin: 0,
            padding: '16px 20px',
            overflowY: 'auto',
            background: '#f8fafc',
            color: '#1e293b',
            fontSize: '13px',
            lineHeight: 1.75,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          }}
        >
          {subtitleText}
        </pre>

        {/* 操作区 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 20px',
            borderTop: '1px solid #e2e8f0',
            background: 'white'
          }}
        >
          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 16px',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              background: isCopied ? '#ecfdf5' : 'white',
              color: isCopied ? '#047857' : '#334155',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            {isCopied ? '✓ 已复制' : '📋 复制全文'}
          </button>
          <button
            onClick={handleDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 18px',
              border: 'none',
              borderRadius: '8px',
              background: '#2563eb',
              color: 'white',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)'
            }}
          >
            📥 下载 .txt
          </button>
        </div>
      </div>
    </div>
  );
};
