import React, { useState, useEffect } from 'react';
import { LoggerService, LogEntry } from '../../services/loggerService';
import { PluginConfig } from '../../types/config';

interface LogSectionProps {
  config?: PluginConfig;
}

export const LogSection: React.FC<LogSectionProps> = ({ config }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterTaskId, setFilterTaskId] = useState('');
  const [taskIds, setTaskIds] = useState<string[]>([]);

  useEffect(() => {
    loadLogs();

    // 监听新日志消息
    const handleMessage = (message: any) => {
      if (message.type === 'LOG_ADDED' && autoRefresh) {
        setLogs(prev => {
          const newLogs = [message.payload, ...prev].slice(0, 500);
          updateTaskIds(newLogs);
          return newLogs;
        });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      
      // 退出时清空逻辑
      if (config?.settings.clearLogsOnClose) {
        LoggerService.clearLogs();
      }
    };
  }, [autoRefresh, config]);

  const loadLogs = async () => {
    const data = await LoggerService.getLogs();
    setLogs(data);
    updateTaskIds(data);
  };

  const updateTaskIds = (currentLogs: LogEntry[]) => {
    const ids = Array.from(new Set(currentLogs.map(l => l.taskId).filter(Boolean))) as string[];
    setTaskIds(ids);
  };

  const handleClear = async () => {
    await LoggerService.clearLogs();
    setLogs([]);
    setTaskIds([]);
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  const getTaskColor = (taskId: string | undefined) => {
    if (!taskId) return 'transparent';
    let hash = 0;
    for (let i = 0; i < taskId.length; i++) {
      hash = taskId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    return `hsla(${h}, 65%, 50%, 0.15)`;
  };

  const filteredLogs = filterTaskId 
    ? logs.filter(l => l.taskId === filterTaskId)
    : logs;

  return (
    <section className="options-section animate-fade-in">
      <div className="section-header flex-row">
        <h3>运行日志 (Running Logs)</h3>
        <div className="flex-row" style={{ gap: '12px' }}>
          {taskIds.length > 0 && (
            <select 
              className="form-input" 
              style={{ padding: '2px 8px', fontSize: '12px', width: 'auto', height: '28px' }}
              value={filterTaskId}
              onChange={e => setFilterTaskId(e.target.value)}
            >
              <option value="">全部任务</option>
              {taskIds.map(id => (
                <option key={id} value={id}>任务: {id.substring(0, 8)}</option>
              ))}
            </select>
          )}
          <label className="flex-row" style={{ fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input 
              type="checkbox" 
              checked={autoRefresh} 
              onChange={e => setAutoRefresh(e.target.checked)} 
            />
            自动刷新
          </label>
          <button className="btn--secondary-outline" onClick={loadLogs} style={{ padding: '4px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}>
            刷新
          </button>
          <button className="btn--danger-soft" onClick={handleClear} style={{ padding: '4px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}>
            清空
          </button>
        </div>
      </div>

      <div className="log-container">
        {filteredLogs.length === 0 ? (
          <div className="form-hint" style={{ textAlign: 'center', padding: '40px' }}>
            {filterTaskId ? '该任务暂无日志' : '暂无运行日志'}
          </div>
        ) : (
          <div className="log-list">
            {filteredLogs.map((log, index) => (
              <div 
                key={index} 
                className={`log-entry log-entry--${log.level}`}
                style={{ backgroundColor: getTaskColor(log.taskId) }}
              >
                <span className="log-time">[{formatTime(log.timestamp)}]</span>
                {log.taskId && (
                  <span className="log-task" title={log.taskId}>[Task:{log.taskId.substring(0, 8)}]</span>
                )}
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
          background: #0f172a;
          color: #e2e8f0;
          border-radius: 8px;
          height: 600px;
          overflow-y: auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12px;
          padding: 8px;
          border: 1px solid #1e293b;
        }
        .log-entry {
          margin-bottom: 2px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-all;
          padding: 4px 8px;
          border-radius: 4px;
          transition: background-color 0.2s;
        }
        .log-entry:hover {
          background-color: rgba(255,255,255,0.05) !important;
        }
        .log-entry--error { color: #f87171; border-left: 3px solid #f87171; }
        .log-entry--warn { color: #fbbf24; border-left: 3px solid #fbbf24; }
        .log-entry--info { color: #60a5fa; border-left: 3px solid #60a5fa; }
        .log-entry--debug { color: #94a3b8; border-left: 3px solid #94a3b8; }
        
        .log-time { color: #64748b; margin-right: 8px; font-variant-numeric: tabular-nums; }
        .log-task { color: #94a3b8; margin-right: 8px; font-weight: bold; opacity: 0.8; }
        .log-module { color: #818cf8; margin-right: 8px; font-weight: bold; }
        .log-level { margin-right: 8px; font-weight: bold; width: 45px; display: inline-block; }
        .log-message { color: #f1f5f9; }
        .log-data {
          display: block;
          margin-top: 4px;
          padding: 8px;
          background: rgba(0,0,0,0.3);
          border-radius: 4px;
          font-size: 11px;
          color: #94a3b8;
          max-height: 300px;
          overflow: auto;
          border: 1px solid rgba(255,255,255,0.05);
        }
      `}} />
    </section>
  );
};

