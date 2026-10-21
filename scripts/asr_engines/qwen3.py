# -*- coding: utf-8 -*-
"""
引擎：Qwen3-ASR-1.7B + Qwen3-ForcedAligner-0.6B
================================================================
原 whisper_server.py 中的 Qwen3 识别逻辑整体迁入此处，改为标准
``ASREngine`` 实现。接口与对外 HTTP 契约完全不变。

特点与取舍：
  * 精度高：中文 / 中英夹杂 / 专业术语（AI、美股、币圈）表现最好；
  * **速度慢**：1.7B 自回归解码 + 0.6B 强制对齐二次遍历，无内置 VAD，
    对整段音频（含静音）逐块解码。日常批处理可用，追求速度请改用
    ``faster-whisper`` 引擎。
  * 长音频按 ``CHUNK_SECONDS``（默认 240s）在静音谷处切块，
    避免切断句子，也避免单段过长压垮显存。

环境变量（全部可选）：
  QWEN_ASR_MODEL            HF 仓库名或本地目录名，默认 Qwen/Qwen3-ASR-1.7B
  QWEN_ALIGNER_MODEL        对齐模型，默认 Qwen/Qwen3-ForcedAligner-0.6B
  WHISPER_MODEL_BASE_DIR    本地模型根目录
  WHISPER_DEVICE            cuda / cpu，默认 cuda
  WHISPER_COMPUTE           float16 / bfloat16，默认 float16
  QWEN_ASR_CHUNK_SECONDS    切块长度，默认 240
  QWEN_ASR_MAX_NEW_TOKENS   默认 2048
  QWEN_ASR_BATCH            默认 1
"""

import os
import time
import traceback

import numpy as np

from asr_engines.base import ASREngine
from asr_engines.common import resolve_model_path


# ------------------------------------------------------------------ #
# 引擎专属配置（优先级：环境变量 > 代码默认值）
# ------------------------------------------------------------------ #
MODEL_NAME = os.getenv("QWEN_ASR_MODEL", os.getenv("WHISPER_MODEL", "Qwen/Qwen3-ASR-1.7B"))
ALIGNER_NAME = os.getenv("QWEN_ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B")

MODEL_BASE_DIR = os.getenv(
    "WHISPER_MODEL_BASE_DIR",
    r"D:\Green\卡卡字幕助手VideoCaptioner\AppData\models",
)

DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "float16")
# 以下两个仅为兼容旧启动脚本而保留（Qwen3-ASR 内部自行调度并行）
NUM_WORKERS = int(os.getenv("WHISPER_NUM_WORKERS", 1))
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", 4))

# 长音频切块长度（秒）。ForcedAligner 单段建议不超过 5 分钟
CHUNK_SECONDS = float(os.getenv("QWEN_ASR_CHUNK_SECONDS", "240"))
MAX_NEW_TOKENS = int(os.getenv("QWEN_ASR_MAX_NEW_TOKENS", "2048"))
BATCH_SIZE = int(os.getenv("QWEN_ASR_BATCH", "1"))


def _resolve_device_map():
    d = str(DEVICE or "").lower()
    return "cuda:0" if d.startswith("cuda") else "cpu"


DEVICE_MAP = _resolve_device_map()


def _resolve_dtype():
    import torch

    ct = str(COMPUTE_TYPE or "").lower()
    if ct in ("bfloat16", "bf16"):
        # bfloat16 仅建议在 Ampere(sm_80) 及以上使用
        return torch.bfloat16
    # float16 / int8 等统一按 float16 处理：
    # RTX 2080 Ti (sm_75) 不支持 bf16 与 flash-attention-2，float16 最稳
    return torch.float16


# 统一语言代码 -> qwen-asr 期望的完整语言名
CODE_TO_QWEN_LANG = {
    "zh": "Chinese", "yue": "Cantonese", "en": "English", "ja": "Japanese",
    "ko": "Korean", "fr": "French", "de": "German", "es": "Spanish",
    "ru": "Russian", "it": "Italian", "pt": "Portuguese", "ar": "Arabic",
    "th": "Thai", "vi": "Vietnamese", "id": "Indonesian", "ms": "Malay",
    "tr": "Turkish", "nl": "Dutch", "pl": "Polish", "hi": "Hindi",
}


