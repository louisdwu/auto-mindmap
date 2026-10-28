# E2E（真实 Chromium + 扩展）

零依赖的 CDP smoke 测试，不依赖 Playwright。它会启动一个全新的 Chromium 用户目录，
加载仓库里的 `dist`，并通过 DevTools Protocol 驱动 options 页面、service worker 与
content script。

## 运行

```bash
npm run build
npm run test:e2e
```

需要本机可执行 `chromium`、`chromium-browser` 或 `google-chrome`；
也可以用 `CHROME_BIN=/path/to/chrome npm run test:e2e` 指定。

## 覆盖内容

1. 扩展加载、options 页面渲染、`unlimitedStorage` 权限、本地存储初始化。
2. 大模型配置页的服务商选择器（新版 provider-first UI）。
3. 后台真实任务链路：B 站 view / WBI / 字幕接口打桩 → 字幕获取 → 缓存 → 任务完成。
4. B 站分 P：P1 与 P2 使用各自缓存键，P2 不会污染 P1。
5. B 站视频页 content script 注入与悬浮球渲染；首页不渲染悬浮球。
6. YouTube watch 页 content script 注入与悬浮球渲染。

## 不覆盖

- 真实 B 站 / YouTube 网络与登录态（测试用 CDP `Fetch` 打桩，避免不稳定与限流）。
- 真实 LLM 调用与长视频分段（由 `llmService.test.ts` / `tokenBudget.test.ts` 覆盖）。
- 真实 ASR 服务（需要 GPU/模型；由 `subtitleService` 相关逻辑的单元测试与手动回归覆盖）。
- 扩展安装/更新后旧 content script 失效的浏览器级回归（需人工操作）。

## 说明

脚本会在 `e2e/.profile-*` 创建临时 Chromium 用户目录，结束后删除；该目录已在
`.gitignore` 中忽略。若启动失败，先确认 Chromium 能以
`--headless=new --load-extension=dist` 运行。