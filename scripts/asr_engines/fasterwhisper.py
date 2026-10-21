# -*- coding: utf-8 -*-
"""
引擎：Faster-Whisper（CTranslate2 加速版，默认引擎）
================================================================
OpenAI Whisper 的 C++ 实现，RTX 2080 Ti 上的**速度与质量平衡点**：
  * 比 Qwen3-ASR-1.7B 快很多（无 1.7B 自回归解码、无二次对齐遍历）；
  * 内置 Silero VAD，**自动跳过静音**，对长视频收益最大；
  * ``word_timestamps=True`` 直接产出词级时间戳 -> 标准 SRT；
  * ``hotwords`` 参数原生支持术语偏置（AI、美股、币圈），
    不需要像 Qwen3 那样拼进 context 文本。

模型切换会自动套用该模型的最优参数（见下方 PRESETS 与 ENGINE_PARAMS.md），
环境变量可再逐一项覆盖。

环境变量（全部可选）：
  FW_MODEL                   模型名/目录，默认 large-v3
  FW_MODEL_BASE_DIR          本地模型根目录（默认同 WHISPER_MODEL_BASE_DIR）
  FW_DEVICE                  cuda / cpu，默认 cuda
  FW_DEVICE_INDEX            默认 0
  FW_COMPUTE                 float16 / int8_float16 / int8，默认按 PRESETS
  FW_BEAM_SIZE               默认按 PRESETS（large-v3=1）
  FW_BEST_OF                 默认按 PRESETS（1）
  FW_VAD                     true / false，默认 true
  FW_VAD_MIN_SILENCE_MS      VAD 静音切分阈值，默认 500
  FW_VAD_MAX_SPEECH_S        VAD 单段最长时长，默认 60
  FW_CONDITION_PREV          是否用上一段上下文偏置，默认 false
  FW_NUM_WORKERS             默认 1
  FW_CPU_THREADS             默认 4
  FW_SUB_MAX_CHARS           字幕条最大字数，默认 42
  FW_SUB_MAX_DUR             字幕条最长时长(秒)，默认 8.0
  FW_SUB_PAUSE               字幕条停顿切分阈值(秒)，默认 0.8
  FW_HOTWORDS                术语表，逗号/空格分隔
  FW_MAX_INITIAL_TIMESTAMP   默认 1.0
"""

import os
import re
import time

from asr_engines.base import ASREngine
from asr_engines.common import resolve_model_path


# ------------------------------------------------------------------ #
# 各模型最优参数预设
# 说明：切换 FW_MODEL 时自动套用；环境变量可再逐项覆盖。
# 详见 scripts/ENGINE_PARAMS.md
# ------------------------------------------------------------------ #
# compute_type 不写死在预设里，由 load_config() 按 device 推导：
#   cuda -> int8_float16   (INT8 权重 + FP16 激活；Turing/Ampere Tensor Core 最优)
#   cpu  -> int8           (CPU 不支持 int8_float16，只能用纯 int8)
# 模型文件本身是 float16，CTranslate2 会在加载时自动量化，无需离线转换。
PRESETS = {
    "large-v3":     dict(beam_size=1, best_of=1),
    "large-v3-ct2": dict(beam_size=1, best_of=1),
    "large-v2":     dict(beam_size=1, best_of=1),
    "large-v1":     dict(beam_size=1, best_of=1),
    "large":        dict(beam_size=1, best_of=1),
    "medium":       dict(beam_size=1, best_of=1),
    "small":        dict(beam_size=1, best_of=1),
    "tiny":         dict(beam_size=1, best_of=1),
    "large-v3-turbo": dict(beam_size=1, best_of=1),
    "turbo":          dict(beam_size=1, best_of=1),
}

DEFAULT_PRESET = PRESETS["large-v3"]


def _get_bool(env_name, default):
    v = os.getenv(env_name)
    if v is None:
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _get_int(env_name, default):
    v = os.getenv(env_name)
    if v is None:
        return default
    try:
        return int(str(v).strip())
    except ValueError:
        return default


def _get_float(env_name, default):
    v = os.getenv(env_name)
    if v is None:
        return default
    try:
        return float(str(v).strip())
    except ValueError:
        return default


