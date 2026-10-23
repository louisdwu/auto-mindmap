# -*- coding: utf-8 -*-
"""
ASR 引擎接口定义
================================================================
所有识别引擎（Qwen3-ASR、Faster-Whisper、未来新增的任何模型）都实现
同一个 ``ASREngine`` 接口，服务端通过 ``engine.transcribe()`` 拿到统一
结构的识别结果，因此**切换引擎不需要改动任何 HTTP 接口**。

统一返回结构（dict）::

    {
        "text": str,    # 带行内 [mm:ss] 的文本（兼容扩展端缓存与思维导图引用）
        "srt":  str,    # 标准 SRT 字幕
        "cues": list,   # [{"text","start","end"}, ...]
        "language": str,# 最终语言（未知时为 "auto"）
    }

注意：``transcribe()`` 是**同步阻塞**方法（推理耗时），
由服务端用 ``asyncio.to_thread(...)`` 丢进线程池调用，
本模块不负责并发调度。
"""

import abc

from asr_engines.common import build_inline_text, build_srt


class ASREngine(abc.ABC):
    """识别引擎基类。

    子类约定：
      * ``name``        —— 短标识，用于 ASR_ENGINE 环境变量与 /health；
      * ``display_name``—— 日志里展示的人类可读名称；
      * ``load()``      —— 同步加载模型，成功返回 True；
      * ``transcribe()``—— 同步执行，返回统一结构；
      * ``describe()``  —— 返回引擎/模型/设备信息，供 /health 直接合并。
    """

    name = "base"
    display_name = "Base"

    def __init__(self):
        self.model = None

    # ------------------------------------------------------------------ #
    @property
    def is_loaded(self):
        """模型是否已成功加载（未加载时服务端返回 503）。"""
        return self.model is not None

    def load(self) -> bool:
        """加载模型。默认实现直接标记为已加载（子类一般覆盖）。"""
        return True

    def unload(self) -> None:
        """卸载模型、归还显存。

        默认实现把 ``self.model`` 置空并强制回收：CTranslate2 / PyTorch
        对象被 GC 时即释放其占用的 GPU 显存。服务端的空闲看门狗与
        ``POST /unload`` 调用本方法，从而实现「平时不占显存」。

        子类若额外缓存了 processor / tokenizer / 对齐器等对象，可在覆盖
        版里一并置空（再调用 ``super().unload()``）。
        """
        self.model = None
        import gc
        gc.collect()
        # PyTorch 引擎（qwen3）会分配 CUDA 缓存块，empty_cache 归还之；
        # faster-whisper（CTranslate2）模型析构时已自行归还显存，
        # 这里仅作无副作用的兜底（torch 未安装时静默跳过）。
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    @abc.abstractmethod
    def transcribe(self, audio_path: str, language=None, context=None) -> dict:
        """同步转录。

        :param audio_path: 本地媒体文件路径（视频或音频均可）
        :param language:   已规范化的语言代码（如 "zh"），None 表示自动检测
        :param context:    上下文偏置文本（initial_prompt + 热词），可为 None
        """
        raise NotImplementedError

    def describe(self) -> dict:
        """引擎描述信息，键值直接并入 /health 响应。"""
        return {"engine": self.name, "model": None}

    # ------------------------------------------------------------------ #
    @staticmethod
    def finish(cues, language=None):
        """把字幕条列表包装成统一返回结构（所有引擎共用，保证格式一致）。"""
        cues = [c for c in (cues or []) if c and str(c.get("text", "")).strip()]
        return {
            "text": build_inline_text(cues),
            "srt": build_srt(cues),
            "cues": cues,
            "language": language or "auto",
        }
