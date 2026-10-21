# -*- coding: utf-8 -*-
"""
ASR 引擎注册表
================================================================
服务端只依赖本模块的 ``create_engine()``，通过环境变量 ``ASR_ENGINE``
选择引擎；新增引擎只需在本文件的 ``ENGINES`` 中登记一行，
并在同级目录实现 ``ASREngine`` 子类即可，服务端与 HTTP 接口无需改动。

可用引擎：
  faster-whisper   （默认）Faster-Whisper / CTranslate2，速度快
  qwen3              Qwen3-ASR-1.7B + ForcedAligner，精度高
  whisper            faster-whisper 的别名

环境变量：
  ASR_ENGINE   faster-whisper | qwen3 | whisper，默认 faster-whisper
"""

import importlib
import os


#: 引擎名 -> (模块名, 类名)。模块按需惰性导入，避免把不用的模型库一起加载。
ENGINES = {
    "faster-whisper": ("asr_engines.fasterwhisper", "FasterWhisperEngine"),
    "fasterwhisper": ("asr_engines.fasterwhisper", "FasterWhisperEngine"),
    "whisper": ("asr_engines.fasterwhisper", "FasterWhisperEngine"),
    "ct2": ("asr_engines.fasterwhisper", "FasterWhisperEngine"),
    "qwen3": ("asr_engines.qwen3", "Qwen3Engine"),
    "qwen3-asr": ("asr_engines.qwen3", "Qwen3Engine"),
    "qwen": ("asr_engines.qwen3", "Qwen3Engine"),
}

DEFAULT_ENGINE = "faster-whisper"

#: 引擎环境变量前缀，方便在文档里统一引用
ENGINE_ENV = "ASR_ENGINE"


def available_engines():
    """返回已登记的引擎标识列表（不含别名重复项）。"""
    seen = []
    for name, (mod, cls) in ENGINES.items():
        key = f"{mod}.{cls}"
        if key not in seen:
            seen.append(key)
    return sorted(seen)


def select_engine_name():
    """按环境变量解析应使用的引擎名，非法值回退到默认引擎。"""
    raw = os.getenv(ENGINE_ENV, DEFAULT_ENGINE)
    key = (raw or DEFAULT_ENGINE).strip().lower()
    return key if key in ENGINES else DEFAULT_ENGINE


def create_engine(name=None):
    """创建并返回引擎实例（尚未加载模型）。

    :param name: 引擎名，None 时读 ASR_ENGINE 环境变量
    :raises ValueError: 引擎名未登记
    """
    key = (name or select_engine_name()).strip().lower()
    if key not in ENGINES:
        raise ValueError(
            f"未知引擎 '{name}'，可用值：{', '.join(ENGINES)}"
        )
    mod_name, cls_name = ENGINES[key]
    mod = importlib.import_module(mod_name)
    return getattr(mod, cls_name)()