def load_config():
    """读取模型名 -> 套用预设 -> 环境变量覆盖，得到最终参数表。"""
    model = os.getenv("FW_MODEL", os.getenv("WHISPER_MODEL", "large-v3"))
    key = str(model).strip().lower()
    # 目录形式的模型名也尝试匹配关键字（如 faster-whisper-large-v3、...-turbo）
    preset = PRESETS.get(key, PRESETS.get(key.replace("faster-whisper-", ""), DEFAULT_PRESET))
    if "turbo" in key:
        preset = PRESETS["large-v3-turbo"]

    return {
        "model": model,
        "model_base_dir": os.getenv(
            "FW_MODEL_BASE_DIR",
            os.getenv("WHISPER_MODEL_BASE_DIR", r"D:\Green\卡卡字幕助手VideoCaptioner\AppData\models"),
        ),
        "device": os.getenv("FW_DEVICE", os.getenv("WHISPER_DEVICE", "cuda")),
        "device_index": _get_int("FW_DEVICE_INDEX", 0),
        "compute_type": os.getenv(
            "FW_COMPUTE",
            "int8" if str(os.getenv("FW_DEVICE", os.getenv("WHISPER_DEVICE", "cuda"))).lower() == "cpu"
            else "int8_float16",
        ),
        "beam_size": _get_int("FW_BEAM_SIZE", preset["beam_size"]),
        "best_of": _get_int("FW_BEST_OF", preset["best_of"]),
        "vad_filter": _get_bool("FW_VAD", True),
        "vad_min_silence_ms": _get_int("FW_VAD_MIN_SILENCE_MS", 500),
        "vad_max_speech_s": _get_float("FW_VAD_MAX_SPEECH_S", 60.0),
        "condition_on_previous_text": _get_bool("FW_CONDITION_PREV", False),
        "num_workers": _get_int("FW_NUM_WORKERS", 1),
        "cpu_threads": _get_int("FW_CPU_THREADS", 4),
        "sub_max_chars": _get_int("FW_SUB_MAX_CHARS", 42),
        "sub_max_dur": _get_float("FW_SUB_MAX_DUR", 8.0),
        "sub_pause": _get_float("FW_SUB_PAUSE", 0.8),
        "hotwords": os.getenv("FW_HOTWORDS", "").strip() or None,
        "max_initial_timestamp": _get_float("FW_MAX_INITIAL_TIMESTAMP", 1.0),
        "preset": preset,
    }


# 被拒绝的未知参数名，用于逐步降级重试
_UNKNOWN_ARG_RE = re.compile(r"unexpected keyword argument '([A-Za-z0-9_]+)'")


