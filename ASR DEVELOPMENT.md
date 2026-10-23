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

## 2. 敏感信息与配置管理

为了方便开发者将配置备份到 GitHub 同时保护私钥，本项目采用了“配置内化”方案。

### API 密钥管理 (.env)
1. 在项目根目录创建 `.env` 文件。
2. 填入您的默认密钥：
   ```env
   VITE_DEFAULT_API_KEY=您的_API_KEY
   ```
3. 该文件已被 `.gitignore` 忽略，不会被提交。

### 默认配置与 Prompt 维护
- **修改位置**：`src/types/config.ts`
- **工作流**：
  1. 在 `config.ts` 的 `DEFAULT_CONFIG` 中修改默认的 Prompt 或模型参数。
  2. 执行 `npm run build` 并刷新插件。
  3. 在插件设置页面**清空**对应的输入框并保存。
  4. 插件将自动回退并使用 `config.ts` 中定义的最新默认值。

---

## 3. 本地 ASR 后端配置 (Python)

我们通过一个 Python 桥接服务器（`scripts/whisper_server.py`）来调用显卡算力。
**已改造为多引擎架构**，引擎实现在 `scripts/asr_engines/` 包下，可自由切换。

> 📖 **所有模型/引擎的推荐参数都在 [`scripts/ENGINE_PARAMS.md`](scripts/ENGINE_PARAMS.md)**，
> 包括 2080 Ti 的硬件适配、预设表、环境变量清单、模型下载与排查手册。
> 本文件只讲安装与启动。

### 3.1 引擎一览

| 引擎 | 环境变量 | 特点 |
|---|---|---|
| **faster-whisper**（默认） | `ASR_ENGINE=faster-whisper` | CTranslate2 + int8，内置 VAD，实测 85 分钟视频 **14 分钟**跑完 |
| qwen3 | `ASR_ENGINE=qwen3` | Qwen3-ASR-1.7B + ForcedAligner，中文极限精度，但实测 **57 分钟**且无标点 |

切换只需设环境变量，**HTTP 接口契约、网页端、插件端全部不变**。

### 3.2 环境要求

- **Python 3.8+**（推荐 3.11 / 3.12）
- **NVIDIA GPU**（已验证 RTX 2080 Ti）
- **CUDA 运行环境**（已有其他 AI 工具能跑就无需重复装 NVIDIA Toolkit）

### 3.3 依赖安装

```bash
pip install -r scripts/requirements.txt
```

或直接：

```bash
pip install fastapi uvicorn python-multipart requests soundfile numpy \
            faster-whisper qwen-asr "transformers>=4.57"
```

> torch 请按你的 CUDA 版本单独装：
> `pip install torch --index-url https://download.pytorch.org/whl/cu121`

### 3.4 复用已有模型（省空间/秒开）

本机已有的模型目录（`WHISPER_MODEL_BASE_DIR` 默认值）：

```
D:\Green\卡卡字幕助手VideoCaptioner\AppData\models\
    faster-whisper-large-v3\   ← 默认引擎用这个
    faster-whisper-large-v2\
    faster-whisper-medium\
    Qwen\Qwen3-ASR-1.7B\
    Qwen\Qwen3-ForcedAligner-0.6B\
```

服务端会按「全名 → 目录名 → `faster-whisper-<name>`」三种候选自动匹配，
命中本地就直接加载，不联网。

### 3.5 启动服务

```bash
start_asr_server.bat          :: 或 run_whisper.bat
```

启动横幅会打印当前引擎、模型、Web UI 地址，并标注加载模式（默认 `[LAZY：按需加载，平时不占显存]`）。**浏览器打开 `http://localhost:2233`**
即为网页版「视频语音识别 / SRT 字幕生成器」。

> 默认启动后模型并不在显存里，首次识别某视频时才加载；用完空闲 15 分钟自动卸载（详见 3.6.1）。

拖拽本地文件直接转录（同时导出 `.txt` + `.srt`）：

```bash
run_whisper.bat D:\Videos\a.mp4
```

### 3.6 接口清单

| 接口 | 说明 |
|---|---|
| `GET /` | 网页版字幕生成器 |
| `POST /transcribe` | 主接口，`stream=true` 返回流式日志 + `JSON:{text,srt}` |
| `POST /v1/audio/transcriptions` | OpenAI 兼容，插件端在用 |
| `GET /v1/models` | 模型列表（保留 `large-v2` / `whisper-1` 供扩展端探测） |
| `GET /health` | 引擎、模型、设备、参数一览；另含 `model_loaded` / `in_flight` / `idle_seconds` / `idle_unload_sec` |
| `POST /unload` | 手动卸载模型、立即归还显存（服务进程继续运行，下次请求自动重载） |
| `POST /shutdown` | 手动关停整个服务进程（显存与进程一起释放） |
| `POST /cache/cleanup` | 手动清理过期的 `.mp3` 音频缓存（自动清理之外按需触发） |

> 返回的 `text` 字段**保留行内 `[mm:ss]` 前缀**，兼容扩展端缓存校验与思维导图时间戳引用。

### 3.6.1 惰性加载与显存（默认行为：平时不占显存）

为避免模型常驻占满显存，服务默认采用**惰性加载 + 空闲自动卸载**：

