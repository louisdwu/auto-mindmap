# ASR 引擎与模型参数指南

> 适用：`scripts/whisper_server.py` 多引擎版
> 硬件基线：RTX 2080 Ti（11 GB / sm_75）+ i5-10400

---

## 1. 切换引擎

服务端通过一个环境变量选引擎，**默认 `faster-whisper`**：

```bat
set ASR_ENGINE=faster-whisper   :: 默认，速度快（推荐）
set ASR_ENGINE=qwen3            :: 备用，中文极限准确率，但很慢
```

也可以命令行直接指定：

```bat
python scripts/whisper_server.py --engine faster-whisper
python scripts/whisper_server.py --engine qwen3 --port 2233
python scripts/whisper_server.py D:\Videos\a.mp4 --engine qwen3
```

切换引擎**不需要改任何代码**，也不需要改 HTTP 接口——插件端和网页端都是同一个 `http://localhost:2233/transcribe`。

---

## 2. faster-whisper 引擎（默认）

基于 CTranslate2 的 Whisper 加速实现。内置 VAD 自动跳静音，`word_timestamps` 直接产词级时间戳 → SRT。

### 2.1 模型与预设

服务端内置 `PRESETS` 表，**切模型会自动套最优参数**，无需手动配：

| 模型名（`FW_MODEL`） | compute_type | beam_size | best_of | 显存 | 说明 |
|---|---|---|---|---|---|
| `large-v3` | int8_float16 | 1 | 1 | ~1.6 GB | **默认**。官方推荐默认版 |
| `large-v2` | int8_float16 | 1 | 1 | ~1.6 GB | 卡卡字幕助手 在用。想与它逐字对齐就选这个 |
| `medium` | int8_float16 | 1 | 1 | ~0.8 GB | 显存紧张或追求更快时用 |
| `small` / `base` / `tiny` | int8_float16 | 1 | 1 | <0.5 GB | 只建议当探针用，质量明显下降 |
| `large-v3-turbo` | int8_float16 | 1 | 1 | ~1.6 GB | 更快，需先下载转换，见 §2.4 |

> **v2 还是 v3？**
> 本机实测 `model.bin` 体积：large-v2 = **3086.9 MB**，large-v3 = **3087.3 MB**——
> **两者完全相同**，显存占用、推理速度零差别。
> 官方说明 v3 在英文、数字、代码上更好，但我手头没有 v2 vs v3 的直接对比数据
> （你那份"更好"的产出就是 large-v2 出的，证明不了 v3 更优）。
> 想完全对齐卡卡字幕助手的输出，改一行即可：
> ```bat
> set FW_MODEL=large-v2
> ```
> 真要判定，拿一个中英混合视频各跑一遍对比 `.srt` 更靠谱。

> **`beam_size` 为什么是 1 不是 5？**
> 插件里原来的 `asrBeamSize: 5` 是 Whisper 官方默认值，但它让解码成本涨约 3 倍，对中文直播内容几乎无收益。
> `beam_size=1`（贪心解码）在 `large-v3` 上是最优性价比点。追求极限准确率可设 `FW_BEAM_SIZE=5`，代价是慢 2~3 倍。
> `best_of` 同理：它控制"多候选里选一个"，默认 5 也是 3 倍开销。设 1 即可。

### 2.2 量化与 compute_type（2080 Ti 重点）

服务端默认 **`int8_float16`**，这是 2080 Ti 上的最优选择：

| compute_type | 权重 | 激活 | 显存 | 速度 | 质量 |
|---|---|---|---|---|---|
| `float16` | FP16 | FP16 | ~3 GB | 基准 | 基准 |
| **`int8_float16`** | **INT8** | **FP16** | **~1.5 GB** | **快 20~40%** | **几乎无损** |
| `int8` | INT8 | INT8 | ~1.5 GB | 快 30~50% | 有可感知的损失 |

**为什么 int8_float16 更好**：2080 Ti 是 Turing 架构（sm_75），**INT8 Tensor Core 吞吐是 FP16 的 2 倍**（132 TOPS vs 66.2 TFLOPS），权重换 INT8 后显存带宽需求也减半。而激活仍保持 FP16，所以精度损失微乎其微——这也是 CTranslate2 官方对 GPU 的推荐设置。

