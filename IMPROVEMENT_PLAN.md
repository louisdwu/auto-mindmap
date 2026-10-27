# Auto Mindmap 改善方案（审计 + 已实施 + 路线图）

> 本文是对当前代码库的完整审计结论与改造记录。
> 结论先说：**不建议推倒重写**。项目规模不大、平台适配与 ASR 链路已经跑通，
> 真正拖后腿的是「任务状态 / 持久化 / 缓存身份 / 上下文预算」这几个基础语义。
> 这些可以在保留现有技术栈的前提下重构掉；另起炉灶会丢掉 B 站/YouTube/ASR 的
> 大量踩坑经验，收益远小于风险。

---

## 1. 审计结论（按影响排序）

### P0：会造成数据错误或直接失败

| 问题 | 位置 | 影响 | 状态 |
| --- | --- | --- | --- |
| B 站分 P 只按 BV 号做身份 | `utils/videoUtils.ts`、缓存/任务匹配 | P2 的字幕、音频、导图、任务会命中 P1；同一 BV 的不同 P 互相污染 | 已修复 |
| 长视频字幕直接塞进 LLM | `services/llmService.ts` | 超过上下文直接报错；2 小时视频几乎必失败 | 已修复（分段提炼） |
| 任务进度每次写整个任务表 | `background/taskManager.ts` | 每次 ASR/LLM 进度都写全量字幕，写放大、卡顿、配额风险 | 已修复（只广播，不落盘） |
| 调度竞态 | `background/taskManager.ts` | `processQueue` 在 await 窗口内可能重复启动任务、突破并发上限 | 已修复（同步认领） |
| 配置与密钥写在 `storage.sync` | `services/storageService.ts` | 单条 8KB 配额（prompt 很容易顶满）；API Key 同步到云端 | 已修复（迁到 local） |
| 构建期默认 API Key | `types/config.ts` | 密钥会进入 dist 产物并随包分发 | 已移除 |
| 选项页自动保存丢编辑 | `pages/Options.tsx` | 切换配置/删除前的 800ms 内编辑被 clearTimeout 丢弃 | 已修复（切换前 flush） |
| B 站无字幕且 ASR 关闭时无提示 | `subtitleService.ts` | 用户只看到泛化失败 | 部分改善（错误透传），待 UI 引导 |

### P1：影响稳定性、性能与可维护性

- **Service Worker 生命周期**：长任务随时可能被浏览器回收。原实现靠 10s 心跳 +
  running 任务启动时直接失败。现在心跳只在有任务时开启，任务表剥离大字段，
  pending 任务可恢复；但**真正的中断续跑**还没有（需要把阶段结果持久化 + 任务可恢复）。
- **存储无限增长**：字幕/ASR 缓存没有 TTL，导图 50 张且含全文字幕。现已加索引、
  TTL、数量/容量上限与配额重试；后续可迁移 IndexedDB 进一步降低写入成本。
- **1s 轮询 + 全页 MutationObserver**：content 每秒查后台，且监听整个 body 的
  DOM 变化。已改为事件驱动 + 仅任务运行时 1.5s 兜底轮询 + 750ms URL 检查。
- **导图渲染 O(n²)**：每个节点递归找分支、每个位置递归找节点。已用 map 预计算；
  但长文本仍是单行 nowrap，节点会非常宽，后续应做换行/测量。
- **配置写入并发**：LLM 配置、导图、统计、日志的读改写可能互相覆盖。已分别串行化。
- **YouTube 自动流程依赖字幕按钮**：未开 CC 时永远不会自动生成。已加导航后主动
  从页面数据/HTML 提取一次 CC 字幕的兜底（不自动触发 ASR）。
- **悬浮球出现在非视频页**：content script 注入全站。已加视频页门控。
- **每日统计错误**：把累计视频数写进每日视频数；累计数还会随列表裁剪缩水。已修复。

### P2：体验与工程化

