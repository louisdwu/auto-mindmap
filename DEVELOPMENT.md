# 本地 ASR 语音识别功能开发与配置指南

本项目支持在 B 站视频没有官方字幕时，自动调用本地显卡（如 NVIDIA 2080ti）进行高精度的语音转录（基于 `faster-whisper`）。

## 1. 扩展端编译与安装

### 编译步骤
由于本项目使用 Vite 和 TypeScript，在修改 `src` 代码后必须重新编译：
```bash
# 执行全量编译
npm run build
```

### 加载到 Chrome
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
2. 开启右上角的 **“开发者模式”**。
3. 点击 **“加载已解压的扩展程序”**，选择项目根目录下的 `dist` 文件夹（如果是初次安装）。
4. **重要**：代码更新后，必须点击插件卡片右下角的 **“刷新”（圆形箭头图标）** 才能生效。

---

## 2. 本地 ASR 后端配置 (Python)

我们通过一个 Python 桥接服务器（`scripts/whisper_server.py`）来调用显卡算力。

### 环境要求
- **Python 3.8+** (推荐 3.11 或 3.12)
- **NVIDIA GPU** (已验证 2080ti)
- **CUDA 运行环境** (如果已有其他 AI 工具能运行，通常无需重复安装 NVIDIA Toolkit)

### 依赖安装
针对 Python 3.12+ 环境，建议直接安装最新版依赖，避免版本锁定导致的编译失败：
```bash
pip install fastapi uvicorn faster-whisper python-multipart
```

### 利用已有模型（节省空间/加速启动）
如果你已经有其他 Whisper 项目（如“卡卡字幕助手”），可以在 `scripts/whisper_server.py` 中直接指定其模型目录。例如：
```python
MODEL_PATH = r"D:\Green\卡卡字幕助手VideoCaptioner\AppData\models\faster-whisper-large-v2"
```
这样可以避免重新下载 3GB 的模型文件，实现秒开。

### 启动服务
```bash
python scripts/whisper_server.py
```
看到 `模型加载成功！服务已准备就绪。` 即表示后端正常。

---

## 3. 插件功能开启

1. 右键点击插件图标 -> **选项**。
2. 找到 **“语音识别 (ASR) 配置”** 模块。
3. 识别方式选择：**“本地 Whisper 识别 (2080ti 加速)”**。
4. 服务地址填入：`http://localhost:5000/transcribe`。
5. 点击 **保存配置**。

---

## 4. 常见问题 (Troubleshooting)

- **Service Worker 报错**：Manifest V3 不支持动态 `import()`。所有 Service Worker 使用到的服务类库（如 `AudioService`, `LLMService`）必须在文件顶部通过静态 `import` 引入。
- **404/无法连接**：请确保 `whisper_server.py` 正在运行，且端口（默认 5000）未被防火墙拦截。
- **识别速度慢**：确认 `DEVICE` 变量是否设置为 `"cuda"`，且显存是否充足。