**不需要离线转换**：模型文件本身是 float16（本机实测确认），CTranslate2 会在**加载时自动把权重量化成 int8**。首次加载会多花几秒钟，之后无额外开销。已实测验证：float16 模型直接以 `int8` compute_type 加载成功。

**CPU 用户**：CPU 不支持 `float16` 和 `int8_float16`（实测确认），只能用 `int8`。服务端已做成设备自适应：

```
device=cuda -> int8_float16
device=cpu  -> int8
```

要强制指定，设 `FW_COMPUTE`：

```bat
set FW_COMPUTE=float16        :: 想与卡卡字幕助手 bit-exact 对齐时用
set FW_COMPUTE=int8_float16   :: 默认
set FW_COMPUTE=int8           :: CPU，或追求极致速度
```

> **2080 Ti 硬限制：不支持 bfloat16**。别设 `FW_COMPUTE=bfloat16`，会直接报错。

### 2.3 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `FW_MODEL` | `large-v3` | 模型名 / 本地目录名 / 绝对路径 |
| `FW_MODEL_BASE_DIR` | `D:\Green\卡卡字幕助手VideoCaptioner\AppData\models` | 本地模型根目录 |
| `FW_DEVICE` | `cuda` | `cuda` / `cpu` |
| `FW_DEVICE_INDEX` | `0` | GPU 序号 |
| `FW_COMPUTE` | `int8_float16`（cuda）/ `int8`（cpu） | 按设备自适应，见 §2.2 |
| `FW_BEAM_SIZE` | 按 PRESETS（1） | 解码 beam 数 |
| `FW_BEST_OF` | 按 PRESETS（1） | 多候选数 |
| `FW_VAD` | `true` | **保持开启**，静音不喂模型，省 30~40% 时间 |
| `FW_VAD_MIN_SILENCE_MS` | `500` | 静音切分阈值。调大→字幕条更少更长；调小→更碎 |
| `FW_VAD_MAX_SPEECH_S` | `60` | 单段最长时长，防止长段压垮显存 |
| `FW_CONDITION_PREV` | `false` | 是否用上一段做上下文偏置。中文直播建议关 |
| `FW_NUM_WORKERS` | `1` | |
| `FW_CPU_THREADS` | `4` | i5-10400 有 6 核，设 4~6 |
| `FW_SUB_MAX_CHARS` | `42` | 字幕条最大字数 |
| `FW_SUB_MAX_DUR` | `8.0` | 字幕条最长秒数 |
| `FW_SUB_PAUSE` | `0.8` | 停顿切分阈值（秒） |
| `FW_HOTWORDS` | 空 | **术语表**，如 `AI,美股,币圈,BTC,SPY,NVIDIA` |
| `FW_MAX_INITIAL_TIMESTAMP` | `1.0` | |

> **`FW_HOTWORDS` 是术语注入的正解**
> faster-whisper 1.2.1 有原生 `hotwords` 参数，比把术语拼进 `initial_prompt` 更干净、更准。
> 你的场景（美股 / 币圈 / AI）建议直接设：
> ```bat
> set FW_HOTWORDS=AI,美股,币圈,BTC,ETH,SPY,NASDAQ,NVIDIA,Robinhood
> ```

### 2.3 长音频分句逻辑

词级时间戳 → 字幕条的聚合由 `asr_engines/common.py::build_cues()` 完成，断条规则（任一满足即断）：

1. 上一句以句末标点收尾
2. 当前条时长 ≥ `FW_SUB_MAX_DUR`
3. 当前条字数 ≥ `FW_SUB_MAX_CHARS`
4. 与上一条间隔 ≥ `FW_SUB_PAUSE`

中文直播建议默认值即可；想让字幕更"整"，把 `FW_SUB_PAUSE` 调到 `1.2`。

---

## 3. qwen3 引擎（备用）

