/**
 * 极简 CDP 客户端（零依赖）
 *
 * 本机/CI 有 Chromium 时，用它加载 dist 扩展并做真实回归；没有 Playwright 也能跑。
 * 只实现 e2e 需要的能力：请求/响应、事件订阅、目标发现。
 */

export class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;

    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (event) => reject(new Error('CDP websocket error: ' + String(event?.message || event))));
      this.ws.addEventListener('close', () => {
        this.closed = true;
        for (const { reject } of this.pending.values()) {
          reject(new Error('CDP websocket closed'));
        }
        this.pending.clear();
      });
    });

    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      if (message.method) {
        for (const handler of this.handlers.get(message.method) || []) {
          try {
            handler(message.params);
          } catch (error) {
            console.error('[cdp] handler error for ' + message.method + ':', error);
          }
        }
      }
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) || [];
    list.push(handler);
    this.handlers.set(method, list);
  }

  async send(method, params = {}) {
    await this.ready;
    if (this.closed) throw new Error('CDP socket closed before ' + method);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error('Runtime.evaluate failed: ' + text);
    }
    return result.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

export async function waitFor(predicate, { timeout = 10000, interval = 100, label = 'condition' } = {}) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timed out waiting for ' + label + (lastError ? ': ' + lastError.message : ''));
}

export async function fetchJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function listTargets(port) {
  return await fetchJson('http://127.0.0.1:' + port + '/json/list');
}

export async function connectTarget(port, predicate) {
  const target = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(predicate) || null;
  }, { timeout: 10000, label: 'target' });
  return { target, cdp: new Cdp(target.webSocketDebuggerUrl) };
}

export function base64Json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function base64Text(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}