- 导图长文本换行、节点测量、导出 Canvas 与渲染器一致性。
- 任务取消（AbortController 贯穿 ASR/LLM）、流式输出、重试策略可配置。
- `<all_urls>` 权限过宽：自定义 LLM 需要任意 host，但可改为 optional_host_permissions，
  在设置页按需申请。
- 无 E2E：只有 Vitest。Chrome 扩展的真实行为（content script 注入、MV3 生命周期、
  跨上下文消息）必须在浏览器里回归。
- 无 ESLint/Prettier/CI；Vite 4 + CRXJS beta 较旧；依赖里有未使用的 tailwind/sharp（已清理）。
- 无 i18n、无障碍标注、暗色设置页。
- ASR 后端仍偏 Windows 本地环境，跨平台启动脚本与 Docker 化可补。

---

## 2. 已实施改造（按提交）

1. **统一媒体标识**（`src/utils/media.ts`）
   - `MediaRef { platform, videoId, page, key, cacheId }`。
   - P1 的 `cacheId` 保持裸 BV 号（兼容旧缓存），P2+ 使用 `BV..._pN`。
   - 字幕、ASR、阶段 1、导图、任务匹配、UI 过滤全部使用同一身份。
   - `SubtitleService.getVideoInfo(videoId, page)` 按 P 取 `cid` 与标题。

2. **任务引擎 v2**（`src/background/taskManager.ts`）
   - 调度先同步置 running 再异步执行，消除重复启动窗口。
   - 进度只 `TASK_UPDATE` 广播；任务表落盘只发生在状态迁移，且剥离字幕/导图大字段。
   - 持久化合并 + 串行写队列；设备唤醒时 running → failed，pending 恢复。
   - 心跳仅在运行中任务存在时开启。
   - 普通流程也优先复用字幕缓存，避免重复下载/重复 ASR。

3. **存储分层与治理**（`src/services/storageService.ts`）
   - 配置、LLM 配置迁到 `chrome.storage.local`；旧 `sync` 数据自动迁移并清理。
   - 缓存索引 + TTL（字幕/ASR 30 天、阶段 1 3 天）+ 数量上限 + 6M 字符软上限。
   - 配额不足自动淘汰并重试；`unlimitedStorage` 权限。
   - 导出默认脱敏；导入时同 ID 保留本机密钥。
   - 设置页新增存储用量/清理面板。

4. **长视频分段提炼**（`src/services/llm/tokenBudget.ts` + `llmService.ts`）
   - 保守 token 估算 + 按时间戳行切分。
   - 分段提纲 → 递归合并 → 用原模板生成最终导图。
   - 反思阶段超限时使用压缩稿；仍超限则跳过反思保留初稿。
   - 输出 token 最多占上下文 30%，避免默认 `maxTokens` 挤爆输入。
   - 新增「长视频自动分段提炼」开关。

5. **内容端事件化**
   - 新增 `TASK_UPDATE`；content 只在任务 pending/running 时 1.5s 兜底轮询。
   - 移除 body 全页 MutationObserver，改为 750ms URL 字符串比较。
   - 悬浮球只在视频页挂载。
   - YouTube 导航后主动尝试一次 CC 字幕提取（不自动 ASR）。

6. **选项页 / 统计 / 依赖**
   - API Key 掩码 + 显示切换；自动保存切换前 flush。
   - 修复每日统计去重；统计/日志/导图写入串行化。
   - 新增 `npm run typecheck`、`npm test` 改为单次运行、`test:watch`。
   - 清理未使用的 tailwindcss / postcss / autoprefixer / sharp。

---

## 3. 数据迁移与兼容

- **配置**：首次读取时从 `storage.sync` 复制到 `storage.local`，随后删除 sync 副本。
  旧 `settings.cacheDirectory` 非空 → 新 `settings.saveToLocalFile = true`。
- **LLM 配置**：同上；旧 `plugin_config.llm` 仍会自动迁移为独立配置。
- **缓存**：`subtitle_cache_v2_` / `asr_cache_v2_` / `phase1_cache_` 键不变；
  B 站 P2+ 用新 `cacheId`，与旧数据天然隔离。首次启动会为旧缓存重建索引。