- **启动不加载模型**：HTTP 服务起来即可用，显存为空（仅占百来 MB 内存）。
- **按需加载**：首次 `/transcribe`（缓存未命中时）才把模型载入显存，首次约 10–20s 预热；同进程后续推理即时返回。
- **空闲自动卸载**：超过 `ASR_IDLE_UNLOAD_SEC`（默认 **900s / 15 分钟**）无推理请求，自动卸载模型、归还显存；设为 `0` 关闭自动卸载。
- **缓存命中不触显存**：同一 `video_id` 命中 `cache/*.txt` 时在加载模型前直接返回，因此重复识别同一视频既秒回又不占显存。
- **手动控制**：`POST /unload` 立即释放显存；`POST /shutdown` 关停进程。

相关环境变量：

| 变量 | 默认 | 作用 |
|---|---|---|
| `ASR_EAGER_LOAD` | `0` | 设 `1` 回到旧版「启动即加载模型」 |
| `ASR_IDLE_UNLOAD_SEC` | `900` | 空闲多少秒后自动卸载；`0` = 不自动卸载 |
| `ASR_IDLE_CHECK_SEC` | `30` | 看门狗检查间隔（最小 5s） |
| `ASR_MP3_TTL_DAYS` | `7` | `.mp3` 音频缓存保留天数，过期自动删除；`0` = 不清理 |
| `ASR_MP3_CLEANUP_INTERVAL_SEC` | `86400` | `.mp3` 周期清理间隔（默认每天） |

> 缓存取舍：`cache/*.txt` 与 `*.srt` 体积小、命中即可免加载模型（不触显存），长期保留；`cache/*.mp3` 体积大、仅重新转录同一视频时省一次下载，故按 TTL 回收。

### 3.7 冒烟测试（不加载模型，不占 GPU）

```bash
cd scripts
set _BOOT_GUARD=1
python smoke_test_webui.py
```

预期输出 `=== ALL SMOKE TESTS PASSED ===`。

---

## 4. 网页版字幕生成器（无需插件）

ASR 服务内置了一个网页前端，**启动服务后浏览器直接访问即可使用**，不必经过 Chrome 插件：

```
http://localhost:2233
```

> 若本机 2233 被防火墙拦截或想从局域网其他电脑访问，可将 `uvicorn` 的 host 保持为 `0.0.0.0`，然后访问 `http://<本机IP>:2233`。

### 功能

| 功能 | 说明 |
| --- | --- |
| 选择视频文件 | 支持 mp4 / mkv / mov / avi / flv / ts / webm / m4a / mp3 / flac / wav / ogg，**视频由服务端 ffmpeg 自动提取音轨**，无需手动转码 |
| 流式进度日志 | 实时显示模型下载、音频切块、分段识别等进度，并显示已用时长，可中途取消 |
| 导出 SRT 字幕 | 一键下载标准 `.srt`（带毫秒级时间戳），同时可下载纯文本 `.txt` |
| 服务自检 | 右上角状态点 + `测试连接` 按钮，调用 `GET /health` 显示模型与设备状态 |
| 高级选项 | 识别语言、`video_id`（启用服务端缓存，重复识别秒回）、领域提示词、本地文件路径（免上传） |

### 接口说明

网页与插件走的是**同一个** `POST /transcribe` 接口，返回体在原有字段基础上新增了 `srt`：

```json
{
  "text": "[00:00] 你好，这是一段测试……\n[01:23] 接下来的内容……",
  "srt": "1\n00:00:00,000 --> 00:00:05,000\n你好，这是一段测试……\n\n",
  "language": "zh",
  "duration": 12.34,
  "word_count": 86,
  "cached_mp3": null,
  "cached_txt": null,
  "cached_srt": null,
  "info": { "language_probability": 1.0, "duration": 12.34 }
}
```

- `stream=true` 时走流式返回：普通文本行为进度日志，`JSON:{...}` 行为最终结果（**同样带 `srt`**），`ERROR:{...}` 行为错误。
- `POST /v1/audio/transcriptions`（OpenAI 兼容）在 `response_format=json` 时同样返回 `srt`。
- 网页优先使用服务端返回的 `srt`；若服务端版本过旧未返回该字段，网页会自动用行内 `[mm:ss]` 时间戳在本地兜底生成 SRT。

### 相关文件

| 文件 | 作用 |
| --- | --- |
| `scripts/asr_webui.html` | 网页前端（纯 HTML/CSS/JS，无外部依赖，离线可用） |
| `scripts/whisper_server.py` | `GET /` 托管该网页；`POST /transcribe` 返回 `srt` |
| `scripts/smoke_test_webui.py` | 冒烟测试：打桩模型后验证 `GET /`、`/health`、`srt` 字段（`python scripts\smoke_test_webui.py`） |

---

## 5. 插件功能开启

1. 右键点击插件图标 -> **选项**。
2. 找到 **“语音识别 (ASR) 配置”** 模块。
3. 识别方式选择：**“本地 Whisper 识别 (2080ti 加速)”**。
4. 服务地址填入：`http://localhost:2233/transcribe`。
5. 点击 **保存配置**。

---

## 6. 常见问题 (Troubleshooting)

- **Service Worker 报错**：Manifest V3 不支持动态 `import()`。所有 Service Worker 使用到的服务类库（如 `AudioService`, `LLMService`）必须在文件顶部通过静态 `import` 引入。
- **404/无法连接**：请确保 `whisper_server.py` 正在运行，且端口（默认 2233）未被防火墙拦截。
- **识别速度慢**：确认 `DEVICE` 变量是否设置为 `"cuda"`，且显存是否充足。
