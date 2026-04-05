# Auto Mindmap - 视频字幕思维导图

一个 Chrome 浏览器插件，可以自动获取 **B站** 和 **YouTube** 视频的字幕，并使用大模型生成思维导图。

## 功能特性

- 🎬 **多平台支持**：同时支持 Bilibili 和 YouTube
- 🤖 **AI 智能总结**：自动下载字幕，用 AI 生成结构化思维导图
- 🔔 **悬浮球提醒**：实时显示生成进度，点击查看导图
- ⚙️ **灵活配置**：支持自定义 Prompt、多个 LLM 配置、排除关键词等
- 💾 **本地缓存**：可选将导图保存到本地目录
- 🎤 **ASR 语音识别**：支持 B 站在无字幕时，通过本地 Whisper (GPU 加速) 自动识别语音

## 快速开始（普通用户）

### 1. 下载插件

直接下载 `dist` 目录

### 2. 导入 Chrome

1. 打开 Chrome 扩展管理页面：`chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `dist` 目录

### 3. 配置使用

1. 右键点击插件图标 → 选项，打开设置页面
2. 添加 LLM 配置（支持 OpenAI、Gemini 或兼容 API）
3. 填写 API 地址和密钥
4. 保存配置
5. 访问 B站 或 YouTube 视频页面，即可自动生成思维导图

### 4. 使用说明

- **自动生成**：打开视频页面后自动开始
- **手动生成**：点击悬浮球可查看导图或手动触发生成
- **暂停功能**：点击工具栏图标可暂停/恢复自动生成

## 开发者

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建
npm run build
```

## 技术栈

- React 18 + TypeScript
- Vite + CRXJS
- 自定义 SVG 思维导图渲染器
- Chrome Extension Manifest V3
关于本地 ASR 语音识别功能的详细环境配置与开发说明，请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 许可证

MIT
