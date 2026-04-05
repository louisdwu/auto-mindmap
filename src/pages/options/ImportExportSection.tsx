import React from 'react';
import { StorageService } from '../../services/storageService';

interface ImportExportSectionProps {
  importStatus: { type: 'success' | 'error'; message: string } | null;
  onReload: () => void;
  onSetImportStatus: (status: { type: 'success' | 'error'; message: string } | null) => void;
}

export const ImportExportSection: React.FC<ImportExportSectionProps> = ({
  importStatus,
  onReload,
  onSetImportStatus
}) => {
  const handleExportConfig = async () => {
    try {
      await StorageService.downloadConfigFile();
      onSetImportStatus({ type: 'success', message: '配置已导出' });
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

    // 清除文件输入
    event.target.value = '';
    setTimeout(() => onSetImportStatus(null), 3000);
  };

  return (
    <section className="options-section options-section--bordered">
      <h2>配置备份与恢复</h2>

      <div className="import-export-row">
        {/* 导出 */}
        <div>
          <button className="btn--purple" onClick={handleExportConfig}>
            <span>📤</span> 导出配置
          </button>
          <p className="form-hint">将所有配置导出为 JSON 文件</p>
        </div>

        {/* 导入 */}
        <div>
          <label className="btn--cyan">
            <span>📥</span> 导入配置
            <input
              type="file"
              accept=".json"
              onChange={handleImportConfig}
              style={{ display: 'none' }}
            />
          </label>
          <p className="form-hint">从 JSON 文件恢复配置</p>
        </div>
      </div>

      {/* 导入状态 */}
      {importStatus && (
        <div
          className={importStatus.type === 'success' ? 'alert--success' : 'alert--error'}
          style={{ marginTop: '15px' }}
        >
          {importStatus.type === 'success' ? '✓' : '✗'} {importStatus.message}
        </div>
      )}

      <div className="import-export-hint">
        <p>
          <strong>提示：</strong>导出的配置文件包含所有 LLM 配置（包括 API 密钥）和插件设置。
          请妥善保管导出的文件，避免泄露敏感信息。
        </p>
      </div>
    </section>
  );
};
