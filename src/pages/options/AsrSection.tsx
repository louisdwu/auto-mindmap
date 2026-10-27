import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ASR_LANGUAGE_OPTIONS, PluginConfig, normalizeAsrLanguage } from '../../types/config';

interface AsrSectionProps {
  config: PluginConfig;
  onConfigChange: (config: PluginConfig) => void;
}

/** 从 localAsrUrl（如 http://localhost:2233/transcribe）取服务 origin。 */
function asrOrigin(localAsrUrl: string): string {
  const url = (localAsrUrl || '').trim();
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/[^/]*$/, '');
  }
}

interface HealthInfo {
  status: string;
  model_loaded: boolean;
  in_flight: number;
  idle_seconds: number;
  idle_unload_sec: number;
  engine?: string;
  device?: string;
}

export const AsrSection: React.FC<AsrSectionProps> = ({ config, onConfigChange }) => {
  const isEnabled = config.settings.asrProvider === 'local';
  const origin = useMemo(() => asrOrigin(config.settings.localAsrUrl), [config.settings.localAsrUrl]);

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [unloading, setUnloading] = useState(false);
  const [unloadMsg, setUnloadMsg] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!origin) {
      setHealth(null);
      setHealthError('未配置服务地址');
      return;
    }
    try {
      const res = await fetch(`${origin}/health`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as HealthInfo;
      setHealth(data);
      setHealthError(null);
    } catch (e: any) {
      setHealth(null);
      setHealthError(e?.message || '连接失败');
    }
  }, [origin]);

  useEffect(() => {
    if (!isEnabled) {
      setHealth(null);
      setHealthError(null);
      return;
    }
    fetchHealth();
    const id = setInterval(fetchHealth, 5000);
    return () => clearInterval(id);
  }, [isEnabled, fetchHealth]);

  const handleUnload = useCallback(async () => {
    if (!origin || unloading) return;
    setUnloading(true);
    setUnloadMsg(null);
    try {
      const res = await fetch(`${origin}/unload`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUnloadMsg(
        data.unloaded
          ? '已释放显存，下次识别将自动重新加载。'
          : '无需释放（模型未加载或正在推理中）。'
      );
      await fetchHealth();
    } catch (e: any) {
      setUnloadMsg('释放失败：' + (e?.message || '连接失败'));
    } finally {
      setUnloading(false);
      setTimeout(() => setUnloadMsg(null), 4000);
    }
  }, [origin, unloading, fetchHealth]);

  const dotColor = healthError ? '#ef4444' : health?.model_loaded ? '#10b981' : '#94a3b8';
  const statusText = healthError
    ? `连接失败：${healthError}（请先启动服务 ${origin || '—'}）`
    : health?.model_loaded
      ? '模型已加载（占用显存）'
      : '模型未加载（显存空闲，首次识别会自动加载）';
  const canUnload = !healthError && health?.model_loaded === true;

  return (
    <div className="asr-container animate-fade-in">
      <section className="options-section">
        <label className="form-label--large">语音识别状态</label>
        <div className="selection-cards">
          <div
            className={`selection-card ${!isEnabled ? 'selection-card--active' : ''}`}
            onClick={() => onConfigChange({
              ...config,
              settings: { ...config.settings, asrProvider: 'official' }
            })}
          >
            <div className="selection-card__title">
              <span>🔇</span> 关闭
            </div>
            <div className="selection-card__desc">
              仅使用视频原有的官方字幕或自动生成的字幕。
            </div>
          </div>

          <div
            className={`selection-card ${isEnabled ? 'selection-card--active' : ''}`}
            onClick={() => onConfigChange({
              ...config,
              settings: { ...config.settings, asrProvider: 'local' }
            })}
          >
            <div className="selection-card__title">
              <span>🚀</span> 开启
            </div>
            <div className="selection-card__desc">
              使用本地 Whisper 服务，支持 GPU 加速，无字幕时自动驱动。
            </div>
          </div>
        </div>
      </section>

      {isEnabled && (
        <>
          {/* 服务状态与显存面板 */}
          <section className="options-section animate-fade-in" style={{ marginTop: '24px' }}>
            <label className="form-label--large">服务状态与显存</label>
            <div className="asr-status-panel">
              <div className="asr-status-row">
                <span
                  className="status-dot"
                  style={{ backgroundColor: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
                />
                <span className="asr-status-text">{statusText}</span>
              </div>

              {health && !healthError && (
                <div className="asr-status-detail">
                  引擎 {health.engine ?? '—'} · 设备 {health.device ?? '—'}
                  {health.idle_unload_sec > 0 &&
                    ` · 空闲 ${health.idle_seconds}s / ${health.idle_unload_sec}s 自动卸载`}
                  {typeof health.in_flight === 'number' && ` · 推理中 ${health.in_flight}`}
                </div>
              )}

              <div className="asr-status-actions">
                <button
                  className="btn--secondary-outline"
                  onClick={fetchHealth}
                  style={{ padding: '8px 16px' }}
                >
                  测试连接
                </button>
                <button
                  className="btn--danger-soft"
                  onClick={handleUnload}
                  disabled={!canUnload || unloading}
                  style={{ padding: '8px 16px' }}
                  title="立即卸载模型、释放显存（服务继续运行，下次识别自动重载）"
                >
                  {unloading ? '释放中…' : '⚡ 立即释放显存'}
                </button>
              </div>

              {unloadMsg && <div className="asr-status-msg">{unloadMsg}</div>}
            </div>
            <p className="form-hint">
              服务平时不占显存；模型在首次识别时加载，空闲 15 分钟自动卸载，上方可手动立即释放。
            </p>
          </section>

          {/* 服务地址与参数 */}
          <section className="options-section animate-fade-in" style={{ marginTop: '24px' }}>
            <div className="form-group">
              <label className="form-label">本地 ASR 服务地址</label>
              <input
                className="form-input--mono"
                type="text"
                value={config.settings.localAsrUrl}
                onChange={(e) => onConfigChange({
                  ...config,
                  settings: { ...config.settings, localAsrUrl: e.target.value }
                })}
                placeholder="http://localhost:2233/transcribe"
              />
              <p className="form-hint">
                请确保后端服务 <code>scripts/whisper_server.py</code> 已启动。
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">识别语言</label>
              <select
                className="form-select"
                value={normalizeAsrLanguage(config.settings.asrLanguage)}
                onChange={(e) => onConfigChange({
                  ...config,
                  settings: { ...config.settings, asrLanguage: e.target.value }
                })}
              >
                {ASR_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="form-hint">
                保持「自动检测」即可：按视频原语言逐字转录，英文视频输出英文原文，最适合交给 LLM 总结。
                只有确认视频是单一语言时才手动指定——用中文去识别英文音频，Whisper 会把语音
                <strong>改写成中文译文</strong>，型号、价格、术语全部失真。
              </p>
            </div>

            <div className="form-group--row">
              <div>
                <label className="form-label">Beam Size (搜索宽度)</label>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  max="10"
                  value={config.settings.asrBeamSize || 2}
                  onChange={(e) => onConfigChange({
                    ...config,
                    settings: { ...config.settings, asrBeamSize: parseInt(e.target.value) || 1 }
                  })}
                />
                <p className="form-hint">影响识别精度与速度，建议值为 2-5。</p>
              </div>
              <div>
                <label className="form-label">VAD 过滤 (静音检测)</label>
                <div className="checkbox-row" style={{ padding: '10px 0' }}>
                  <input
                    className="form-checkbox"
                    type="checkbox"
                    checked={config.settings.asrVadFilter}
                    onChange={(e) => onConfigChange({
                      ...config,
                      settings: { ...config.settings, asrVadFilter: e.target.checked }
                    })}
                  />
                  <span className="checkbox-label" style={{ fontWeight: 500 }}>
                    {config.settings.asrVadFilter ? '已启用高精过滤' : '未启用'}
                  </span>
                </div>
                <p className="form-hint">过滤背景噪音和空白片段，提升转录效率。</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
