# B站字幕思维导图

一个 Chrome 浏览器插件，可以自动下载 B 站视频的中文字幕，并使用大模型生成思维导图。

## 功能特性

- 自动下载 B 站视频字幕，并用 AI 总结生成思维导图
- 悬浮球实时提醒
- 支持自定义 Prompt 和 API 配置

## 快速开始（普通用户）

### 1. 下载插件

直接下载 `dist` 目录

### 2. 导入 Chrome

1. 打开 Chrome 扩展管理页面：`chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `dist` 目录

### 3. 配置使用

1. 点击插件图标，打开设置页面
2. 填写 API 地址（如 `https://api.openai.com/v1`）
3. 填写 API 密钥
4. 保存配置
5. 访问 B 站视频页面，即可生成思维导图

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
- 自定义 Markdown 解析器 + Canvas 思维导图渲染
- Chrome Extension Manifest V3

## 许可证

MIT
