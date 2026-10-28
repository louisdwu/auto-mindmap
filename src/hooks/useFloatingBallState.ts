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
  // 记录已经自动弹过字幕面板的任务，避免轮询期间重复弹出
  const openedSubtitleTaskRef = useRef<string | null>(null);

  const showToast = useCallback((message: string, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), duration);
  }, []);

  const normalizeUrl = useCallback((url: string) => {
    // 视频身份统一交给 media.ts：B 站分 P 必须参与比较，否则 P2 会命中 P1 的任务/导图。
    const ref = VideoUtils.parseMediaRef(url);
    if (ref) return ref.key;
    try {
      const u = new URL(url);
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

  const currentTaskRef = useRef<CurrentTask | undefined>(undefined);
  const showViewerRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchCurrentTaskRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    currentTaskRef.current = currentTask;
  }, [currentTask]);

  useEffect(() => {
    showViewerRef.current = showViewer;
  }, [showViewer]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /**
   * 仅在有排队/运行中任务时轮询。事件（TASK_UPDATE / MINDMAP_GENERATED）
   * 是主路径，轮询只是断线兜底，间隔 1.5s，任务结束立即停止。
   */
  const startPolling = useCallback(() => {
    if (pollTimerRef.current || !isContextValid.current) return;
    pollTimerRef.current = setInterval(() => {
      void fetchCurrentTaskRef.current();
    }, 1500);
  }, []);

  /**
   * 把后台任务快照应用到 UI。
   * Background 已用 media key 过滤过一次，这里再确认一次，防止标签页切换瞬间的串台。
   */
  const applyTask = useCallback(async (task: any) => {
    if (!task) {
      currentTaskRef.current = undefined;
      setCurrentTask(undefined);
      stopPolling();
      return;
    }

    const currentUrl = window.location.href;
    const taskUrl = task.data?.videoUrl;
    const isMatch = !!taskUrl && (
      VideoUtils.isSameVideo(currentUrl, taskUrl)
      || normalizeUrl(currentUrl) === normalizeUrl(taskUrl)
    );

    if (!isMatch) {
      currentTaskRef.current = undefined;
      setCurrentTask(undefined);
      stopPolling();
      return;
    }

    const subtitleOnly = task.data?.subtitleOnly === true || task.result?.subtitleOnly === true;
    const videoTitle = task.data?.videoTitle || task.result?.videoTitle
      || (subtitleOnly ? '视频字幕' : '处理中...');

    let subtitleText = task.result?.subtitleText as string | undefined;

    // 失败任务可能已在后台把字幕写入缓存；补一次，用户才能复制原文
    if (!subtitleText && task.status === 'failed') {
      try {
        const subRes = await RuntimeUtils.sendMessage({
          type: 'GET_SUBTITLE_CACHE',
          payload: { videoUrl: currentUrl }
        });
        if (subRes?.subtitleText) subtitleText = subRes.subtitleText;
      } catch {
        // 忽略缓存检索失败
      }
    }

    const previous = currentTaskRef.current;
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

    currentTaskRef.current = newTaskState;
    setCurrentTask(newTaskState);

    if (task.status === 'pending' || task.status === 'running') {
      startPolling();
    } else {
      stopPolling();
    }

    if (task.status === 'completed') {
      if (subtitleOnly && subtitleText) {
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
      } else if (!showViewerRef.current) {
        setShowNotification(true);
      }
    }

    if (task.status === 'failed' && previous?.status !== 'failed') {
      if (subtitleOnly) {
        showToast('⚠️ 字幕获取失败，请点击红色悬浮球查看详情', 5000);
      } else if (subtitleText) {
        showToast('⚠️ 导图生成失败，但字幕已就绪！点击悬浮球可复制字幕原文本', 6000);
      } else {
        showToast('⚠️ 任务失败，请点击红色悬浮球查看报错详情', 5000);
      }
    }

    if (task.status === 'cancelled' && previous?.status !== 'cancelled') {
      showToast('任务已取消');
    }
  }, [normalizeUrl, openSubtitleResult, showToast, startPolling, stopPolling]);

  const fetchCurrentTask = useCallback(async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      isContextValid.current = false;
      stopPolling();
      return;
    }

    try {
      const response = await RuntimeUtils.sendMessage({
        type: 'GET_CURRENT_TASK',
        payload: { videoUrl: window.location.href }
      });
      await applyTask(response?.task);
    } catch (error: any) {
      const errMsg = String(error?.message || error);
      if (errMsg.includes('context invalidated')) {
        console.warn('[FloatingBall] Extension context invalidated, stopping polling.');
        isContextValid.current = false;
        stopPolling();
      } else {
        console.error('[FloatingBall] Failed to get current task:', error);
      }
      currentTaskRef.current = undefined;
      setCurrentTask(undefined);
    }
  }, [applyTask, stopPolling]);

  useEffect(() => {
    fetchCurrentTaskRef.current = fetchCurrentTask;
  }, [fetchCurrentTask]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const handleRuntimeMessage = (message: any) => {
      switch (message?.type) {
        case 'MINDMAP_GENERATED': {
          const data = message.payload?.mindmapData;
          if (data && VideoUtils.isSameVideo(window.location.href, data.videoUrl)) {
            setMindmapData(data);
            setShowNotification(true);
          }
          void fetchCurrentTask();
          break;
        }
        case 'TASK_UPDATE': {
          // 主路径：后台在创建/启动/完成/失败/进度时推送，不再依赖 1s 轮询
          void applyTask(message.payload?.task);
          break;
        }
        case 'SUBTITLE_READY': {
          const payload = message.payload;
          if (payload?.subtitleText && payload.videoUrl
            && VideoUtils.isSameVideo(payload.videoUrl, window.location.href)) {
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
          void fetchCurrentTask();
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
      void fetchCurrentTask();
    };
    window.addEventListener('mindmap-generated', handleLocalGenerated);

    // URL 轮询只比较字符串，开销远低于监听整个 body 的 MutationObserver
    let lastUrl = window.location.href;
    const urlWatchTimer = setInterval(() => {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      setMindmapData(null);
      setShowViewer(false);
      setShowNotification(false);
      setShowSubtitle(false);
      setSubtitleResult(null);
      openedSubtitleTaskRef.current = null;
      stopPolling();
      void fetchCurrentTask();
    }, 750);

    void fetchCurrentTask();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (chrome.runtime?.id) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
      window.removeEventListener('mindmap-generated', handleLocalGenerated);
      stopPolling();
      clearInterval(urlWatchTimer);
    };
  }, [applyTask, fetchCurrentTask, openSubtitleResult, showToast, stopPolling]);

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

    // 已完成的普通导图任务：内存里仍有完整结果时直接打开；
    // SW 重启后任务结果被剥离大字段，则走下面的 GET_LATEST_MINDMAP_BY_URL 重新读取。
    if (
      currentTask?.status === 'completed'
      && !currentTask.subtitleOnly
      && currentTask.result?.mindmapMarkdown
    ) {
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
   * 悬浮球右键菜单 →「获取字幕」：仅获取字幕，不生成思维导图
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

  /** 取消当前视频的活跃任务（字幕下载 / 导图生成） */
  const handleCancelTask = async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      showToast('⚠️ 扩展已更新，请刷新页面后继续使用', 5000);
      return;
    }

    try {
      const result = await RuntimeUtils.sendMessage({
        type: 'CANCEL_TASK',
        payload: {
          taskId: currentTaskRef.current?.id,
          videoUrl: window.location.href
        }
      });
      if (result?.cancelled > 0) {
        showToast('🛑 已请求取消任务');
      } else {
        showToast('当前没有可取消的任务');
      }
    } catch (error) {
      console.error('[FloatingBall] 取消任务失败:', error);
      showToast('取消任务失败，请稍后重试');
    }
  };

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
    if (!confirm('重新语音识别？将跳过官方字幕与缓存，重新识别后再生成导图。')) return;
    setShowViewer(false);
    try {
      await RuntimeUtils.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: {
          videoUrl: window.location.href,
          videoTitle: getPageVideoTitle(),
          forceAsr: true,
          origin: 'user'
        }
      });
      showToast('🎙️ 正在重新语音识别（跳过官方字幕）...', 4000);
      fetchCurrentTask();
    } catch (err) {
      showToast('操作失败，请稍后重试');
    }
  };

  /**
   * 重新语音识别（仅字幕）：跳过官方字幕与缓存，重跑 ASR 后直接展示新字幕。
   * 由悬浮球右键菜单与字幕面板调用，不消耗 LLM 调用。
   */
  const handleForceAsrSubtitles = async () => {
    if (!isContextValid.current || !chrome.runtime?.id) {
      showToast('⚠️ 扩展已更新，请刷新页面后继续使用', 5000);
      return;
    }
    if (!confirm('重新语音识别？将跳过官方字幕，并清除该视频的字幕 / 导图缓存。')) return;

    setShowSubtitle(false);
    setShowNotification(false);
    try {
      await RuntimeUtils.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: {
          videoUrl: window.location.href,
          videoTitle: getPageVideoTitle(),
          subtitleOnly: true,
          forceAsr: true,
          origin: 'user'
        }
      });
      showToast('🎙️ 正在重新语音识别（跳过官方字幕）...', 4000);
      fetchCurrentTask();
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (!errMsg.includes('context invalidated')) {
        console.error('[FloatingBall] 重新语音识别启动失败:', err);
      }
      showToast('启动重新识别失败，请刷新页面后重试');
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
    handleCancelTask,
    handleForceAsrSubtitles,
    showToast
  };
}