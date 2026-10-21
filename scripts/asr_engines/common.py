# -*- coding: utf-8 -*-
"""
ASR 引擎共享工具
================================================================
与「识别引擎」无关的纯工具函数：音频预处理、时间格式化、字幕条聚合、
语言代码规范化、模型路径解析、上下文偏置拼接。

设计约束：
  * 本模块**不依赖 FastAPI**，也**不导入任何具体 ASR 模型库**
    （torch / faster_whisper / qwen_asr 一律不碰），
    因此可被冒烟测试或离线脚本单独导入，不会误触模型加载或占用 GPU。
  * 所有引擎（Qwen3-ASR / Faster-Whisper / 未来新增）从这里复用同一套
    字幕与时间戳逻辑，保证不同引擎产出的 SRT 格式完全一致。

字幕条（cue）统一结构：
    {"text": str, "start": float, "end": float}
"""

import os
import re
import shutil
import subprocess
import time


# ------------------------------------------------------------------ #
# 时间格式化
# ------------------------------------------------------------------ #
def format_seconds(seconds):
    """行内时间戳：[mm:ss] 或 [hh:mm:ss]"""
    total_sec = max(0, int(seconds))
    h = total_sec // 3600
    m = (total_sec % 3600) // 60
    s = total_sec % 60
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def format_srt_time(seconds):
    """SRT 时间戳：HH:MM:SS,mmm"""
    ms = int(round(max(0.0, float(seconds)) * 1000))
    h = ms // 3600000
    m = (ms % 3600000) // 60000
    s = (ms % 60000) // 1000
    mmm = ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{mmm:03d}"


# ------------------------------------------------------------------ #
# ffmpeg / 音频读取
# ------------------------------------------------------------------ #
def find_ffmpeg():
    """优先使用本地随工具带出的 ffmpeg.exe，回退到 PATH。"""
    local_ffmpeg = r"D:\Green\卡卡字幕助手VideoCaptioner\resource\bin\ffmpeg.exe"
    if os.path.exists(local_ffmpeg):
        return local_ffmpeg
    return shutil.which("ffmpeg")


def to_wav16k(src_path):
    """用 ffmpeg 转成 16kHz 单声道 wav；ffmpeg 不可用时返回 None。

    输出文件名固定为 ``<src>.16k.wav``，存在则直接复用，避免重复转码。
    若源媒体不含音轨会抛出 ValueError（带中文提示，供上层转为 400 响应）。
    """
    ffmpeg_bin = find_ffmpeg()
    if not ffmpeg_bin:
        return None

    out_path = src_path + ".16k.wav"
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return out_path

    cmd = [
        ffmpeg_bin, "-y", "-i", src_path,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", out_path,
    ]
    res = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="ignore",
    )
    if res.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        print(f"[{time.strftime('%H:%M:%S')}] 已通过 ffmpeg 提取 16kHz 音频: {out_path}")
        return out_path

    err_msg = res.stderr or ""
    if "does not contain any stream" in err_msg or "Output file does not contain any stream" in err_msg:
        raise ValueError("媒体文件不包含任何音频轨 (Audio Stream)，无法进行语音转文字！")
    return None


def load_wav_mono16k(path):
    """读取音频为 float32 单声道 numpy 波形。"""
    import numpy as np
    import soundfile as sf

    wav, sr = sf.read(path, dtype="float32", always_2d=False)
    wav = np.asarray(wav, dtype=np.float32)
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    return wav, int(sr)


# ------------------------------------------------------------------ #
# 词/字级时间戳 -> 字幕条 (cue) -> 行内文本 / SRT
# ------------------------------------------------------------------ #
_SENT_END = re.compile(r"[。！？!?；;…」』”\"']\s*$")


def _join_text(a, b):
    """拼接时间戳 token；相邻 ASCII 字母数字之间补空格。"""
    if not a:
        return b
    if not b:
        return a
    if a[-1].isascii() and a[-1].isalnum() and b[0].isascii() and b[0].isalnum():
        return a + " " + b
    return a + b


