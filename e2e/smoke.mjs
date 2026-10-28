#!/usr/bin/env node
/**
 * Auto Mindmap 扩展 smoke E2E（零依赖，CDP）
 *
 * 运行前先构建：
 *   npm run build
 *   node e2e/smoke.mjs
 *
 * 覆盖：
 *  1. Chromium 加载 dist 扩展 + options 页面可用 + 权限/存储初始化
 *  2. 后台真实任务链路：B 站 API 打桩 → 字幕获取 → 字幕缓存 → 任务完成
 *  3. B 站分 P：P2 使用独立缓存键，不会命中 P1
 *  4. Content script 注入与悬浮球视频页门控（视频页出现，首页不出现）
 *  5. YouTube watch 页 content script 注入
 *
 * 说明：这里用 Fetch CDP 拦截网络，不访问真实 B 站/YouTube，因此在 CI 中也可重复运行。
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  Cdp,
  base64Json,
  base64Text,
  connectTarget,
  fetchJson,
  listTargets,
  waitFor
} from './cdp.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CHROME_BIN = process.env.CHROME_BIN || 'chromium';
const BV = 'BV1xx411c7mD';
const BILI_P1 = `https://www.bilibili.com/video/${BV}?p=1`;
const BILI_P2 = `https://www.bilibili.com/video/${BV}?p=2`;
const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const passed = [];
function ok(message) {
  passed.push(message);
  console.log('  ✓ ' + message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForChrome(port) {
  await waitFor(async () => {
    try {
      await fetchJson('http://127.0.0.1:' + port + '/json/version', 1000);
      return true;
    } catch {
      return false;
    }
  }, { timeout: 15000, interval: 200, label: 'Chromium DevTools endpoint' });
}

async function discoverExtensionId(port, profileDir) {
  // 优先从 profile 的 Preferences 读取（unpacked 扩展 ID 由路径决定）
  try {
    const prefsPath = path.join(profileDir, 'Default', 'Preferences');
    const prefs = JSON.parse(await readFile(prefsPath, 'utf8'));
    for (const [id, value] of Object.entries(prefs.extensions?.settings || {})) {
      const extPath = value?.path ? path.resolve(value.path) : '';
      if (extPath === path.resolve(DIST)) return id;
    }
  } catch {
    // Preferences 可能尚未落盘
  }

  // 兜底：从 service worker target 的 URL 中取
  try {
    const targets = await listTargets(port);
    for (const target of targets) {
      const match = String(target.url || '').match(/^chrome-extension:\/\/([a-p]{32})\//);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }

  return null;
}

async function connectBrowser(port) {
  const version = await fetchJson('http://127.0.0.1:' + port + '/json/version');
  return new Cdp(version.webSocketDebuggerUrl);
}

async function createTarget(browser, url) {
  const result = await browser.send('Target.createTarget', { url });
  return result.targetId;
}

async function connectToTargetId(port, targetId) {
  const target = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(item => item.id === targetId) || null;
  }, { timeout: 10000, label: 'target ' + targetId });
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  return { target, cdp };
}

async function main() {
  await access(path.join(DIST, 'manifest.json')).catch(() => {
    throw new Error('未找到 dist/manifest.json，请先运行 npm run build');
  });

  const port = await getFreePort();
  const profileDir = await mkdtemp(path.join(ROOT, 'e2e', '.profile-'));
  const chromeArgs = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--user-data-dir=' + profileDir,
    '--load-extension=' + DIST,
    '--disable-extensions-except=' + DIST,
    '--remote-debugging-port=' + port,
    'about:blank'
  ];

  const child = spawn(CHROME_BIN, chromeArgs, { stdio: 'ignore' });
  let browser = null;
  let options = null;
  let sw = null;
  const extraTargets = [];

  try {
    await waitForChrome(port);
    browser = await connectBrowser(port);

    const extensionId = await waitFor(async () => {
      return await discoverExtensionId(port, profileDir);
    }, { timeout: 15000, interval: 250, label: 'extension id' });
    console.log('Extension ID:', extensionId);

    // 打开 options 页面，同时唤醒/启动 service worker
    const optionsTargetId = await createTarget(browser, `chrome-extension://${extensionId}/options.html`);
    const optionsConnection = await connectToTargetId(port, optionsTargetId);
    options = optionsConnection.cdp;
    await options.send('Page.enable');
    await waitFor(async () => {
      return (await options.evaluate('document.readyState')) === 'complete';
    }, { timeout: 10000, label: 'options page load' });

    const optionsText = await options.evaluate('document.body.innerText');
    if (!optionsText.includes('AutoMindmap')) throw new Error('options 页面未渲染');
    ok('options 页面加载');

    // 大模型配置页：服务商优先 + 添加模型选择器
    await options.evaluate(
      "Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('大模型配置'))?.click()"
    );
    await waitFor(async () => {
      return await options.evaluate("document.body.innerText.includes('添加模型')");
    }, { timeout: 5000, label: 'LLM section' });
    await options.evaluate("document.querySelector('.llm-add-btn')?.click()");
    await waitFor(async () => {
      return (await options.evaluate("document.querySelectorAll('.llm-provider-picker .llm-provider-card').length")) >= 6;
    }, { timeout: 5000, label: 'provider picker' });
    ok('LLM 配置页服务商选择器');

    await sleep(1000); // 等 options 自动保存的首次抖动结束，避免覆盖测试配置

    // 连接 service worker
    const swConnection = await connectTarget(port, target =>
      target.type === 'service_worker' && String(target.url).includes(extensionId)
    );
    sw = swConnection.cdp;
    await sw.send('Runtime.enable');

    const permissions = await sw.evaluate('chrome.runtime.getManifest().permissions');
    if (!Array.isArray(permissions) || !permissions.includes('unlimitedStorage')) {
      throw new Error('manifest 未包含 unlimitedStorage');
    }
    ok('扩展权限包含 unlimitedStorage');

    // 准备测试配置：不落本地文件、排除 fixture 标题，避免 content 自动生成导图
    await sw.evaluate(`(async () => {
      const { plugin_config } = await chrome.storage.local.get('plugin_config');
      const config = plugin_config || {};
      config.settings = config.settings || {};
      config.settings.saveToLocalFile = false;
      config.exclusionKeywords = ['Fixture'];
      await chrome.storage.local.set({ plugin_config: config });
      return true;
    })()`);

    // ---------------------------------------------------------------- //
    // 后台字幕任务 + 分 P
    // ---------------------------------------------------------------- //

    const subtitleRequests = [];
    let subtitlePage = 1;
    await sw.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }]
    });

    const fulfillJson = async (requestId, payload) => {
      await sw.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
          { name: 'Access-Control-Allow-Origin', value: '*' }
        ],
        body: base64Json(payload)
      });
    };

    sw.on('Fetch.requestPaused', params => {
      const url = params.request.url;
      const parsed = new URL(url);
      subtitleRequests.push(url);

      if (parsed.hostname === 'api.bilibili.com') {
        if (parsed.pathname.includes('/x/web-interface/nav')) {
          void fulfillJson(params.requestId, {
            code: 0,
            data: {
              wbi_img: {
                img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08c72e0c6.png'
              }
            }
          });
          return;
        }
        if (parsed.pathname.includes('/x/web-interface/view')) {
          void fulfillJson(params.requestId, {
            code: 0,
            data: {
              aid: 1,
              bvid: BV,
              cid: 111,
              title: 'Fixture 测试视频',
              owner: { name: 'tester' },
              pages: [
                { cid: 111, part: '第一集' },
                { cid: 222, part: '第二集' }
              ]
            }
          });
          return;
        }
        if (parsed.pathname.includes('/x/player/wbi/v2') || parsed.pathname.includes('/x/player/v2')) {
          // 任务请求里没有 p 参数，只能用 cid 判断当前分 P
          if (parsed.searchParams.get('cid') === '222') subtitlePage = 2;
          else if (parsed.searchParams.get('cid') === '111') subtitlePage = 1;
          void fulfillJson(params.requestId, {
            code: 0,
            data: {
              subtitle: {
                subtitles: [{
                  id: 'sub-1',
                  lan: 'zh-CN',
                  lan_doc: '中文',
                  subtitle_url: 'https://aisubtitle.hdslb.com/bfs/subtitle/fixture.json'
                }]
              }
            }
          });
          return;
        }
        void fulfillJson(params.requestId, { code: 0, data: {} });
        return;
      }

      if (parsed.hostname.endsWith('hdslb.com')) {
        const text = subtitlePage === 2 ? 'P2 第一句\nP2 第二句' : 'P1 第一句';
        void sw.send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
          body: base64Json({
            body: text.split('\n').map((content, index) => ({ from: index * 2, content }))
          })
        });
        return;
      }

      void sw.send('Fetch.continueRequest', { requestId: params.requestId });
    });

    const sendDownload = async (videoUrl) => {
      const response = await options.evaluate(`chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SUBTITLE',
        payload: { videoUrl: '${videoUrl}', subtitleOnly: true, force: true, origin: 'user' }
      })`);
      if (!response?.taskId) throw new Error('创建字幕任务失败: ' + JSON.stringify(response));
      return response.taskId;
    };

    const readTaskState = async (cacheId) => {
      return await options.evaluate(`chrome.storage.local.get(['active_tasks', 'subtitle_cache_v2_${cacheId}']).then(v => ({
        tasks: v.active_tasks || [],
        cache: v['subtitle_cache_v2_${cacheId}'] || null
      }))`);
    };

    const p2TaskId = await sendDownload(BILI_P2);
    const p2State = await waitFor(async () => {
      const state = await readTaskState(BV + '_p2');
      const task = state.tasks.find(item => item.id === p2TaskId);
      return task?.status === 'completed' && state.cache ? state : null;
    }, { timeout: 15000, interval: 200, label: 'P2 字幕任务完成' });

    if (!p2State.cache.includes('P2 第一句')) throw new Error('P2 字幕内容不正确');
    ok('后台字幕任务完成，P2 缓存写入正确');

    const p1TaskId = await sendDownload(BILI_P1);
    const p1State = await waitFor(async () => {
      const state = await readTaskState(BV);
      const task = state.tasks.find(item => item.id === p1TaskId);
      return task?.status === 'completed' && state.cache ? state : null;
    }, { timeout: 15000, interval: 200, label: 'P1 字幕任务完成' });

    if (!p1State.cache.includes('P1 第一句')) throw new Error('P1 字幕内容不正确');
    if (p1State.cache.includes('P2 第一句')) throw new Error('P1 缓存混入了 P2 内容');
    ok('B 站分 P 缓存隔离：P1/P2 各自独立');

    // ---------------------------------------------------------------- //
    // content script 注入 / 视频页门控
    // ---------------------------------------------------------------- //

    const biliTargetId = await createTarget(browser, 'about:blank');
    const biliConnection = await connectToTargetId(port, biliTargetId);
    const biliPage = biliConnection.cdp;
    extraTargets.push(biliPage);
    await biliPage.send('Page.enable');

    const biliHtml = `<!doctype html><html><head><title>Fixture 视频</title></head>
      <body><h1 class="video-title">Fixture 视频</h1><video></video></body></html>`;
    const homeHtml = '<!doctype html><html><head><title>Fixture home</title></head><body>home</body></html>';

    await biliPage.send('Fetch.enable', {
      patterns: [{ urlPattern: 'https://www.bilibili.com/*', requestStage: 'Request' }]
    });
    biliPage.on('Fetch.requestPaused', params => {
      const isHome = new URL(params.request.url).pathname === '/';
      void biliPage.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: base64Text(isHome ? homeHtml : biliHtml)
      });
    });

    await biliPage.send('Page.navigate', { url: BILI_P1 });
    await waitFor(async () => (await biliPage.evaluate('document.readyState')) === 'complete', {
      timeout: 10000,
      label: 'Bilibili fixture load'
    });

    const ballCount = await waitFor(async () => {
      return await biliPage.evaluate(
        "document.querySelector('#mindmap-floating-ball-container')?.childElementCount || 0"
      );
    }, { timeout: 10000, interval: 100, label: 'floating ball' });
    if (!ballCount) throw new Error('视频页未渲染悬浮球');
    ok('B 站视频页 content script 注入与悬浮球渲染');

    await biliPage.send('Page.navigate', { url: 'https://www.bilibili.com/' });
    await waitFor(async () => (await biliPage.evaluate('document.readyState')) === 'complete', {
      timeout: 10000,
      label: 'Bilibili home fixture load'
    });
    await waitFor(async () => {
      const count = await biliPage.evaluate(
        "document.querySelector('#mindmap-floating-ball-container')?.childElementCount || 0"
      );
      return count === 0;
    }, { timeout: 10000, interval: 100, label: 'floating ball hidden on home' });
    ok('非视频页不渲染悬浮球');

    // ---------------------------------------------------------------- //
    // YouTube 注入
    // ---------------------------------------------------------------- //

    const ytTargetId = await createTarget(browser, 'about:blank');
    const ytConnection = await connectToTargetId(port, ytTargetId);
    const ytPage = ytConnection.cdp;
    extraTargets.push(ytPage);
    await ytPage.send('Page.enable');
    await ytPage.send('Fetch.enable', {
      patterns: [{ urlPattern: 'https://www.youtube.com/*', requestStage: 'Request' }]
    });
    const ytHtml = `<!doctype html><html><head><title>Fixture - YouTube</title></head>
      <body><video></video></body></html>`;
    ytPage.on('Fetch.requestPaused', params => {
      void ytPage.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: base64Text(ytHtml)
      });
    });

    await ytPage.send('Page.navigate', { url: YT_URL });
    await waitFor(async () => (await ytPage.evaluate('document.readyState')) === 'complete', {
      timeout: 10000,
      label: 'YouTube fixture load'
    });
    const ytBallCount = await waitFor(async () => {
      return await ytPage.evaluate(
        "document.querySelector('#mindmap-floating-ball-container')?.childElementCount || 0"
      );
    }, { timeout: 10000, interval: 100, label: 'YouTube floating ball' });
    if (!ytBallCount) throw new Error('YouTube watch 页未渲染悬浮球');
    ok('YouTube watch 页 content script 注入与悬浮球渲染');

    console.log('\nE2E 通过：' + passed.length + ' 项');
  } finally {
    for (const page of extraTargets) page.close();
    if (options) options.close();
    if (sw) sw.close();
    if (browser) browser.close();
    if (child && !child.killed) child.kill('SIGTERM');
    await sleep(300);
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  console.error('\nE2E 失败:', error?.stack || error);
  process.exitCode = 1;
});