def to_qwen_language(code):
    """统一语言代码 -> qwen-asr 语言名；未知或空值原样返回。"""
    if not code:
        return None
    return CODE_TO_QWEN_LANG.get(code, code)


# ------------------------------------------------------------------ #
# 长音频切分（在目标点附近寻找静音谷，避免切断句子）
# ------------------------------------------------------------------ #
def _split_chunks(wav, sr, chunk_sec):
    total = len(wav)
    chunk = int(chunk_sec * sr)
    if chunk <= 0 or total <= chunk:
        return [(0, total)]

    spans = []
    start = 0
    search = int(20 * sr)   # 在目标点前后 20s 内搜索
    win = int(0.05 * sr)    # 50ms 能量窗

    while start < total:
        target = start + chunk
        if target >= total:
            spans.append((start, total))
            break

        lo = max(start + int(0.5 * chunk), target - search)
        hi = min(total, target + search)
        cut = target

        if hi - lo >= sr and win > 0:
            seg = np.ascontiguousarray(wav[lo:hi])
            n = len(seg) // win
            if n >= 2:
                frames = seg[: n * win].reshape(n, win)
                energies = np.mean(np.abs(frames), axis=1)
                idx = int(np.argmin(energies))
                cut = lo + idx * win + win // 2

        if cut <= start:
            cut = target
        spans.append((start, cut))
        start = cut

    return spans


# ------------------------------------------------------------------ #
# 时间戳字段兼容
# ------------------------------------------------------------------ #
def _ts_fields(it):
    """兼容不同字段命名的时间戳条目，返回 (text, start, end)。"""
    text = getattr(it, "text", None)
    if text is None:
        text = getattr(it, "word", None)
    if text is None:
        text = getattr(it, "token", "")

    st = getattr(it, "start_time", None)
    if st is None:
        st = getattr(it, "start", 0.0)
    en = getattr(it, "end_time", None)
    if en is None:
        en = getattr(it, "end", st)

    try:
        st = float(st)
        en = float(en)
    except Exception:
        st, en = 0.0, 0.0
    return (text or ""), st, en