class FasterWhisperEngine(ASREngine):
    """Faster-Whisper 引擎（默认；RTX 2080 Ti 速度/质量平衡点）。"""

    name = "faster-whisper"
    display_name = "Faster-Whisper (CTranslate2)"

    def __init__(self):
        super().__init__()
        self.cfg = load_config()
        self.model_path = resolve_model_path(self.cfg["model"], self.cfg["model_base_dir"])

    # ------------------------------------------------------------------ #
    def load(self) -> bool:
        c = self.cfg
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 正在初始化 {self.display_name} 服务...")
        print(f"模型: {c['model']}  ->  本地路径: {self.model_path}")
        print(f"设备: {c['device']}:{c['device_index']}  精度: {c['compute_type']}")
        print(f"参数: beam_size={c['beam_size']}  best_of={c['best_of']}  "
              f"VAD={c['vad_filter']}  word_timestamps=True")
        print(f"VAD: min_silence={c['vad_min_silence_ms']}ms  max_speech={c['vad_max_speech_s']}s")
        print(f"字幕: max_chars={c['sub_max_chars']}  max_dur={c['sub_max_dur']}s  "
              f"pause={c['sub_pause']}s")
        if c["hotwords"]:
            print(f"术语表(hotwords): {c['hotwords']}")
        print(f"上下文条件(condition_on_previous_text): {c['condition_on_previous_text']}")

        try:
            from faster_whisper import WhisperModel

            local_dir = self.model_path if os.path.isdir(self.model_path) else None
            self.model = WhisperModel(
                local_dir if local_dir else c["model"],
                device=c["device"],
                device_index=c["device_index"],
                compute_type=c["compute_type"],
                num_workers=c["num_workers"],
                cpu_threads=c["cpu_threads"],
                download_root=None if local_dir else c["model_base_dir"],
            )
            print("模型加载成功！")
            return True
        except Exception as e:
            print(f"模型加载失败: {e}")
            print(f"  提示: 如需 int8 模型，请先用 ct2 转换工具生成；"
                  f"如需在线下载，请确认能访问 HuggingFace（或设置 HF_ENDPOINT 镜像）")
            import traceback
            traceback.print_exc()
            return False

    # ------------------------------------------------------------------ #
    def _transcribe_with_fallback(self, audio_path, kw):
        """逐步丢弃不被当前 faster-whisper 版本支持的参数后重试。

        1.2.x 新增了 hotwords / hallucination_silence_threshold / vad_parameters 等
        参数，旧版本会报 unexpected keyword argument；这里自动降级保证兼容。
        """
        cur = dict(kw)
        dropped = []
        while True:
            try:
                return self.model.transcribe(audio_path, **cur)
            except TypeError as e:
                m = _UNKNOWN_ARG_RE.search(str(e))
                if m and m.group(1) in cur:
                    bad = m.group(1)
                    cur.pop(bad, None)
                    dropped.append(bad)
                    continue
                raise
        # 不会走到这里；保留以满足静态检查
        if dropped:
            print(f"  已自动忽略不支持的参数: {', '.join(dropped)}")

    # ------------------------------------------------------------------ #
    def transcribe(self, audio_path: str, language=None, context=None) -> dict:
        """同步转录：ffmpeg 转码 -> VAD+解码 -> 词级时间戳 -> 字幕条 -> 行内文本/SRT。"""
        from asr_engines.common import build_cues, to_wav16k

        wav_path = to_wav16k(audio_path) or audio_path
        c = self.cfg

        kw = dict(
            beam_size=c["beam_size"],
            best_of=c["best_of"],
            condition_on_previous_text=c["condition_on_previous_text"],
            word_timestamps=True,
            vad_filter=c["vad_filter"],
            vad_parameters=dict(
                min_silence_duration_ms=c["vad_min_silence_ms"],
                max_speech_duration_s=c["vad_max_speech_s"],
            ),
            max_initial_timestamp=c["max_initial_timestamp"],
        )
        if language:
            kw["language"] = language
        if context:
            kw["initial_prompt"] = context
        if c["hotwords"]:
            kw["hotwords"] = c["hotwords"]

        use_vad = bool(c["vad_filter"])
        try:
            segments, info = self._transcribe_with_fallback(wav_path, kw)
        except Exception as e:
            if use_vad:
                print(f"[{time.strftime('%H:%M:%S')}] VAD 相关失败（{e}），"
                      f"回退为无 VAD 模式重试...")
                kw["vad_filter"] = False
                kw.pop("vad_parameters", None)
                segments, info = self._transcribe_with_fallback(wav_path, kw)
                use_vad = False
            else:
                raise

        items = []
        detected_lang = None
        try:
            detected_lang = getattr(info, "language", None)
        except Exception:
            pass

        t0 = time.time()
        seg_count = 0
        for seg in segments:
            seg_count += 1
            seg_text = (getattr(seg, "text", "") or "").strip()
            st = float(getattr(seg, "start", 0.0))
            en = float(getattr(seg, "end", st))
            words = getattr(seg, "words", None) or []

            if words:
                for w in words:
                    wtext = (getattr(w, "word", "") or "").strip()
                    if not wtext:
                        continue
                    items.append({
                        "text": wtext,
                        "start": float(getattr(w, "start", st)),
                        "end": float(getattr(w, "end", en)),
                    })
            elif seg_text:
                # 无词级时间戳时退化为整段一条
                items.append({"text": seg_text, "start": st, "end": en})

            if seg_count % 20 == 0 or (use_vad and seg_count == 1):
                print(f"[{time.strftime('%H:%M:%S')}] 已处理 {seg_count} 段，"
                      f"当前进度 {en:.1f}s，累计 {time.time() - t0:.1f}s")

        elapsed = time.time() - t0
        dur = getattr(info, "duration", None)
        dur_txt = f"音频 {dur:.1f}s / " if dur else ""
        print(f"[{time.strftime('%H:%M:%S')}] 转录完成：{seg_count} 段 / "
              f"{len(items)} 个时间戳词条 / {dur_txt}耗时 {elapsed:.1f}s")

        return self.finish(
            build_cues(items, c["sub_max_chars"], c["sub_max_dur"], c["sub_pause"]),
            detected_lang or language or "auto",
        )

    # ------------------------------------------------------------------ #
    def describe(self) -> dict:
        c = self.cfg
        return {
            "engine": self.name,
            "display_name": self.display_name,
            "model": c["model"],
            "device": f"{c['device']}:{c['device_index']}",
            "compute_type": c["compute_type"],
            "beam_size": c["beam_size"],
            "best_of": c["best_of"],
            "vad_filter": c["vad_filter"],
            "word_timestamps": True,
            "hotwords": c["hotwords"],
        }
