import { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingBall } from '../components/FloatingBall';
import { MindmapViewer } from '../components/MindmapViewer';

export function initFloatingBall() {
  // 创建容器
  const container = document.createElement('div');
  container.id = 'mindmap-floating-ball-container';
  document.body.appendChild(container);

  // 渲染React组件
  const root = createRoot(container);
  root.render(<FloatingBallApp />);
}

interface CurrentTask {
  type: string;
  status: string;
  videoTitle?: string;
  result?: any;
  errorMessage?: string;  // 任务失败时的错误信息
  statusMessage?: string; // 任务运行时的进度信息
}

function FloatingBallApp() {
  const [showNotification, setShowNotification] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [mindmapData, setMindmapData] = useState<any>(null);
  const [currentTask, setCurrentTask] = useState<CurrentTask | undefined>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), duration);
  }, []);

  // 标准化 URL 用于比较
  const normalizeUrl = useCallback((url: string) => {
    try {
      const u = new URL(url);
      // 对于 B站，主要比较 bvid/avid
      if (u.hostname.includes('bilibili.com')) {
        return u.pathname;
      }
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  }, []);

  // 获取当前正在运行的任务
  const fetchCurrentTask = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_CURRENT_TASK'
      });

      if (response && response.task) {
        const task = response.task;
        const currentUrl = window.location.href;
        const taskUrl = task.data?.videoUrl;

        // 校验任务是否属于当前页面
        if (taskUrl && normalizeUrl(currentUrl) === normalizeUrl(taskUrl)) {
          let videoTitle: string | undefined;
          if (task.data) {
            videoTitle = task.data.videoTitle || task.data.subtitleText?.substring(0, 30) || '处理中...';
          }

          const newTaskState = {
            type: task.type,
            status: task.status,
            videoTitle,
            result: task.result,
            errorMessage: task.error,  // 传递错误信息给组件
            statusMessage: task.statusMessage // 传递进度信息给组件
          };

          setCurrentTask(newTaskState);

          // 如果任务刚刚完成，触发通知
          if (task.status === 'completed' && !showNotification && !showViewer) {
            setShowNotification(true);
          }
        } else {
          // 如果任务不属于当前页面，清除当前任务状态
          setCurrentTask(undefined);
        }
      } else {
        setCurrentTask(undefined);
      }
    } catch (error) {
      console.error('[FloatingBall] Failed to get current task:', error);
      setCurrentTask(undefined);
    }
  }, [showNotification, showViewer, normalizeUrl]);

  useEffect(() => {
    // 监听全屏变化
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // 监听思维导图生成事件 (来自后台的主动通知)
    const handleMindmapMsg = (message: any) => {
      if (message.type === 'MINDMAP_GENERATED') {
        const data = message.payload?.mindmapData;
        if (data) {
          // 验证思维导图是否属于当前视频，避免其他标签页的思维导图覆盖当前状态
          const currentUrl = window.location.href;
          const mindmapVideoUrl = data.videoUrl;

          if (normalizeUrl(currentUrl) === normalizeUrl(mindmapVideoUrl)) {
            setMindmapData(data);
            setShowNotification(true);
          } else {
            console.log('[FloatingBall] 收到其他视频的思维导图通知，忽略');
          }
        }
        fetchCurrentTask();
      }
    };

    chrome.runtime.onMessage.addListener(handleMindmapMsg);

    // 监听本地事件
    const handleLocalGenerated = (e: Event) => {
      const customEvent = e as CustomEvent<{ mindmapData?: any }>;
      const data = customEvent.detail?.mindmapData;
      if (data) {
        setMindmapData(data);
        setShowNotification(true);
      }
      fetchCurrentTask();
    };

    window.addEventListener('mindmap-generated', handleLocalGenerated);

    // 监听URL变化
    let lastUrl = window.location.href;
    const handleUrlChange = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setMindmapData(null);
        setShowViewer(false);
        setShowNotification(false);
      }
    };

    const urlObserver = new MutationObserver(handleUrlChange);
    urlObserver.observe(document.body, { childList: true, subtree: true });

    fetchCurrentTask();
    const intervalId = setInterval(fetchCurrentTask, 1000);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      chrome.runtime.onMessage.removeListener(handleMindmapMsg);
      window.removeEventListener('mindmap-generated', handleLocalGenerated);
      clearInterval(intervalId);
      urlObserver.disconnect();
    };
  }, [fetchCurrentTask]);

  const handleBallClick = async () => {
    setShowNotification(false);

    console.log('[FloatingBall] 点击悬浮球，当前任务状态:', currentTask);
    console.log('[FloatingBall] 当前页面URL:', window.location.href);

    // 如果任务刚刚完成且有结果，直接显示
    if (currentTask?.status === 'completed' && currentTask.result) {
      console.log('[FloatingBall] 使用当前任务的结果');
      setMindmapData(currentTask.result);
      setShowViewer(true);
      return;
    }

    // 如果任务正在运行中
    if (currentTask?.status === 'running' || currentTask?.status === 'processing') {
      console.log('[FloatingBall] 任务正在运行中');
      showToast('任务正在进行中，请稍候...');
      return;
    }

    try {
      console.log('[FloatingBall] 尝试获取当前URL的思维导图');
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LATEST_MINDMAP_BY_URL',
        payload: { videoUrl: window.location.href }
      });

      console.log('[FloatingBall] GET_LATEST_MINDMAP_BY_URL 响应:', response);

      if (response && response.mindmap) {
        console.log('[FloatingBall] 找到匹配的思维导图');
        setMindmapData(response.mindmap);
        setShowViewer(true);
      } else {
        // 如果没有找到当前视频的思维导图，且没有任务在运行，直接开始生成
        console.log('[FloatingBall] 本页暂无思维导图，自动开始生成');
        try {
          const downloadResponse = await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_SUBTITLE',
            payload: { videoUrl: window.location.href }
          });
          console.log('[FloatingBall] 生成请求已发送:', downloadResponse);
          showToast('正在开始生成思维导图...');
          fetchCurrentTask(); // 立即刷新状态
        } catch (err) {
          console.error('[FloatingBall] 发送生成请求失败:', err);
          showToast('启动生成任务失败，请稍后重试');
        }
      }
    } catch (error) {
      console.error('[FloatingBall] 获取思维导图失败:', error);
    }
  };

  const handleCloseViewer = () => {
    setShowViewer(false);
  };

  const handleRetry = async () => {
    setShowViewer(false);
    try {
      await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: { videoUrl: window.location.href, force: false }
      });
      showToast('正在重新生成思维导图...');
    } catch (err) {
      showToast('操作失败，请稍后重试');
    }
  };

  const handleReTranscribe = async () => {
    if (!confirm('清除缓存重新生成？可能需要重新识别语音。')) {
      return;
    }
    setShowViewer(false);
    try {
      await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: { videoUrl: window.location.href, force: true }
      });
      showToast('正在强制重新生成...');
    } catch (err) {
      showToast('操作失败，请稍后重试');
    }
  };

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