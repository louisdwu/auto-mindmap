# Auto Mindmap — 项目规则

> 本文件是项目唯一的 AI 助手指令文件。所有规则按实际情况整理，不捏造。

---

## 1. 项目简介

Chrome 浏览器插件，自动从 **Bilibili** 和 **YouTube** 视频字幕生成思维导图。利用 LLM 总结视频内容并结构化为可交互的 SVG 思维导图。

**技术栈：**
- 前端：React 18 + TypeScript，Vite + CRXJS
- 扩展类型：Chrome Extension Manifest V3
- 思维导图渲染：自定义 SVG 渲染器（`MindmapRenderer.tsx`）
- 状态管理：React Hooks + Local Storage
- 样式：原生 CSS（Vanilla CSS，非 Tailwind / CSS-in-JS）
- 后端桥接（ASR）：Python FastAPI + Faster-Whisper（CUDA GPU 加速）

详细配置文档见 [`README.md`](README.md) 和 [`ASR DEVELOPMENT.md`](ASR%20DEVELOPMENT.md)。
完整审计与路线图见 [`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md)。

---

## 2. 开发流程

### 构建与运行

```bash
npm install           # 安装依赖
npm run build         # 编译（tsc 类型检查 + vite 打包）
npm run dev           # 开发模式（监听文件变化，实时更新 dist）
npm run test          # 运行单元测试（vitest，单次）
npm run test:e2e      # 真实 Chromium 扩展 smoke（需本机 Chromium）
```

**强制规则：每次修改代码后必须运行 `npm run build` 以确保类型安全和构建产物有效。**

### 加载到 Chrome

1. `chrome://extensions/` → 开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择 `dist` 目录
3. 代码更新后，必须点击插件卡片的**刷新**按钮（圆形箭头图标）才能生效

### 默认配置更新流程

1. 修改 `src/types/config.ts` 中的 `DEFAULT_CONFIG`
2. `npm run build` 并刷新插件
3. 在设置页面**清空**对应输入框并保存
4. 插件自动回退到 `config.ts` 中的最新默认值

### ASR 后端服务

- 启动：`start_asr_server.bat`（或 `run_whisper.bat`）
- Web UI：`http://localhost:2233`
- 多引擎支持：`ASR_ENGINE=faster-whisper`（默认）或 `ASR_ENGINE=qwen3`
- 详细配置见 [`ASR DEVELOPMENT.md`](ASR%20DEVELOPMENT.md)

---

## 3. 架构地图

```
src/
├── background/          # Service Worker：消息路由、任务调度
│   ├── index.ts         #   入口，监听 chrome.runtime.onMessage
│   ├── messageHandler.ts #  消息分发与处理
│   └── taskManager.ts   #  任务状态机、并发控制、持久化剥离、ASR 串行化
│
├── content/             # Content Scripts（注入视频页面）
│   ├── index.ts         #   入口
│   ├── eventListener.ts #   全局事件监听
│   ├── floatingBall.tsx #   悬浮球 DOM 挂载（仅视频页挂载）
│   ├── observers/       #   平台适配器（策略模式）
│   │   ├── BaseObserver.ts   #  抽象基类
│   │   ├── BilibiliObserver.ts
│   │   └── YouTubeObserver.ts
│   ├── youtubeInterceptor.js  #  YouTube 网络请求拦截
│   └── youtubeSubtitleCache.ts #  字幕缓存
│
├── components/          # React 组件
│   ├── FloatingBall.tsx      #  悬浮球 UI
│   ├── MindmapRenderer.tsx   #  思维导图渲染核心（SVG）
│   ├── MindmapRenderer/      #  子组件（Node、Link、Toolbar）
│   ├── MindmapRenderer/themes/ #  主题样式
│   ├── MindmapViewer.tsx     #  导图查看弹窗
│   ├── SubtitleModal.tsx     #  仅字幕结果面板（复制/下载）
│   └── Icons.tsx             #  SVG 图标集合
│
├── pages/               # 页面
│   ├── Options.tsx      #  选项页入口
│   ├── options_main.tsx #  选项页挂载点
│   └── options/         #  选项页子模块（按功能拆分）
│       ├── AsrSection.tsx         #  ASR 配置
│       ├── LLMConfigSection.tsx   #  LLM 配置管理
│       ├── PromptSection.tsx      #  Prompt 编辑器
│       ├── CacheSection.tsx       #  缓存设置
│       ├── StorageSection.tsx     #  存储用量与清理
│       ├── ExclusionSection.tsx   #  排除关键词
│       ├── ImportExportSection.tsx #  导入/导出
│       ├── LogSection.tsx         #  日志查看
│       ├── StatsSection.tsx       #  统计信息
│       ├── SystemSettingsSection.tsx #  系统设置
│       ├── ActionButtons.tsx      #  操作按钮
│       └── Options.css            #  选项页样式
│
├── services/            # 核心服务层
│   ├── audioService.ts    #  B站音频流抓取、WBI 签名
│   ├── subtitleService.ts #  字幕获取与 ASR 回退
│   ├── generatorService.ts #  导图生成流程编排
│   ├── llmService.ts      #  LLM 调用入口
│   ├── llm/               #  LLM 适配器
│   │   ├── base.ts            #  适配器接口
│   │   ├── BaseAdapter.ts
│   │   ├── tokenBudget.ts     #  长视频 token 估算与字幕切分
│   │   ├── reflectionGate.ts  #  反思闸门：结构/时间戳/数据点确定性校验
│   │   └── adapters/
│   │       ├── OpenAIAdapter.ts
│   │       ├── GeminiAdapter.ts
│   │       └── OllamaAdapter.ts
│   ├── storageService.ts  #  配置/缓存持久化、缓存索引、TTL、配额治理
│   ├── storage/migration.ts #  配置版本迁移
│   ├── fileService.ts     #  文件导入/导出
│   ├── loggerService.ts   #  日志管理
│   └── statsService.ts    #  使用统计
│
├── hooks/               # React Hooks
│   ├── useMindmapLayout.ts      #  导图布局计算
│   ├── useCanvasInteraction.ts  #  画布交互（拖拽/缩放）
│   └── useFloatingBallState.ts  #  悬浮球状态
│
├── prompts/             # LLM Prompt 模板
│   ├── System.txt       #  系统提示词
│   ├── User.txt         #  用户提示词
│   └── Reflection.txt   #  反思提示词
│
├── types/               # TypeScript 类型定义
│   ├── config.ts        #  配置类型与 DEFAULT_CONFIG
│   ├── mindmap.ts       #  导图节点/主题类型
│   ├── messages.ts      #  跨上下文消息协议
│   ├── subtitle.ts      #  仅字幕模式结果类型
│   └── stats.ts         #  统计类型
│
└── utils/               # 工具函数
    ├── media.ts           #  统一视频身份（平台/ID/分 P/缓存键）
    ├── markdownParser.ts  #  Markdown → 导图节点树
    ├── layout.ts          #  布局算法
    ├── exportMindmap.ts   #  导图导出
    ├── subtitleExport.ts  #  字幕复制/下载（悬浮球与字幕面板共用）
    ├── videoUtils.ts      #  视频信息提取
    ├── youtubeUtils.ts    #  YouTube 专用工具
    ├── crypto.ts          #  加密
    ├── errorUtils.ts      #  错误处理
    └── runtimeUtils.ts    #  运行时工具
    # 另有 *.test.ts 单元测试文件

e2e/                     # 零依赖 CDP 扩展 smoke 测试
├── cdp.mjs              #  极简 CDP 客户端
├── smoke.mjs            #  扩展加载 / 分 P / content script 注入
└── README.md

.github/workflows/ci.yml # typecheck + unit test + build + dist artifact

scripts/                 # Python ASR 后端
├── whisper_server.py    #  FastAPI 服务入口
├── asr_engines/         #  引擎实现（策略模式）
│   ├── base.py
│   ├── common.py
│   ├── fasterwhisper.py
│   └── qwen3.py
├── asr_webui.html       #  网页版字幕生成器
├── ENGINE_PARAMS.md     #  引擎参数与硬件适配手册
└── requirements.txt
```

---

## 4. 关键约定

### 核心原则

- **KISS**：保持简单，避免过度设计。
- **第一性原理**：深度分析，从根本出发。
- **事实为本**：以事实为准绳，不臆测。

### 语言规范

- **所有回复和计划必须使用中文。**
- 固定指令：`Implementation Plan, Task List and Thought in Chinese`

### Service Worker 限制（Manifest V3）

- **禁止在 `src/background/` 或其引用链中的 Service Worker 代码中使用动态 `import()`。**
- 所有服务类库（`AudioService`、`LLMService` 等）必须在文件顶部**静态导入**。

### 修复即重构

- **修复 Bug 后，必须对相关模块进行重构，提高鲁棒性和可维护性，严禁简单的「打补丁」。**

### 视频身份与缓存

- 任何涉及视频去重、缓存键、任务匹配、消息过滤的代码，必须使用 `utils/media.ts` 的
  `parseMediaRef / getCacheId / isSameVideo`，不要直接用 BV 号或 URL 字符串。
- B 站 P1 的 `cacheId` 是裸视频 ID（兼容旧缓存），P2+ 是 `BV..._pN`。

### 存储

- 配置与 LLM 配置（含密钥）存 `chrome.storage.local`，不要写回 `storage.sync`。
- 大文本缓存统一走 `StorageService` 的字幕 / ASR / 阶段 1 缓存 API，自动带 TTL 与索引；
  新增缓存类型时必须同时更新 `CACHE_POLICY` 与 `kindOfKey`。
- 任务表 `active_tasks` 只存状态与定位信息，不要塞入字幕或导图正文。

### 强制构建与测试

- **每次修改代码后必须运行 `npm run build`。**
- 修改核心逻辑（任务/存储/解析/LLM 适配器）时，同时运行 `npm test`。

### ASR 依赖管理

- Python 3.12+ 环境下，避免在 `requirements.txt` 中对 `torch` 进行 `+cu118` 等严格版本锁定；`torch` 按 CUDA 版本单独安装。
- 本地 ASR 服务应支持通过 `MODEL_PATH` 直接指向硬盘已有模型，避免重复下载。

---

## 5. 编码规范

### TypeScript

- **严格模式**（`tsconfig.json` 已启用 `strict: true`）
- 禁止未使用的变量和参数（`noUnusedLocals`、`noUnusedParameters`）
- Switch 禁止意外 fall-through（`noFallthroughCasesInSwitch`）
- 目标 ES2020，模块解析 bundler，JSX 使用 `react-jsx`

### 样式

- 使用**原生 CSS**（Vanilla CSS），按功能模块拆分 CSS 文件
- 不用 Tailwind、不用 CSS-in-JS
- 主题通过独立 CSS 文件管理（`MindmapRenderer/themes/`）

### React

- 函数式组件 + Hooks
- 组件按职责拆分（选项页按功能拆分为独立 Section 组件）
- 跨上下文通信通过 `chrome.runtime.sendMessage`，消息类型定义在 `types/messages.ts`

### 文件组织

- 服务类导出为类实例或单例，统一从 `services/` 目录导入
- 工具函数按领域拆分，每个文件聚焦单一职责
- Prompt 模板以 `.txt` 文件存放于 `prompts/` 目录

### 测试

- 使用 Vitest（`vitest.config.ts`）
- 测试文件命名为 `*.test.ts` / `*.test.tsx`，与源文件同目录
- 运行：`npm run test`