import { useState, useEffect } from 'react';
import { StatsService } from '../../services/statsService';
import { AppStats, DEFAULT_STATS } from '../../types/stats';
import { LLMConfig } from '../../types/config';

interface StatsSectionProps {
  llmConfigs: LLMConfig[];
}

export function StatsSection({ llmConfigs }: StatsSectionProps) {
  const [stats, setStats] = useState<AppStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const data = await StatsService.getStats();
    setStats(data);
    setLoading(false);
  };

  const handleClearStats = async () => {
    if (!confirm('确定要清空所有统计数据吗？')) return;
    await StatsService.clearStats();
    setStats(DEFAULT_STATS);
  };

  if (loading) {
    return <div className="options-section">加载中...</div>;
  }

  // 计算反思成功率
  const reflectionSuccessRate = stats.totalGenerations > 0 
    ? Math.round((stats.reflectionSuccessCount / stats.totalGenerations) * 100) 
    : 0;

  return (
    <div className="stats-container animate-fade-in">
      <div className="content-header">
        <h1>数据统计</h1>
        <p className="form-hint">回顾你的知识挖掘历程</p>
      </div>

      <div className="stats-grid">
        <div className="stats-card">
          <span className="stats-card__label">累计处理视频</span>
          <span className="stats-card__value">{stats.totalVideos}</span>
          <span className="stats-card__sub">个 unique 视频源</span>
        </div>
        <div className="stats-card">
          <span className="stats-card__label">累计生成导图</span>
          <span className="stats-card__value">{stats.totalGenerations}</span>
          <span className="stats-card__sub">次思维导图构建</span>
        </div>
        <div className="stats-card">
          <span className="stats-card__label">反思直通率</span>
          <span className="stats-card__value">{reflectionSuccessRate}%</span>
          <div className="stats-progress-container">
            <div className="stats-progress-bar">
              <div className="stats-progress-fill" style={{ width: `${reflectionSuccessRate}%` }}></div>
            </div>
            <span className="stats-card__sub">初稿即优秀的比例</span>
          </div>
        </div>
      </div>

      <div className="options-section">
        <h2>🤖 模型使用统计</h2>
        <div className="stats-list">
          {Object.entries(stats.modelUsage).length === 0 ? (
            <p className="form-hint">暂无模型使用记录</p>
          ) : (
            Object.entries(stats.modelUsage).sort((a, b) => b[1].count - a[1].count).map(([id, usage]) => {
              const config = llmConfigs.find(c => c.id === id);
              const successRate = usage.count > 0 ? Math.round((usage.success / usage.count) * 100) : 0;
              return (
                <div key={id} className="stats-list-item">
                  <div className="flex-1">
                    <div style={{ fontWeight: 700, fontSize: '15px' }}>
                      {config?.name || id} 
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
                        {config?.model || '未知模型'}
                      </span>
                    </div>
                    <div className="form-hint">
                      使用 {usage.count} 次 · 成功 {usage.success} 次 · 失败 {usage.failure} 次
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: successRate > 90 ? '#10b981' : successRate > 70 ? '#f59e0b' : '#ef4444' }}>
                      {successRate}% 成功率
                    </div>
                    <div className="stats-progress-container" style={{ width: '100px', marginTop: '4px' }}>
                      <div className="stats-progress-bar" style={{ height: '4px' }}>
                        <div 
                          className="stats-progress-fill" 
                          style={{ 
                            width: `${successRate}%`,
                            background: successRate > 90 ? '#10b981' : successRate > 70 ? '#f59e0b' : '#ef4444'
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="danger-zone" style={{ marginTop: '40px' }}>
        <div className="danger-zone__title">
          <span>⚠️ 危险区域</span>
        </div>
        <div className="danger-zone__content">
          <div className="flex-row">
            <div className="flex-1">
              <div style={{ fontWeight: 600 }}>重置统计数据</div>
              <div className="form-hint">删除所有本地记录的统计数据，此操作无法恢复。</div>
            </div>
            <button className="btn--danger-soft" onClick={handleClearStats}>
              清空统计
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
