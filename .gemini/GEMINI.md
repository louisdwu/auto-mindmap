# 项目：Auto Mindmap

## 项目概览
这是一个 Chrome 浏览器插件，利用 AI 自动从 Bilibili 视频字幕生成思维导图。它能识别视频内容，下载字幕，并使用 LLM（大语言模型）总结并将信息结构化为思维导图。

## 技术栈
- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite + CRXJS
- **思维导图渲染**: 自定义 SVG 渲染器 (MindmapRenderer.tsx)
- **扩展类型**: Chrome Extension Manifest V3
- **状态管理**: React Hooks + Local Storage
- **后端桥接 (ASR)**: Python (FastAPI) + Faster-Whisper (CUDA 11.8+ 加速)
- **样式**: Vanilla CSS (原生 CSS)

## 开发指南 (用户规则)

### 核心原则
- **KISS**: 保持简单，愚蠢 (Keep It Simple, Stupid)。
- **第一性原理**: 深度分析，避免过度设计。
- **事实为本**: 以事实为准绳。

### 核心技术规范 (避坑指南)
- **Service Worker 限制**: **禁止在 `src/background` 或被其引用的 Service Worker 代码中使用动态 `import()`**。所有服务类库（如 `AudioService`, `LLMService`）必须在文件顶部进行静态导入。
- **ASR 依赖**: 针对 Python 3.12+ 环境，避免在 `requirements.txt` 中对 `torch` 进行 `+cu118` 这种严格的版本锁定。
- **资源复用**: 本地 ASR 服务应支持通过 `MODEL_PATH` 直接指向硬盘已有模型（如卡卡字幕助手目录），避免重复下载。

### 工作流
- **渐进式开发**: 迭代优化。
- **结构化流程**: 计划 -> 审查 -> 任务分解。
- **修复即重构**: **在修复 Bug 后，必须对相关模块进行重构，以提高鲁棒性和可维护性，严禁简单的“打补丁”。**
- **强制构建**: **每次修改代码后必须运行 `npm run build` 以确保类型安全和构建产物有效。**

### 输出规范
- **语言**: 所有回复和计划必须使用中文。
- **固定指令**: `Implementation Plan, Task List and Thought in Chinese`

## 构建说明 (至关重要)

**修改任何代码后，你必须运行构建命令以验证正确性。**

```bash
npm run build
```

构建过程包括：
1. `tsc`: TypeScript 类型检查。
2. `vite build`: 为生产环境打包 (Chrome Extension 格式)。

## 项目结构
- `src/background`: 后台任务的 Service worker。
- `src/content`: 注入到 Bilibili页面的 Content scripts。
- `src/components`: React 组件 (MindmapRenderer, FloatingBall 等)。
- `src/pages`: UI 页面 (选项页)。
- `src/services`: 核心服务 (LLM, Storage, Subtitle, Audio)。
- `scripts/`: 后端 ASR 服务器脚本 (`whisper_server.py`)。

## 关键文件
- `src/services/audioService.ts`: B站音频流抓取与 WBI 签名。
- `src/services/subtitleService.ts`: 字幕获取与 ASR 回退逻辑中心。
- `src/components/MindmapRenderer.tsx`: 渲染思维导图的核心逻辑。
- `package.json`: 依赖和构建脚本。
- `DEVELOPMENT.md`: 详细的环境搭建与环境适配手册。
