import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingBall } from '../components/FloatingBall';
import { MindmapViewer } from '../components/MindmapViewer';
import { SubtitleModal } from '../components/SubtitleModal';
import { useFloatingBallState } from '../hooks/useFloatingBallState';
import { VideoUtils } from '../utils/videoUtils';

export function initFloatingBall() {
  // 创建容器
  const container = document.createElement('div');
  container.id = 'mindmap-floating-ball-container';
  document.body.appendChild(container);

  // 渲染React组件
  const root = createRoot(container);
  root.render(<FloatingBallApp />);
}

function isVideoPage(): boolean {
  return !!VideoUtils.parseMediaRef(window.location.href);
}

/**
 * 只在视频页挂载真正的悬浮球逻辑。
 *
 * content script 会注入 www.bilibili.com / www.youtube.com 的首页、动态、
 * 搜索结果等非视频页面；如果无条件挂载，悬浮球和 1s 任务查询会出现在所有页面。
 * 这里用低频 URL 检查做门控，SPA 进入视频页后再挂载内部组件。
 */
function FloatingBallApp() {
  const [active, setActive] = useState(isVideoPage());

  useEffect(() => {
    const timer = setInterval(() => {
      setActive(prev => {
        const next = isVideoPage();
        return next === prev ? prev : next;
      });
    }, 750);
    return () => clearInterval(timer);
  }, []);

  return active ? <FloatingBallContent /> : null;
}

function FloatingBallContent() {
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
    handleForceAsrSubtitles,
    showToast
  } = useFloatingBallState();

  return (
    <>
      <FloatingBall
        showNotification={showNotification}
        currentTask={currentTask}
        onClick={handleBallClick}
        onRightClick={handleBallRightClick}
        onReTranscribeAsr={handleForceAsrSubtitles}
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
          onReTranscribe={handleForceAsrSubtitles}
          onToast={showToast}
        />
      )}
      {toastMessage && (
        <div className="mindmap-toast">{toastMessage}</div>
      )}
    </>
  );
}