Qwen3-ASR-1.7B + Qwen3-ForcedAligner-0.6B。中文/中英夹杂极限准确率最高，但**在你这张卡上比音频本身还慢**（实测 1.50× 实时，85 分钟视频跑了 57 分钟）。

### 3.1 为什么慢（实测结论）

拿同一份 85.6 分钟视频实测对比：

| | faster-whisper | Qwen3-ASR |
|---|---|---|
| 墙钟 | 14.0 分钟 | 56.9 分钟 |
| 处理速度 | 6.11× 实时 | 1.50× 实时 |
| 标点率 | 85% | 0% |
| 金融术语 | `SPYMA225,NVIDIAMA225` ✓ | `二二五NV的M A二二五` ✗ |

慢的根因：

1. **无 VAD** —— 整段音频含静音逐块解码，多算 30~40%
2. **ForcedAligner 二次遍历** —— 1.7B 识别完再跑 0.6B 对齐，等于跑两遍模型
3. **PyTorch fp16 vs CTranslate2 int8** —— 2080 Ti 上 INT8 是 132 TOPS、FP16 只有 66.2 TFLOPS，峰值就差 2×
4. **240s 切块** —— 单次 encoder 前向吞 240s 音频，注意力是 O(n²)
5. **生成式 LLM 逐 token** —— 每个 token 一次完整 1.7B 前向，2080 Ti 无 FlashAttention-2

已知质量缺陷（同一份样本）：

- **无标点**：0%，连续中文没有断句
- **术语幻觉**：`SPY` 丢、`NVIDIA`→`NV`、数字 `225`→`二二五`
- **重复**：`等着吧等着等着`
- **丢字**：`轻微的`→`微的`

### 3.2 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `QWEN_ASR_MODEL` | `Qwen/Qwen3-ASR-1.7B` | |
| `QWEN_ALIGNER_MODEL` | `Qwen/Qwen3-ForcedAligner-0.6B` | 词级时间戳必需 |
| `QWEN_ASR_CHUNK_SECONDS` | `240` | 单段 ≤5 分钟，受对齐器限制 |
| `QWEN_ASR_MAX_NEW_TOKENS` | `2048` | |
| `QWEN_ASR_BATCH` | `1` | |
| `QWEN_ASR_HOTWORDS` | 空 | 拼进 context 文本的领域热词 |

> **`QWEN_ASR_CHUNK_SECONDS` 不要随意调大**
> 超过 240s 会让单段 encoder 前向的显存和耗时非线性上涨。240s 是 `ForcedAligner` 的建议上限。

---

## 4. 通用配置（对所有引擎生效）

| 变量 | 默认 | 说明 |
|---|---|---|
| `WHISPER_DEFAULT_LANGUAGE` | 空（自动检测） | 建议设 `zh`，跳过语言检测省一次前向 |
| `WHISPER_DEFAULT_INITIAL_PROMPT` | 空 | 上下文偏置 |
| `QWEN_ASR_HOTWORDS` | 空 | 领域热词（faster-whisper 走 `FW_HOTWORDS` 更准） |
| `WHISPER_MODEL_BASE_DIR` | `D:\Green\卡卡字幕助手VideoCaptioner\AppData\models` | 本地模型根目录 |
| `WHISPER_DEVICE` | `cuda` | 兼容旧变量名 |
| `WHISPER_COMPUTE` | `int8_float16` | 兼容旧变量名 |
| `ASR_PORT` | `2233` | 仅用于启动横幅显示 |
| `ASR_HF_ENDPOINT` | `https://hf-mirror.com` | HF 镜像。直连可用时设 `https://huggingface.co` |
| `_BOOT_GUARD` | 空 | 设 `1` 可跳过模型加载（仅冒烟测试用） |

---

## 5. 硬件适配（RTX 2080 Ti）

2080 Ti 是 Turing 架构（compute capability 7.5），**两个硬限制**：

- **不支持 bfloat16** —— 别设 `FW_COMPUTE=bfloat16`，会直接报错。用 `int8_float16`
- **不支持 FlashAttention-2** —— 需要 sm_80（Ampere）及以上。这是 Qwen3-ASR 在你卡上慢的原因之一

