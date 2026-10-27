import { createRoot } from 'react-dom/client';
import { FloatingBall } from '../components/FloatingBall';
import { MindmapViewer } from '../components/MindmapViewer';
import { SubtitleModal } from '../components/SubtitleModal';
import { useFloatingBallState } from '../hooks/useFloatingBallState';

export function initFloatingBall() {
  // 创建容器
  const container = document.createElement('div');
  container.id = 'mindmap-floating-ball-container';
  document.body.appendChild(container);

  // 渲染React组件
  const root = createRoot(container);
  root.render(<FloatingBallApp />);
}

function FloatingBallApp() {
  const {
    showNotification,
    showViewer,
    mindmapData,
    currentTask,
    isFullscreen,
    toastMessage,
    subtitleResult,
    showSubtitle,
    handleBallClick,
    handleBallRightClick,
    handleCloseViewer,
    handleCloseSubtitle,
    handleRetry,
    handleReTranscribe,
    showToast
  } = useFloatingBallState();

  return (
    <>
      <FloatingBall
        showNotification={showNotification}
        currentTask={currentTask}
        onClick={handleBallClick}
        onRightClick={handleBallRightClick}
        isFullscreen={isFullscreen}
        onToast={showToast}
      />
      {showViewer && mindmapData && (
        <MindmapViewer
          mindmapData={mindmapData}
          onClose={handleCloseViewer}
          onRetry={handleRetry}
          onReTranscribe={handleReTranscribe}
        />
      )}
      {showSubtitle && subtitleResult && (
        <SubtitleModal
          data={subtitleResult}
          onClose={handleCloseSubtitle}
          onToast={showToast}
        />
      )}
      {toastMessage && (
        <div className="mindmap-toast">{toastMessage}</div>
      )}
    </>
  );
}