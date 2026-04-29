import React, { useState, useEffect } from 'react';
import { LoggerService, LogEntry } from '../../services/loggerService';

export const LogSection: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadLogs();

    // 监听新日志消息
    const handleMessage = (message: any) => {
      if (message.type === 'LOG_ADDED' && autoRefresh) {
        setLogs(prev => [message.payload, ...prev].slice(0, 500));
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [autoRefresh]);

  const loadLogs = async () => {
    const data = await LoggerService.getLogs();
    setLogs(data);
  };

  const handleClear = async () => {
    await LoggerService.clearLogs();
    setLogs([]);
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  return (
    <section className="options-section animate-fade-in">
      <div className="section-header flex-row">
        <h3>运行日志 (Running Logs)</h3>
        <div className="flex-row" style={{ gap: '12px' }}>
          <label className="flex-row" style={{ fontSize: '13px', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={autoRefresh} 
              onChange={e => setAutoRefresh(e.target.checked)} 
            />
            自动刷新
          </label>
          <button className="btn--secondary-outline" onClick={loadLogs} style={{ padding: '4px 12px', fontSize: '12px' }}>
            刷新
          </button>
          <button className="btn--danger-soft" onClick={handleClear} style={{ padding: '4px 12px', fontSize: '12px' }}>
            清空
          </button>
        </div>
      </div>

      <div className="log-container">
        {logs.length === 0 ? (
          <div className="form-hint" style={{ textAlign: 'center', padding: '40px' }}>暂无运行日志</div>
        ) : (
          <div className="log-list">
            {logs.map((log, index) => (
              <div key={index} className={`log-entry log-entry--${log.level}`}>
                <span className="log-time">[{formatTime(log.timestamp)}]</span>
                <span className="log-module">[{log.module}]</span>
                <span className="log-level">{log.level.toUpperCase()}</span>
                <span className="log-message">{log.message}</span>
                {log.data && (
                  <pre className="log-data">
                    {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .log-container {
          background: #1e293b;
          color: #e2e8f0;
          border-radius: 8px;
          height: 500px;
          overflow-y: auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12px;
          padding: 12px;
          border: 1px solid #334155;
        }
        .log-entry {
          margin-bottom: 4px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-all;
          border-bottom: 1px solid #334155;
          padding-bottom: 4px;
        }
        .log-entry--error { color: #f87171; }
        .log-entry--warn { color: #fbbf24; }
        .log-entry--info { color: #60a5fa; }
        .log-entry--debug { color: #94a3b8; }
        
        .log-time { color: #94a3b8; margin-right: 8px; }
        .log-module { color: #818cf8; margin-right: 8px; font-weight: bold; }
        .log-level { margin-right: 8px; font-weight: bold; width: 50px; display: inline-block; }
        .log-message { color: #f1f5f9; }
        .log-data {
          display: block;
          margin-top: 4px;
          padding: 8px;
          background: rgba(0,0,0,0.2);
          border-radius: 4px;
          font-size: 11px;
          color: #94a3b8;
          max-height: 200px;
          overflow: auto;
        }
      `}} />
    </section>
  );
};