- **导图**：URL 匹配改为媒体 key；旧导图的完整 URL 仍能解析，P1 行为不变。
- **任务**：旧 `active_tasks` 中若有 `data.subtitleText`，恢复时会随下一次落盘剥离。

---

## 4. 验证情况

已在本机完成：

```bash
npm run build     # tsc + vite build 通过
npm test          # 14 个测试文件 / 98 个测试通过
```

新增测试覆盖：

- `utils/media.test.ts`：B 站分 P、av/BV、YouTube 各种链接、P1/P2 隔离。
- `services/storageService.test.ts`：local 迁移、密钥脱敏、缓存 TTL/索引/分 P 匹配。
- `services/llm/tokenBudget.test.ts`：token 估算、按行切分、超长行硬切。
- `services/llmService.test.ts`：短字幕单次、长字幕分段、关闭分段、反思超限跳过。
- `background/taskManager.test.ts`：并发上限、持久化剥离、分 P 匹配、running 恢复。

**未完成真实浏览器回归**：当前环境没有可自动化的 Chrome 扩展 E2E。
上线前必须手动验证：加载 dist → B 站单 P/多 P → 无字幕 ASR → YouTube 有/无 CC →
任务进行中刷新/关闭标签页 → 扩展更新后旧 content script 失效提示。

---

## 5. 下一阶段路线图

### P0（建议紧接着做）

1. **真实浏览器 E2E**：Playwright 加载扩展，覆盖 B 站/YouTube、分 P、ASR 回退、
   MV3 中断恢复。没有这一层，后面的重构都缺安全网。
2. **任务取消/中断恢复**：AbortController 贯穿 `fetch`；任务阶段结果落盘，
   SW 重启后可「继续反思」「继续生成」而不是直接失败。
3. **导图长文本换行**：按最大宽度测量换行、节点高度参与布局；同步修正 Canvas/PDF
   导出的换行逻辑，避免「屏幕好看、导出错位」。

### P1（体验/成本）

4. **流式 LLM 输出**：SSE 增量渲染，长视频不再只看到「阶段 3/3」。
5. **IndexedDB 存大文本**：chrome.storage 适合小状态，不适合每次重写 30 张导图；
   可保留 storage 做索引/配置，正文进 IDB。
6. **Token/费用统计**：适配器回传 usage，统计页展示输入/输出 token 与估算费用。
7. **可选 host 权限**：把 `<all_urls>` 改为 `optional_host_permissions`，在设置页
   按自定义 API 域名申请，降低安装时的权限告警。
8. **错误 UX**：无 LLM 配置/无 ASR 服务/Ollama 未启动时给出一键跳转设置，
   而不是等任务失败后弹红色悬浮球。

### P2（工程化/产品化）

9. ESLint + Prettier + GitHub Actions（build/test/typecheck）。
10. 依赖升级：CRXJS 稳定版或迁移 WXT；React 19；Vite 6/7。
11. i18n（中/英）、无障碍、设置页暗色模式。
12. ASR 服务 Docker 化 / 跨平台启动脚本 / 模型目录管理。
13. 可选：本地加密存储 API Key（只能提高门槛，无法抵御本机恶意扩展/进程）。

---

## 6. 关键设计取舍

- **为什么保留 chrome.storage 而不是全量 IndexedDB**：当前数据量在 `unlimitedStorage`
  下可控，迁移成本低；索引 + TTL 已能防止无限增长。等 E2E 稳定后再迁 IDB。
- **为什么任务表不存字幕/导图**：任务表是「状态机」，不是内容仓库。内容分别由
  字幕缓存与导图存储负责，避免同一份几万字文本在任务表和缓存里各存一遍。
- **为什么分段而不是截断**：截断会丢后半段信息，导图会系统性缺失；分段提炼
  多花几次调用，但保留完整时间线与数据。
- **为什么暂不换框架**：问题不在 React/Vite/CRXJS，而在数据语义与生命周期。
  换框架不会自动解决分 P、缓存、SW 恢复；先把这些做对，再谈工具链升级。
