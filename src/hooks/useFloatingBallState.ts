import { useState, useEffect, useCallback, useRef } from 'react';
import { VideoUtils } from '../utils/videoUtils';
import { RuntimeUtils } from '../utils/runtimeUtils';
import { SubtitleResultData } from '../types/subtitle';

export interface CurrentTask {
  id?: string;
  type: string;
  status: string;
  videoTitle?: string;
  result?: any;
  errorMessage?: string;
  statusMessage?: string;
  subtitleText?: string;
  /** 是否为「仅获取字幕」任务（不生成思维导图） */
  subtitleOnly?: boolean;
  /** 字幕是否来自 ASR 语音识别 */
  isAsr?: boolean;
  /** 后台是否已自动保存字幕文件 */
  savedToFile?: boolean;
}

/** 去掉页面标题中的平台后缀，作为字幕结果的兜底标题 */
const PAGE_TITLE_SUFFIXES: RegExp[] = [
  /\s*[-–]\s*YouTube\s*$/i,
  /\s*[_\-|]\s*哔哩哔哩.*$/
];

function getPageVideoTitle(): string {
  let title = document.title || '';
  for (const pattern of PAGE_TITLE_SUFFIXES) {
    title = title.replace(pattern, '');
  }
  return title.trim();
}

export function useFloatingBallState() {
  const [showNotification, setShowNotification] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [mindmapData, setMindmapData] = useState<any>(null);
  const [currentTask, setCurrentTask] = useState<CurrentTask | undefined>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [subtitleResult, setSubtitleResult] = useState<SubtitleResultData | null>(null);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isContextValid = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 记录已经自动弹过字幕面板的任务，避免轮询期间重复弹出
  const openedSubtitleTaskRef = useRef<string | null>(null);

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

  /** 打开仅字幕结果面板 */
  const openSubtitleResult = useCallback((data: SubtitleResultData) => {
    setSubtitleResult(data);
    setShowSubtitle(true);
    setShowNotification(false);
  }, []);

  const fetchCurrentTask = useCallback(async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      isContextValid.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    try {
      const response = await RuntimeUtils.sendMessage({ 
        type: 'GET_CURRENT_TASK',
        payload: { videoUrl: window.location.href }
      });
      
      const task = response?.task;
      if (task) {
          // 由于后台已经根据 URL 进行了过滤，这里只需要进行二次确认或直接使用
          const taskUrl = task.data?.videoUrl;
          const currentUrl = window.location.href;
          
          // 使用更健壮的 VideoUtils 匹配
          const id1 = VideoUtils.extractVideoId(currentUrl);
          const id2 = VideoUtils.extractVideoId(taskUrl);
          const isMatch = (id1 && id1 === id2) || normalizeUrl(currentUrl) === normalizeUrl(taskUrl);

          if (isMatch) {
            const subtitleOnly = task.data?.subtitleOnly === true || task.result?.subtitleOnly === true;

            let videoTitle: string | undefined;
            if (task.data) {
              videoTitle = task.data.videoTitle || task.result?.videoTitle
                || task.data.subtitleText?.substring(0, 30)
                || (subtitleOnly ? '视频字幕' : '处理中...');
            }

            let subtitleText = task.data?.subtitleText || task.result?.subtitleText;

            // 如果当前任务处于失败状态，且任务对象内未携带 subtitleText，主动尝试拉取字幕缓存进行补充
            if (!subtitleText && task.status === 'failed') {
              try {
                const subRes = await RuntimeUtils.sendMessage({
                  type: 'GET_SUBTITLE_CACHE',
                  payload: { videoUrl: currentUrl }
                });
                if (subRes?.subtitleText) {
                  subtitleText = subRes.subtitleText;
                }
              } catch (e) {
                // 忽略缓存检索失败
              }
            }

            const newTaskState: CurrentTask = {
              id: task.id,
              type: task.type,
              status: task.status,
              videoTitle,
              result: task.result,
              errorMessage: task.error,
              statusMessage: task.statusMessage,
              subtitleText,
              subtitleOnly,
              isAsr: task.result?.isAsr === true,
              savedToFile: task.result?.savedToFile === true
            };

            setCurrentTask(newTaskState);

            if (task.status === 'completed') {
              if (subtitleOnly && subtitleText) {
                // 仅字幕任务完成后自动弹出结果面板（每个任务只弹一次）
                if (openedSubtitleTaskRef.current !== task.id) {
                  openedSubtitleTaskRef.current = task.id;
                  openSubtitleResult({
                    videoUrl: taskUrl || currentUrl,
                    videoTitle,
                    subtitleText,
                    isAsr: task.result?.isAsr === true,
                    savedToFile: task.result?.savedToFile === true
                  });
                  showToast(task.result?.savedToFile
                    ? '✅ 字幕已获取并保存到下载目录'
                    : '✅ 字幕已获取，可复制或下载 .txt');
                }
              } else if (!showNotification && !showViewer) {
                setShowNotification(true);
              }
            }

            if (task.status === 'failed' && currentTask?.status !== 'failed') {
              if (subtitleOnly) {
                showToast('⚠️ 字幕获取失败，请点击红色悬浮球查看详情', 5000);
              } else if (subtitleText) {
                showToast('⚠️ 导图生成失败，但字幕已就绪！点击悬浮球可复制字幕原文本', 6000);
              } else {
                showToast('⚠️ 任务失败，请点击红色悬浮球查看报错详情', 5000);
              }
            }
          } else {
            setCurrentTask(undefined);
          }
        } else {
          setCurrentTask(undefined);
        }
    } catch (error: any) {
      const errMsg = String(error?.message || error);
      if (errMsg.includes('context invalidated')) {
        console.warn('[FloatingBall] Extension context invalidated, stopping polling.');
        isContextValid.current = false;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        console.error('[FloatingBall] Failed to get current task:', error);
      }
      setCurrentTask(undefined);
    }
  }, [showNotification, showViewer, normalizeUrl, currentTask?.status, showToast, openSubtitleResult]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const handleRuntimeMessage = (message: any) => {
      switch (message?.type) {
        case 'MINDMAP_GENERATED': {
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
          break;
        }
        case 'SUBTITLE_READY': {
          const payload = message.payload;
          if (payload?.subtitleText && payload.videoUrl
            && normalizeUrl(payload.videoUrl) === normalizeUrl(window.location.href)) {
            if (payload.taskId) {
              openedSubtitleTaskRef.current = payload.taskId;
            }
            openSubtitleResult({
              videoUrl: payload.videoUrl,
              videoTitle: payload.videoTitle,
              subtitleText: payload.subtitleText,
              isAsr: payload.isAsr === true,
              savedToFile: payload.savedToFile === true
            });
            showToast(payload.savedToFile
              ? '✅ 字幕已获取并保存到下载目录'
              : '✅ 字幕已获取，可复制或下载 .txt');
          }
          fetchCurrentTask();
          break;
        }
        default:
          break;
      }
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

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
        setShowSubtitle(false);
        setSubtitleResult(null);
        openedSubtitleTaskRef.current = null;
      }
    };

    const urlObserver = new MutationObserver(handleUrlChange);
    urlObserver.observe(document.body, { childList: true, subtree: true });

    fetchCurrentTask();
    const intervalId = setInterval(fetchCurrentTask, 1000);
    intervalRef.current = intervalId;

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (chrome.runtime?.id) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
      window.removeEventListener('mindmap-generated', handleLocalGenerated);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      urlObserver.disconnect();
    };
  }, [fetchCurrentTask, normalizeUrl, openSubtitleResult, showToast]);

  /**
   * 已有字幕文本时直接进入思维导图生成，避免重复下载字幕 / 重复 ASR
   */
  const startMindmapFromSubtitle = async (subtitleText: string, videoTitle?: string) => {
    await RuntimeUtils.sendMessage({
      type: 'GENERATE_MINDMAP_DIRECT',
      payload: {
        videoUrl: window.location.href,
        subtitleText,
        videoTitle: videoTitle || getPageVideoTitle(),
        origin: 'user'
      }
    });
    showToast('正在生成思维导图...');
    fetchCurrentTask();
  };

  const handleBallClick = async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      showToast('⚠️ 扩展已更新，请刷新页面后继续使用', 5000);
      return;
    }
    setShowNotification(false);

    if (currentTask?.status === 'running' || currentTask?.status === 'pending') {
      showToast('任务正在进行中，请稍候...');
      return;
    }

    // 已完成的普通导图任务：直接打开查看器
    if (currentTask?.status === 'completed' && !currentTask.subtitleOnly && currentTask.result) {
      setMindmapData(currentTask.result);
      setShowViewer(true);
      return;
    }

    try {
      // 优先复用已有导图（含仅字幕任务完成后的再次左键）
      const response = await RuntimeUtils.sendMessage({
        type: 'GET_LATEST_MINDMAP_BY_URL',
        payload: { videoUrl: window.location.href }
      });
      if (response && response.mindmap) {
        setMindmapData(response.mindmap);
        setShowViewer(true);
        return;
      }

      // 没有导图，但字幕已经就绪：直接基于现有字幕生成，跳过字幕下载 / ASR
      if (currentTask?.subtitleText) {
        await startMindmapFromSubtitle(currentTask.subtitleText, currentTask.videoTitle);
        return;
      }

      const cachedSubtitle = await RuntimeUtils.sendMessage({
        type: 'GET_SUBTITLE_CACHE',
        payload: { videoUrl: window.location.href }
      });
      if (cachedSubtitle?.subtitleText) {
        await startMindmapFromSubtitle(
          cachedSubtitle.subtitleText,
          currentTask?.videoTitle || getPageVideoTitle()
        );
        return;
      }

      // 完全没有字幕：走完整流程（获取字幕 → 生成导图）
      await RuntimeUtils.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: { videoUrl: window.location.href, videoTitle: getPageVideoTitle(), origin: 'user' }
      });
      showToast('正在获取字幕并生成思维导图...');
      fetchCurrentTask();
    } catch (error: any) {
      const errMsg = String(error?.message || error);
      if (errMsg.includes('context invalidated')) {
          // 已经在 RuntimeUtils 处理
      } else {
          console.error('[FloatingBall] 生成思维导图失败:', error);
          showToast('启动生成任务失败，请稍后重试');
      }
    }
  };

  /**
   * 右键悬浮球：仅获取字幕，不生成思维导图
   */
  const handleBallRightClick = async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      showToast('⚠️ 扩展已更新，请刷新页面后继续使用', 5000);
      return;
    }
    setShowNotification(false);

    // 当前任务里已经有字幕文本时直接展示：
    // 例如导图正在生成（字幕已就绪）或导图失败，右键都不应打断任务
    if (currentTask?.subtitleText) {
      // 字幕已就绪也要明确告知后台「只要字幕」：
      // 取消仍在排队中的自动导图任务，避免右键后导图流程继续启动
      try {
        const resp = await RuntimeUtils.sendMessage({
          type: 'SET_SUBTITLE_ONLY_MODE',
          payload: { videoUrl: window.location.href }
        });
        if (resp?.cancelled > 0) {
          showToast('已取消自动生成导图，仅保留字幕', 4000);
        }
      } catch (e) {
        // 模式通知失败不影响字幕展示
      }

      openSubtitleResult({
        videoUrl: window.location.href,
        videoTitle: currentTask.videoTitle,
        subtitleText: currentTask.subtitleText,
        isAsr: currentTask.isAsr,
        savedToFile: currentTask.savedToFile
      });
      return;
    }

    if (currentTask?.status === 'running' || currentTask?.status === 'pending') {
      // 自动流程正在下载字幕：直接切换为「仅获取字幕」，复用本次下载并取消后续导图生成
      if (currentTask.type === 'download_subtitle') {
        try {
          await RuntimeUtils.sendMessage({
            type: 'DOWNLOAD_SUBTITLE',
            payload: {
              videoUrl: window.location.href,
              videoTitle: getPageVideoTitle(),
              subtitleOnly: true,
              origin: 'user'
            }
          });
          showToast(
            currentTask.subtitleOnly
              ? '字幕任务正在进行中，请稍候...'
              : '📝 已切换为仅获取字幕，不会生成思维导图',
            4000
          );
          fetchCurrentTask();
        } catch (err) {
          showToast('切换字幕模式失败，请稍后重试');
        }
        return;
      }
      showToast('任务正在进行中，请稍候...');
      return;
    }

    try {
      await RuntimeUtils.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: {
          videoUrl: window.location.href,
          videoTitle: getPageVideoTitle(),
          subtitleOnly: true,
          origin: 'user'
        }
      });
      showToast('📝 正在获取字幕（不生成思维导图）...', 3000);
      fetchCurrentTask();
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (!errMsg.includes('context invalidated')) {
        console.error('[FloatingBall] 获取字幕失败:', err);
      }
      showToast('启动字幕获取失败，请刷新页面后重试');
    }
  };

  const handleCloseViewer = () => setShowViewer(false);

  const handleCloseSubtitle = () => setShowSubtitle(false);

  const handleRetry = async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      showToast('⚠️ 扩展已更新，请刷新页面', 5000);
      return;
    }
    setShowViewer(false);
    try {
      await RuntimeUtils.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: { videoUrl: window.location.href, force: true, origin: 'user' }
      });
      showToast('正在重新生成思维导图...');
    } catch (err) {
      showToast('操作失败，请稍后重试');
    }
  };

  const handleReTranscribe = async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      showToast('⚠️ 扩展已更新，请刷新页面', 5000);
      return;
    }
    if (!confirm('清除缓存重新生成？可能需要重新识别语音。')) return;
    setShowViewer(false);
    try {
      await RuntimeUtils.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: { videoUrl: window.location.href, force: true, origin: 'user' }
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
    subtitleResult,
    showSubtitle,
    handleBallClick,
    handleBallRightClick,
    handleCloseViewer,
    handleCloseSubtitle,
    handleRetry,
    handleReTranscribe,
    showToast
  };
}
