import { useState, useEffect, useCallback, useRef } from 'react';

export interface CurrentTask {
  type: string;
  status: string;
  videoTitle?: string;
  result?: any;
  errorMessage?: string;
  statusMessage?: string;
}

export function useFloatingBallState() {
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

  const normalizeUrl = useCallback((url: string) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes('bilibili.com')) {
        return u.pathname;
      }
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  }, []);

  const fetchCurrentTask = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TASK' });
      if (response && response.task) {
        const task = response.task;
        const currentUrl = window.location.href;
        const taskUrl = task.data?.videoUrl;

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
            errorMessage: task.error,
            statusMessage: task.statusMessage
          };

          setCurrentTask(newTaskState);

          if (task.status === 'completed' && !showNotification && !showViewer) {
            setShowNotification(true);
          }

          if (task.status === 'failed' && currentTask?.status !== 'failed') {
            showToast('⚠️ 任务失败，请点击红色悬浮球查看报错详情', 5000);
          }
        } else {
          setCurrentTask(undefined);
        }
      } else {
        setCurrentTask(undefined);
      }
    } catch (error) {
      console.error('[FloatingBall] Failed to get current task:', error);
      setCurrentTask(undefined);
    }
  }, [showNotification, showViewer, normalizeUrl, currentTask?.status, showToast]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const handleMindmapMsg = (message: any) => {
      if (message.type === 'MINDMAP_GENERATED') {
        const data = message.payload?.mindmapData;
        if (data) {
          const currentUrl = window.location.href;
          const mindmapVideoUrl = data.videoUrl;
          if (normalizeUrl(currentUrl) === normalizeUrl(mindmapVideoUrl)) {
            setMindmapData(data);
            setShowNotification(true);
          }
        }
        fetchCurrentTask();
      }
    };
    chrome.runtime.onMessage.addListener(handleMindmapMsg);

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
  }, [fetchCurrentTask, normalizeUrl]);

  const handleBallClick = async () => {
    setShowNotification(false);
    if (currentTask?.status === 'completed' && currentTask.result) {
      setMindmapData(currentTask.result);
      setShowViewer(true);
      return;
    }
    if (currentTask?.status === 'running' || currentTask?.status === 'processing') {
      showToast('任务正在进行中，请稍候...');
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LATEST_MINDMAP_BY_URL',
        payload: { videoUrl: window.location.href }
      });
      if (response && response.mindmap) {
        setMindmapData(response.mindmap);
        setShowViewer(true);
      } else {
        try {
          await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_SUBTITLE',
            payload: { videoUrl: window.location.href }
          });
          showToast('正在开始生成思维导图...');
          fetchCurrentTask();
        } catch (err) {
          showToast('启动生成任务失败，请稍后重试');
        }
      }
    } catch (error) {
      console.error('[FloatingBall] 获取思维导图失败:', error);
    }
  };

  const handleCloseViewer = () => setShowViewer(false);

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
    if (!confirm('清除缓存重新生成？可能需要重新识别语音。')) return;
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

  return {
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
  };
}