def build_cues(items, max_chars=42, max_dur=8.0, pause=0.8):
    """把词/字级时间戳聚合成字幕条。

    items: [{'text': str, 'start': float, 'end': float}, ...]

    断句依据（任一满足即断条）：
      1. 上一句以句末标点收尾；
      2. 当前条时长达到 max_dur；
      3. 当前条字数达到 max_chars；
      4. 与上一条之间存在 >= pause 的停顿。
    """
    cues = []
    cur = None
    for it in items:
        text = (it.get("text") or "").strip()
        if not text:
            continue
        st = float(it.get("start", 0.0))
        en = float(it.get("end", st))
        if cur is None:
            cur = {"start": st, "end": en, "text": text}
            continue

        gap = st - cur["end"]
        dur = en - cur["start"]
        should_break = (
            bool(_SENT_END.search(cur["text"]))
            or dur >= max_dur
            or len(cur["text"]) >= max_chars
            or gap >= pause
        )
        if should_break:
            cues.append(cur)
            cur = {"start": st, "end": en, "text": text}
        else:
            cur["text"] = _join_text(cur["text"], text)
            cur["end"] = en

    if cur:
        cues.append(cur)
    return [c for c in cues if c["text"].strip()]


def build_inline_text(cues):
    """兼容旧版的带内联 [mm:ss] 的文本（扩展端缓存校验与思维导图引用依赖此格式）。"""
    return "\n".join(f"[{format_seconds(c['start'])}] {c['text']}" for c in cues)


def build_srt(cues):
    """生成标准 SRT 字幕文本。"""
    blocks = []
    for i, c in enumerate(cues, 1):
        blocks.append(str(i))
        blocks.append(f"{format_srt_time(c['start'])} --> {format_srt_time(c['end'])}")
        blocks.append(c["text"])
        blocks.append("")
    return "\n".join(blocks)


# ------------------------------------------------------------------ #
# 语言代码
# ------------------------------------------------------------------ #
# 统一规范成 Whisper 风格的小写代码，各引擎在此基础上做自己的二次映射。
LANGUAGE_CODES = {
    "zh": "zh", "zh-cn": "zh", "zh-tw": "zh", "zh-hans": "zh", "zh-hant": "zh",
    "cmn": "zh", "chinese": "zh",
    "zh-yue": "yue", "yue": "yue", "cantonese": "yue",
    "en": "en", "english": "en",
    "ja": "ja", "jp": "ja", "japanese": "ja",
    "ko": "ko", "kr": "ko", "korean": "ko",
    "fr": "fr", "french": "fr",
    "de": "de", "german": "de",
    "es": "es", "spanish": "es",
    "ru": "ru", "russian": "ru",
    "it": "it", "italian": "it",
    "pt": "pt", "portuguese": "pt",
    "ar": "ar", "arabic": "ar",
    "th": "th", "thai": "th",
    "vi": "vi", "vietnamese": "vi",
    "id": "id", "indonesian": "id",
    "ms": "ms", "malay": "ms",
    "tr": "tr", "turkish": "tr",
    "nl": "nl", "dutch": "nl",
    "pl": "pl", "polish": "pl",
    "hi": "hi", "hindi": "hi",
}


def normalize_language(value):
    """把用户输入的语言别名规范化为统一代码；空值返回 None（表示自动检测）。"""
    if not value:
        return None
    v = str(value).strip().lower()
    return LANGUAGE_CODES.get(v, v)


# ------------------------------------------------------------------ #
# 上下文偏置
# ------------------------------------------------------------------ #
def build_context(initial_prompt=None, hotwords=None):
    """把 initial_prompt 与领域热词合并为一段上下文偏置文本。

    引擎侧自行决定如何投放：Qwen3 走 context 字段，
    faster-whisper 走 initial_prompt 字段（另有独立 hotwords 参数）。
    """
    parts = []
    if initial_prompt:
        parts.append(str(initial_prompt).strip())
    if hotwords:
        parts.append(str(hotwords).strip())
    ctx = "\n".join([p for p in parts if p])
    return ctx or None


# ------------------------------------------------------------------ #
# 模型路径解析
# ------------------------------------------------------------------ #
def resolve_model_path(name, base_dir):
    """把模型名解析为本地目录；找不到则原样返回（交由框架走 HF 联网/缓存加载）。

    候选顺序：
      1. ``<base_dir>/<name>`                  —— 全名，如 Qwen/Qwen3-ASR-1.7B
      2. ``<base_dir>/<basename>`              —— 仅目录名，如 Qwen3-ASR-1.7B
      3. ``<base_dir>/faster-whisper-<name>`   —— faster-whisper 历史命名习惯
    """
    if not name:
        return name
    if os.path.exists(name):
        return name
    if os.path.isabs(name):
        return name
    base = os.path.basename(name)
    candidates = [
        os.path.join(base_dir, name),
        os.path.join(base_dir, base),
        os.path.join(base_dir, f"faster-whisper-{name}"),
    ]
    for c in candidates:
        if os.path.isdir(c):
            return c
    return name
