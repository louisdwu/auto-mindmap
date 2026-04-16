/**
 * 观察者基类
 * 提供通用的页面监测和周期性任务能力
 */
export abstract class BaseObserver {
  protected lastUrl: string = window.location.href;
  protected observer: MutationObserver | null = null;

  constructor() {
    this.initUrlChangeDetection();
  }

  /**
   * 初始化 URL 变化检测 (单页应用常用逻辑)
   */
  private initUrlChangeDetection() {
    // 监听 popstate
    window.addEventListener('popstate', () => this.handleUrlChange());
    
    // 监听 pushState/replaceState
    const originalPushState = history.pushState;
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.handleUrlChange();
    };
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
  }
}