**但 INT8 Tensor Core 是它的强项**：INT8 吞吐 132 TOPS，是 FP16 的 2 倍（66.2 TFLOPS）。
所以 2080 Ti 上 **`int8_float16` 是最优 compute_type**，见 §2.2。

显存占用参考（int8_float16 为默认）：

| 模型 | float16 | int8_float16 |
|---|---|---|
| Qwen3-ASR-1.7B + Aligner-0.6B | ~4.6 GB | 不支持（PyTorch 路径） |
| faster-whisper large-v3 | ~3.1 GB | **~1.6 GB**（默认） |
| faster-whisper medium | ~1.6 GB | **~0.8 GB**（默认） |

11 GB 显存都能轻松装下，**瓶颈在速度不在显存**。

---

## 6. 模型文件与下载

本机 `huggingface.co` 直连超时，已默认走 `hf-mirror.com`。

| 用途 | 仓库 | 备注 |
|---|---|---|
| faster-whisper large-v3 | `Systran/faster-whisper-large-v3` | 已在本机，`model.bin` = 3087 MB |
| faster-whisper large-v2 | `Systran/faster-whisper-large-v2` | 已在本机 |
| faster-whisper medium | `Systran/faster-whisper-medium` | 已在本机 |
| Qwen3-ASR-1.7B | `Qwen/Qwen3-ASR-1.7B` | 已在本机 |
| Qwen3-ForcedAligner-0.6B | `Qwen/Qwen3-ForcedAligner-0.6B` | 已在本机 |
| SenseVoiceSmall | `FunAudioLLM/SenseVoiceSmall` | 936 MB，未做引擎分支 |

### large-v3-turbo（可选，需下载 + 转换）

`faster-whisper` 的 `download_model` **没有 quantization 参数**，只下载 float16 的
`model.bin`。Systran 也**没有**上传 turbo 的 CTranslate2 版
（`Systran/faster-whisper-large-v3-turbo` 是 404），所以 turbo 要自己转一次：

```bat
pip install ctranslate2-transformers
ct2-transformers-converter ^
    --model openai/whisper-large-v3-turbo ^
    --output_dir D:\Green\卡卡字幕助手VideoCaptioner\AppData\models\faster-whisper-large-v3-turbo ^
    --quantization int8_float16
```

转换后用 `set FW_MODEL=large-v3-turbo`。预期比 large-v3 快 ~2×，精度略降。

> **重要区分**：turbo 需要离线转换，是因为 Systran 没传转换版、而 `download_model`
> 下载不到 int8。但这**不等于**用 int8 就要转换——本机 large-v3 的 `model.bin` 是
> float16，设 `FW_COMPUTE=int8_float16` 时 CTranslate2 会在加载时自动量化，
> 已实测验证。两者的区别见 §2.2。

---

## 7. 快速验证

不加载模型，只验证接口契约与 SRT 字段：

```bat
cd scripts
set _BOOT_GUARD=1
python smoke_test_webui.py
```

预期输出 `=== ALL SMOKE TESTS PASSED ===`。

---

## 8. 排查清单

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动报模型加载失败 | 模型目录不存在 | 检查 `FW_MODEL_BASE_DIR`，或让 HF 镜像下载 |
| 启动报 `bfloat16 not supported` | 2080 Ti 不支持 bf16 | 用 `int8_float16`（默认） |
| 启动报 `int8_float16 not supported` | 在 CPU 上跑了 | 设 `FW_DEVICE=cpu` 会自动落到 `int8`，或改回 GPU |
| 日志说"VAD 相关失败，回退为无 VAD" | silero-vad 未装 | `pip install faster-whisper` 会带 |
| 首次推理特别慢 | CUDA 内核首次编译 | 正常，同进程第二次起明显快 |
| 网页打不开 | 端口被占 | `netstat -ano \| findstr 2233` |
| 输出没有标点 | 用了 qwen3 引擎 | 切回 `ASR_ENGINE=faster-whisper` |
| 金融术语识别错 | 没设 hotwords | `set FW_HOTWORDS=SPY,NVIDIA,BTC,...` |
