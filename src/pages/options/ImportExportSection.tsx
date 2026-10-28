import React, { useState } from 'react';
import { StorageService } from '../../services/storageService';

interface ImportExportSectionProps {
  importStatus: { type: 'success' | 'error'; message: string } | null;
  onReload: () => void;
  onSetImportStatus: (status: { type: 'success' | 'error'; message: string } | null) => void;
}

/**
 * 配置备份与迁移
 *
 * 放在「大模型配置」页底部，因为换电脑/重装时最先要迁移的就是 LLM 配置。
 * 默认导出不带密钥；同 ID 配置在本机重新导入时会保留本机密钥。
 */
export const ImportExportSection: React.FC<ImportExportSectionProps> = ({
  importStatus,
  onReload,
  onSetImportStatus
}) => {
  const [includeSecrets, setIncludeSecrets] = useState(false);

  const handleExportConfig = async () => {
    try {
      await StorageService.downloadConfigFile({ includeSecrets });
      onSetImportStatus({ type: 'success', message: '配置已导出为 JSON 文件' });
      setTimeout(() => onSetImportStatus(null), 3000);
    } catch (error) {
      console.error('导出配置失败:', error);
      onSetImportStatus({ type: 'error', message: '导出失败' });
      setTimeout(() => onSetImportStatus(null), 3000);
    }
  };

  const handleImportConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = await StorageService.readConfigFromFile(file);
      const result = await StorageService.importConfig(data, {
        overwriteExisting: true,
        mergeLLMConfigs: false
      });

      if (result.success) {
        await onReload();
        onSetImportStatus({
          type: 'success',
          message: `配置导入成功，共导入 ${result.importedLLMConfigsCount || 0} 个 LLM 配置`
        });
      } else {
        onSetImportStatus({ type: 'error', message: result.message });
      }
    } catch (error) {
      console.error('导入配置失败:', error);
      onSetImportStatus({
        type: 'error',
        message: error instanceof Error ? error.message : '导入失败'
      });
    }

    event.target.value = '';
    setTimeout(() => onSetImportStatus(null), 3000);
  };

  return (
    <section className="options-section backup-section">
      <div className="llm-section__head">
        <div>
          <h2 className="llm-section__title">导入 / 导出配置</h2>
          <p className="llm-section__desc">
            换电脑、重装扩展或备份时使用。包含大模型配置、Prompt、ASR、排除词与系统设置。
          </p>
        </div>
      </div>

      <div className="backup-grid">
        <div className="backup-card">
          <div className="backup-card__icon">📤</div>
          <div className="backup-card__body">
            <strong>导出配置</strong>
            <p>生成一个 JSON 备份文件，可保存到本地或迁移到另一台电脑。</p>
            <label className="backup-checkbox">
              <input
                type="checkbox"
                checked={includeSecrets}
                onChange={(event) => setIncludeSecrets(event.target.checked)}
              />
              包含 API 密钥（明文，谨慎勾选）
            </label>
            <button type="button" className="btn--primary" onClick={handleExportConfig}>
              导出为 JSON
            </button>
          </div>
        </div>

        <div className="backup-card">
          <div className="backup-card__icon">📥</div>
          <div className="backup-card__body">
            <strong>导入配置</strong>
            <p>选择之前导出的 JSON。默认导入不会覆盖本机已有的 API 密钥。</p>
            <label className="btn--secondary-outline backup-upload">
              选择 JSON 文件
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleImportConfig}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="backup-chips">
        {['大模型配置', 'Prompt', 'ASR', '排除词', '系统设置'].map(item => (
          <span key={item} className="backup-chip">{item}</span>
        ))}
      </div>

      {importStatus && (
        <div className={importStatus.type === 'success' ? 'alert--success backup-status' : 'alert--error backup-status'}>
          {importStatus.type === 'success' ? '✓' : '✗'} {importStatus.message}
        </div>
      )}

      <p className="form-hint backup-note">
        默认导出的文件<strong>不包含 API 密钥</strong>；在本机重新导入时，同 ID 配置会保留
        本机已有的密钥。只有勾选「包含 API 密钥」才会把密钥写进文件，请妥善保管。
      </p>
    </section>
  );
};
