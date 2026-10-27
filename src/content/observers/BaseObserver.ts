/**
 * 观察者基类
 * 提供通用的页面监测和周期性任务能力
 *
 * 注意：content script 运行在隔离世界，直接改写 history.pushState 只能拦截
 * 本世界内的调用，页面自身（YouTube/B 站）的 SPA 导航不会经过它。因此这里
 * 以低频 URL 轮询作为兜底，而不是依赖 history 补丁。
 */
export abstract class BaseObserver {
  protected lastUrl: string = window.location.href;
  protected observer: MutationObserver | null = null;
  private urlWatchTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.initUrlChangeDetection();
  }

  /**
   * 初始化 URL 变化检测 (单页应用常用逻辑)
   */
  private initUrlChangeDetection() {
    this.urlWatchTimer = setInterval(() => this.handleUrlChange(), 1000);
    window.addEventListener('popstate', () => this.handleUrlChange());
  }

  private handleUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== this.lastUrl) {
      console.log(`[Observer] URL Changed: ${this.lastUrl} -> ${currentUrl}`);
      this.onUrlChange(currentUrl, this.lastUrl);
      this.lastUrl = currentUrl;
    }
  }

  /**
   * 子类必须实现的核心启动逻辑
   */
  abstract start(): void;

  /**
   * 子类实现 URL 变化时的具体操作
   */
  protected abstract onUrlChange(newUrl: string, oldUrl: string): void;

  /**
   * 销毁观察者，释放资源
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.urlWatchTimer) {
      clearInterval(this.urlWatchTimer);
      this.urlWatchTimer = null;
    }
  }
}
