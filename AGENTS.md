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

---

## 2. 开发流程

### 构建与运行

```bash
npm install           # 安装依赖
npm run build         # 编译（tsc 类型检查 + vite 打包）
npm run dev           # 开发模式（监听文件变化，实时更新 dist）
npm run test          # 运行单元测试（vitest）
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
│   └── taskManager.ts   #  任务队列、并发控制、ASR 串行化
│
├── content/             # Content Scripts（注入视频页面）
│   ├── index.ts         #   入口
│   ├── eventListener.ts #   全局事件监听
│   ├── floatingBall.tsx #   悬浮球 DOM 挂载
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
│   │   ├── base.ts            #  适配器基类
│   │   ├── BaseAdapter.ts
│   │   └── adapters/
│   │       ├── OpenAIAdapter.ts
│   │       ├── GeminiAdapter.ts
│   │       └── OllamaAdapter.ts
│   ├── storageService.ts  #  配置持久化
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
│   └── stats.ts         #  统计类型
│
└── utils/               # 工具函数
    ├── markdownParser.ts  #  Markdown → 导图节点树
    ├── layout.ts          #  布局算法
    ├── exportMindmap.ts   #  导图导出
    ├── videoUtils.ts      #  视频信息提取
    ├── youtubeUtils.ts    #  YouTube 专用工具
    ├── crypto.ts          #  加密
    ├── errorUtils.ts      #  错误处理
    └── runtimeUtils.ts    #  运行时工具
    # 另有 *.test.ts 单元测试文件

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

### 强制构建

- **每次修改代码后必须运行 `npm run build`。**

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

---

## 6. git 约定

### 提交信息

采用 **Conventional Commits** 格式：

```
<type>(<scope>): <description>
```

**常用 type：**
- `feat` — 新功能
- `fix` — 修复缺陷
- `refactor` — 重构（不改变外部行为）
- `chore` — 构建/依赖/配置等维护工作
- `docs` — 文档更新

**可选 scope**：模块或领域标识，如 `feat(asr)`、`fix(youtube)`。

### 行尾符

- 通过 `.gitattributes` 强制 LF（`* text=auto eol=lf`）
- 二进制资源（图片、音视频、字体等）标记为 `binary`，不做编码转换

### 忽略规则

`.gitignore` 已覆盖：
- 依赖目录（`node_modules`）
- 构建产物（`dist`）
- 环境变量文件（`.env*`）
- Python 缓存（`__pycache__/`、`*.py[cod]`）
- ASR 音频缓存（`scripts/cache/`）
- 密钥文件（`src/types/secrets.ts`）

---

## 7. 远端与镜像

主线在 **GitHub**（`origin` → `louisdwu/auto-mindmap`），NAS 上的 Gitea 只做**只读镜像**，每 8 小时自动从 GitHub 拉一次。

- 只往 GitHub 推：`git push origin main`；改完照常 commit + push 就是备份
- **不要**往 Gitea 推：镜像是单向的，两边会分叉
- 本地不推 GitHub，Gitea 那份永远看不到
- 镜像地址：<http://192.168.1.3:3000/louis/auto-mindmap>
