import { createRoot } from 'react-dom/client';
import { FloatingBall } from '../components/FloatingBall';
import { MindmapViewer } from '../components/MindmapViewer';
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
    handleBallClick,
    handleCloseViewer,
    handleRetry,
    handleReTranscribe
  } = useFloatingBallState();

  return (
    <>
      <FloatingBall
        showNotification={showNotification}
        currentTask={currentTask}
        onClick={handleBallClick}
        isFullscreen={isFullscreen}
      />
      {showViewer && mindmapData && (
        <MindmapViewer
          mindmapData={mindmapData}
          onClose={handleCloseViewer}
          onRetry={handleRetry}
          onReTranscribe={handleReTranscribe}
        />
      )}
      {toastMessage && (
        <div className="mindmap-toast">{toastMessage}</div>
      )}
    </>
  );
}