class Qwen3Engine(ASREngine):
    """Qwen3-ASR-1.7B 引擎（高精度，含 ForcedAligner 词级时间戳）。"""

    name = "qwen3"
    display_name = "Qwen3-ASR-1.7B"

    def __init__(self):
        super().__init__()
        self.model_path = resolve_model_path(MODEL_NAME, MODEL_BASE_DIR)
        self.aligner_path = resolve_model_path(ALIGNER_NAME, MODEL_BASE_DIR)
        self.has_aligner = False

    # ------------------------------------------------------------------ #
    def load(self) -> bool:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 正在初始化 Qwen3-ASR 服务...")
        print(f"ASR 模型: {MODEL_NAME}")
        print(f"本地路径: {self.model_path}")
        print(f"对齐模型: {ALIGNER_NAME}")
        print(f"设备参数: {DEVICE} ({COMPUTE_TYPE})")
        return self._load_gpu() or self._load_cpu()

    def _load_gpu(self) -> bool:
        try:
            import torch
            from qwen_asr import Qwen3ASRModel

            dtype = _resolve_dtype()
            common = dict(
                dtype=dtype,
                device_map=DEVICE_MAP,
                max_inference_batch_size=BATCH_SIZE,
                max_new_tokens=MAX_NEW_TOKENS,
            )
            aligner_kwargs = dict(dtype=dtype, device_map=DEVICE_MAP)

            asr_arg = self.model_path if os.path.exists(self.model_path) else MODEL_NAME
            aligner_arg = self.aligner_path if os.path.exists(self.aligner_path) else ALIGNER_NAME

            if os.path.exists(self.model_path):
                print("检测到本地 ASR 模型，使用本地高性能模式。")
            else:
                print(f"本地未找到 {MODEL_NAME}，将尝试在线 / HF 缓存加载。")

            self.model = Qwen3ASRModel.from_pretrained(
                asr_arg,
                forced_aligner=aligner_arg,
                forced_aligner_kwargs=aligner_kwargs,
                **common,
            )
            self.has_aligner = True
            print("模型加载成功！(Qwen3-ASR + Qwen3-ForcedAligner)")
            return True
        except Exception as e:
            print(f"GPU 模型加载失败: {e}")
            print(traceback.format_exc())
            return False

    def _load_cpu(self) -> bool:
        print("尝试回退到 CPU 模式 (float32)...")
        try:
            import torch
            from qwen_asr import Qwen3ASRModel

            self.model = Qwen3ASRModel.from_pretrained(
                MODEL_NAME,
                dtype=torch.float32,
                device_map="cpu",
                max_new_tokens=MAX_NEW_TOKENS,
            )
            self.has_aligner = False
            print("CPU 模型加载成功！(无 ForcedAligner，时间戳将退化为整段单条)")
            return True
        except Exception as cpu_e:
            print(f"所有模型加载尝试均失败: {cpu_e}")
            return False

    # ------------------------------------------------------------------ #
    def _call_transcribe(self, audio, language, context):
        """audio 为 (np.ndarray, sr)。对不同 qwen-asr 版本做兼容性兜底。"""
        context_variants = (
            [{"context": context}, {"context": [context]}, {}] if context else [{}]
        )
        errors = []
        for cv in context_variants:
            kw = dict(audio=audio, language=language, return_time_stamps=self.has_aligner)
            kw.update(cv)
            try:
                return self.model.transcribe(**kw)
            except TypeError as e:
                errors.append(str(e))
                continue
        try:
            return self.model.transcribe(audio=audio, return_time_stamps=self.has_aligner)
        except Exception as e:
            raise RuntimeError(f"Qwen3-ASR 调用失败: {e} | 参数尝试错误: {errors[:2]}")

    # ------------------------------------------------------------------ #
    def transcribe(self, audio_path: str, language=None, context=None) -> dict:
        """同步执行：音频预处理 -> 分块转写 -> 聚合 -> 行内文本与 SRT。"""
        from asr_engines.common import build_cues, load_wav_mono16k, to_wav16k

        wav_path = to_wav16k(audio_path)
        if wav_path:
            wav, sr = load_wav_mono16k(wav_path)
        else:
            wav, sr = load_wav_mono16k(audio_path)

        if sr != 16000:
            print(f"[{time.strftime('%H:%M:%S')}] 注意：音频采样率为 {sr}Hz（建议 16000Hz）")

        spans = _split_chunks(wav, sr, CHUNK_SECONDS)
        print(f"[{time.strftime('%H:%M:%S')}] 音频时长 {len(wav) / float(sr):.1f}s，"
              f"切分为 {len(spans)} 段 (每段 {CHUNK_SECONDS:.0f}s)")

        qw_lang = to_qwen_language(language)
        items = []
        detected_lang = None
        for idx, (a, b) in enumerate(spans, 1):
            chunk = wav[a:b]
            offset = a / float(sr)
            results = self._call_transcribe((chunk, sr), qw_lang, context)
            r = results[0] if isinstance(results, (list, tuple)) and len(results) > 0 else results

            if detected_lang is None:
                detected_lang = getattr(r, "language", None)

            ts = getattr(r, "time_stamps", None) or []
            if ts:
                for t in ts:
                    text, st, en = _ts_fields(t)
                    items.append({"text": text, "start": st + offset, "end": en + offset})
            else:
                items.append({
                    "text": getattr(r, "text", "") or "",
                    "start": offset,
                    "end": offset + (b - a) / float(sr),
                })
            print(f"[{time.strftime('%H:%M:%S')}] 分段 {idx}/{len(spans)} 完成")

        return self.finish(build_cues(items), detected_lang or language or "auto")

    # ------------------------------------------------------------------ #
    def describe(self) -> dict:
        return {
            "engine": self.name,
            "display_name": self.display_name,
            "model": MODEL_NAME,
            "aligner": ALIGNER_NAME if self.has_aligner else None,
            "device": DEVICE_MAP,
            "compute_type": COMPUTE_TYPE,
            "chunk_seconds": CHUNK_SECONDS,
        }
