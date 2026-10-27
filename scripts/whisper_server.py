# -*- coding: utf-8 -*-
"""
本地 ASR 服务 —— 多引擎版
================================================================
HTTP 接口契约与旧版（Faster-Whisper 后端）**完全不变**，
但识别引擎已抽成可插拔的 ``asr_engines`` 包，支持按需切换：

  faster-whisper   （默认）CTranslate2 加速，速度快，内置 VAD，词级时间戳 -> SRT
  qwen3              Qwen3-ASR-1.7B + ForcedAligner-0.6B，中文/术语精度高

切换方式：环境变量 ``ASR_ENGINE=faster-whisper|qwen3``（默认 faster-whisper）。
各引擎的最优参数写在 ``scripts/ENGINE_PARAMS.md``，切换模型时自动套用，
并可再用各自的 FW_* / QWEN_* 环境变量逐项覆盖。

对外接口（与旧版一致）：
  POST /transcribe                  （支持 stream 流式日志）
  POST /v1/audio/transcriptions     （OpenAI 兼容，支持 stream）
  GET  /v1/models
  GET  /health                      （含 model_loaded / in_flight / idle_seconds 等）
  POST /unload                      手动卸载模型、立即归还显存（服务继续运行）
  POST /shutdown                    手动关停服务进程（彻底退出）
  POST /cache/cleanup               手动清理过期 .mp3 音频缓存

模型加载策略（默认惰性，平时不占显存）：
  * 启动时不加载模型；首次 /transcribe（或 /v1/audio/transcriptions）时按需加载。
  * 空闲超过 ASR_IDLE_UNLOAD_SEC（默认 900s）自动卸载、归还显存；0=关闭。
  * 缓存命中（同 video_id 的 .txt）会在加载模型前直接返回，故命中不触显存。
  * 设 ASR_EAGER_LOAD=1 可回到旧版「启动即加载」。

音频缓存策略：
  * cache/*.txt 与 *.srt 体积小且命中可免加载模型，长期保留。
  * cache/*.mp3 体积大，仅按 ASR_MP3_TTL_DAYS（默认 7 天）回收；0=不清理。
    启动时清一次，之后每 ASR_MP3_CLEANUP_INTERVAL_SEC（默认 86400s）周期清理。

网页版前端：浏览器直接访问 http://<host>:2233 即为
「视频语音识别 / SRT 字幕生成器」（scripts/asr_webui.html）。

流式协议（与旧版一致）：
  普通文本行 = 进度日志
  "JSON:{...}" = 最终结果（含 text / srt 字段）
  "ERROR:{...}" = 出错

注意：返回的 text 字段继续保留行内 [mm:ss] 前缀，
      以兼容扩展端缓存校验与思维导图时间戳引用。
"""

import os
import sys
import re
import time
import site
import json
import shutil
import asyncio
import tempfile
import threading
import traceback
import subprocess

import requests
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse, PlainTextResponse


# ------------------------------------------------------------------ #
# 修复 Windows 下 CUDA 运行库 (DLL) 搜索路径
# ------------------------------------------------------------------ #
if sys.platform == "win32":
    site_dirs = []
    if hasattr(site, "getsitepackages"):
        site_dirs.extend(site.getsitepackages())
    if hasattr(site, "getusersitepackages"):
        site_dirs.append(site.getusersitepackages())

    # 本地已有的 CUDA 12 目录（沿用卡卡字幕助手提取的运行库）
    local_cuda_paths = [
        r"D:\Green\卡卡字幕助手VideoCaptioner\resource\bin\Faster-Whisper-XXL\_xxl_data\torch\lib",
        r"D:\Green\卡卡字幕助手VideoCaptioner\resource\bin",
        r"D:\Green\卡卡字幕助手VideoCaptioner\resource",
    ]

    nvidia_libs = [
        os.path.join("nvidia", "cublas", "bin"),
        os.path.join("nvidia", "cudnn", "bin"),
    ]

    search_paths = local_cuda_paths[:]
    for base in site_dirs:
        # torch 自带运行库目录
        search_paths.append(os.path.join(base, "torch", "lib"))
        for lib_rel in nvidia_libs:
            search_paths.append(os.path.join(base, lib_rel))

    added_info = []
    for full_path in search_paths:
        if os.path.isdir(full_path):
            try:
                os.add_dll_directory(full_path)
            except Exception:
                pass
            os.environ["PATH"] = full_path + os.pathsep + os.environ.get("PATH", "")
            dlls = [f for f in os.listdir(full_path) if f.lower().endswith(".dll")]
            if dlls:
                added_info.append((full_path, dlls))

    if added_info:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 已激活本地 CUDA 运行库目录：")
        for path, files in added_info:
            print(f"  ● {path}")


# ------------------------------------------------------------------ #
# HuggingFace 镜像：本机直连 huggingface.co 超时，默认走镜像。
# 如你的网络能直连，设置 HF_ENDPOINT=https://huggingface.co 覆盖即可。
# ------------------------------------------------------------------ #
os.environ.setdefault("HF_ENDPOINT", os.getenv("ASR_HF_ENDPOINT", "https://hf-mirror.com"))

# 让 asr_engines 包在「直接运行本脚本」时也能被找到
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_engines import create_engine, select_engine_name, ENGINE_ENV  # noqa: E402
from asr_engines.common import build_context, is_auto_language, normalize_language  # noqa: E402

import uvicorn  # noqa: E402

app = FastAPI(title="Local ASR Server (multi-engine)")


# 允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------ #
# 内嵌网页版前端：浏览器直接访问 http://<host>:2233 即可使用
#   - 选择视频文件 -> 调用本服务转写 -> 一键下载 SRT 字幕
#   - 网页文件位于 scripts/asr_webui.html（与本脚本同目录）
# ------------------------------------------------------------------ #
WEBUI_HTML_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "asr_webui.html")

_WEBUI_PLACEHOLDER = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>ASR Web UI</title></head>
<body style="font-family:sans-serif;padding:40px;color:#333">
<h2>⚠️ 未找到网页文件 <code>scripts/asr_webui.html</code></h2>
<p>请确认该文件与本脚本位于同一目录后重启服务。</p>
<p>接口仍然可用：<code>POST /transcribe</code> · <code>GET /health</code></p>
</body></html>"""


@app.get("/", response_class=HTMLResponse)
async def index():
    """托管网页版「视频语音识别 / SRT 字幕生成器」。"""
    try:
        if os.path.exists(WEBUI_HTML_PATH):
            with open(WEBUI_HTML_PATH, "r", encoding="utf-8") as f:
                return HTMLResponse(f.read())
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] 读取网页文件失败: {e}")
    return HTMLResponse(_WEBUI_PLACEHOLDER, status_code=200)


# ------------------------------------------------------------------ #
# 全局配置（对所有引擎生效的通用项）
# ------------------------------------------------------------------ #
DEFAULT_LANGUAGE = os.getenv("WHISPER_DEFAULT_LANGUAGE", None)
DEFAULT_INITIAL_PROMPT = os.getenv("WHISPER_DEFAULT_INITIAL_PROMPT", None)
# 领域热词 / 上下文偏置（可填入 AI、美股、币圈术语表）
DEFAULT_HOTWORDS = os.getenv("QWEN_ASR_HOTWORDS", "")

# 启动日志展示用的端口（启动脚本可预设，CLI 解析后会被覆盖）
SERVER_PORT = os.getenv("ASR_PORT", "2233")

# ------------------------------------------------------------------ #
# 引擎选择与加载
#   ASR_ENGINE=faster-whisper(默认)|qwen3
# ------------------------------------------------------------------ #
ENGINE_NAME = select_engine_name()
engine = create_engine(ENGINE_NAME)


def load_model():
    """加载当前选定的引擎模型，成功返回 True。"""
    return bool(engine.load())


# ------------------------------------------------------------------ #
# 模型生命周期：惰性加载 + 空闲自动卸载
# ------------------------------------------------------------------ #
# 设计目标：平时不占显存。HTTP 服务常驻（开销极小，不占 GPU 显存），
# 模型在「首次需要转录时」按需加载，空闲超过 ASR_IDLE_UNLOAD_SEC 秒后
# 自动卸载、归还显存。可用 POST /unload 手动卸载，POST /shutdown 关停。
# 如需回到旧版「启动即加载」，设 ASR_EAGER_LOAD=1。
_EAGER_LOAD = os.getenv("ASR_EAGER_LOAD", "0") == "1"
_IDLE_UNLOAD_SEC = int(os.getenv("ASR_IDLE_UNLOAD_SEC", "900"))   # 默认 15 分钟；0 = 关闭自动卸载
_IDLE_CHECK_SEC = max(5, int(os.getenv("ASR_IDLE_CHECK_SEC", "30")))

_MODEL_LOCK = threading.Lock()
_IN_FLIGHT = 0
_LAST_ACTIVITY = time.time()


def _mark_activity():
    global _LAST_ACTIVITY
    _LAST_ACTIVITY = time.time()


def ensure_model_loaded():
    """首次需要模型时按需加载（线程安全、幂等）。

    返回 True 表示模型已就绪；返回 False 表示加载失败（调用方应回 503）。
    """
    global _LAST_ACTIVITY
    with _MODEL_LOCK:
        _mark_activity()
        if engine.is_loaded:
            return True
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 模型未加载，按需启动加载...")
        ok = load_model()
        _mark_activity()
        if not ok:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 模型按需加载失败。"
                  "请检查上方错误日志，或设置 ASR_ENGINE 切换引擎。")
        return ok


def _enter_inference():
    """标记一次推理开始（占用模型，阻止空闲看门狗在转录途中卸载）。"""
    global _IN_FLIGHT
    with _MODEL_LOCK:
        _IN_FLIGHT += 1
        _mark_activity()


def _exit_inference():
    """标记一次推理结束。"""
    global _IN_FLIGHT
    with _MODEL_LOCK:
        _IN_FLIGHT = max(0, _IN_FLIGHT - 1)
        _mark_activity()


def unload_model():
    """卸载模型、归还显存（空闲看门狗与 POST /unload 共用）。

    有推理进行中（_IN_FLIGHT>0）时不卸载，返回 False。
    """
    with _MODEL_LOCK:
        if not engine.is_loaded:
            return False
        if _IN_FLIGHT > 0:
            return False
        try:
            engine.unload()
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 模型已卸载，显存已归还。")
        except Exception as e:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 卸载模型时发生异常: {e}")
        _mark_activity()
        return True


def _idle_unload_watcher():
    """后台守护线程：空闲超时自动卸载模型，释放显存。"""
    while True:
        time.sleep(_IDLE_CHECK_SEC)
        if _IDLE_UNLOAD_SEC <= 0:
            continue
        with _MODEL_LOCK:
            loaded = engine.is_loaded
            in_flight = _IN_FLIGHT
            idle_for = time.time() - _LAST_ACTIVITY
        if loaded and in_flight == 0 and idle_for >= _IDLE_UNLOAD_SEC:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 空闲 {int(idle_for)}s 超过阈值 "
                  f"{_IDLE_UNLOAD_SEC}s，自动卸载模型释放显存。")
            unload_model()


# ------------------------------------------------------------------ #
# 启动模式：默认惰性加载（平时不占显存），ASR_EAGER_LOAD=1 回到旧版启动即加载。
# 冒烟测试仍用 _BOOT_GUARD=1 跳过模型加载，只做接口契约校验。
# ------------------------------------------------------------------ #
if os.getenv("_BOOT_GUARD") == "1":
    print("=" * 60)
    print(f"ASR 引擎: {engine.name}  ({engine.display_name})  [BOOT_GUARD：跳过模型加载]")
    print(f"网页版字幕生成器: http://127.0.0.1:{SERVER_PORT}")
    print("=" * 60)
elif _EAGER_LOAD:
    load_model()
    print("=" * 60)
    print(f"ASR 引擎: {engine.name}  ({engine.display_name})  [EAGER：启动即加载]")
    print(f"模型加载: {'成功' if engine.is_loaded else '失败'}")
    if not engine.is_loaded:
        print("提示: 模型未加载成功，请检查上方错误日志，"
              "或设置 ASR_ENGINE 切换到其他引擎")
    print(f"网页版字幕生成器: http://127.0.0.1:{SERVER_PORT}")
    print("=" * 60)
else:
    print("=" * 60)
    print(f"ASR 引擎: {engine.name}  ({engine.display_name})  [LAZY：按需加载，平时不占显存]")
    if _IDLE_UNLOAD_SEC > 0:
        print(f"模型: 首次转录时自动加载；空闲 {_IDLE_UNLOAD_SEC}s 自动卸载释放显存")
    else:
        print("模型: 首次转录时自动加载；空闲自动卸载已关闭")
    print("手动卸载显存: POST /unload    手动关停服务: POST /shutdown")
    print(f"网页版字幕生成器: http://127.0.0.1:{SERVER_PORT}")
    print("=" * 60)

# 启动空闲卸载看门狗（守护线程，随进程退出）
threading.Thread(target=_idle_unload_watcher, name="asr-idle-unload", daemon=True).start()


# ------------------------------------------------------------------ #
# 进程内推理计数：区分「本进程首次推理」与后续推理，让日志提示更准确
# ------------------------------------------------------------------ #
_INFER_LOCK = threading.Lock()
_INFER_COUNT = 0


def next_infer_index():
    """返回本次推理在进程生命周期内的序号（1-based）。"""
    global _INFER_COUNT
    with _INFER_LOCK:
        _INFER_COUNT += 1
        return _INFER_COUNT


# ------------------------------------------------------------------ #
# .mp3 音频缓存 TTL 清理（仅清大体积音频；.txt/.srt 体积小且命中可免加载，保留）
# ------------------------------------------------------------------ #
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
_MP3_TTL_DAYS = float(os.getenv("ASR_MP3_TTL_DAYS", "7"))        # 0 = 不清理
_MP3_CLEANUP_INTERVAL_SEC = int(os.getenv("ASR_MP3_CLEANUP_INTERVAL_SEC", "86400"))


def cleanup_mp3_cache():
    """删除 cache/ 下超过 TTL 的 .mp3 音频缓存文件。

    .mp3 体积大、仅在重新转录同一视频时省一次下载/ffmpeg，价值有限，故按 TTL 回收；
    .txt / .srt 体积小且命中即可免加载模型（不触显存），一律保留。返回删除数量。
    """
    if _MP3_TTL_DAYS <= 0:
        return 0
    if not os.path.isdir(CACHE_DIR):
        return 0
    cutoff = time.time() - _MP3_TTL_DAYS * 86400
    removed = 0
    try:
        for name in os.listdir(CACHE_DIR):
            if not name.lower().endswith(".mp3"):
                continue
            path = os.path.join(CACHE_DIR, name)
            try:
                if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                    os.remove(path)
                    removed += 1
            except Exception:
                pass
    except Exception:
        pass
    if removed:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 清理过期 .mp3 音频缓存："
              f"删除 {removed} 个（TTL={_MP3_TTL_DAYS} 天）。")
    return removed


def _mp3_cleanup_watcher():
    """后台守护线程：周期性清理过期 .mp3 音频缓存。"""
    while True:
        time.sleep(_MP3_CLEANUP_INTERVAL_SEC)
        cleanup_mp3_cache()


# 启动时清理一次过期音频缓存，并启动周期清理守护线程（ASR_MP3_TTL_DAYS=0 关闭）
cleanup_mp3_cache()
threading.Thread(target=_mp3_cleanup_watcher, name="asr-mp3-cleanup", daemon=True).start()


# ------------------------------------------------------------------ #
# 缓存路径与音频获取（供普通 / 流式共用）
# ------------------------------------------------------------------ #
def _cache_paths(video_id, language=None):
    """返回 (缓存目录, 文本缓存, 音频缓存, SRT 缓存, 安全 video_id)。

    文本/SRT 缓存按「识别语言」分档：同一视频用 zh 与 en 识别出的内容不同，
    共用一份缓存会让切换语言后直接命中旧结果。音频缓存与语言无关，保持原名。
    """
    cache_dir = CACHE_DIR
    safe_video_id = (
        "".join(c for c in video_id if c.isalnum() or c in "-_") if video_id else None
    )
    if not safe_video_id:
        return cache_dir, None, None, None, None
    lang_tag = (normalize_language(language) or "auto") if language else "auto"
    return (
        cache_dir,
        os.path.join(cache_dir, f"{safe_video_id}.{lang_tag}.txt"),
        os.path.join(cache_dir, f"{safe_video_id}.mp3"),
        os.path.join(cache_dir, f"{safe_video_id}.{lang_tag}.srt"),
        safe_video_id,
    )


async def _acquire_audio(file, audio_url, video_id, file_path, cache_dir, mp3_cache_path, safe_video_id, logs):
    """返回 (音频路径, 是否为临时文件)。logs 用于收集进度信息。"""
    # 1. 音频缓存命中
    if video_id and mp3_cache_path and os.path.exists(mp3_cache_path) and os.path.getsize(mp3_cache_path) > 0:
        logs.append(f"命中音频缓存: {safe_video_id}, 跳过下载!")
        return mp3_cache_path, False

    # 2. 指定本地文件
    if file_path:
        if not os.path.exists(file_path):
            raise FileNotFoundError(file_path)
        logs.append(f"使用本地文件: {file_path}")
        return file_path, False

    # 3. 下载 / 上传
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
        tmp_path = tmp.name
        if audio_url:
            logs.append(f"正在从 URL 下载音频: {audio_url[:50]}...")
            headers = {
                "Referer": "https://www.bilibili.com",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
            with requests.get(audio_url, headers=headers, stream=True, timeout=30) as r:
                r.raise_for_status()
                for chunk in r.iter_content(chunk_size=81920):
                    tmp.write(chunk)
        elif file:
            logs.append(f"收到文件上传: {getattr(file, 'filename', '')}")
            tmp.write(await file.read())
        else:
            raise ValueError("未提供音频文件、URL 或本地文件路径")

    file_size = os.path.getsize(tmp_path)
    if file_size == 0:
        raise ValueError("获取到的音频数据为空")
    logs.append(f"音频准备完成，大小: {file_size / 1024 / 1024:.2f} MB")

    # 存入缓存
    if video_id and mp3_cache_path:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            shutil.copy2(tmp_path, mp3_cache_path)
            logs.append(f"已缓存音频到: {mp3_cache_path}")
        except Exception as e:
            logs.append(f"缓存音频文件发生异常: {e}")

    return tmp_path, True


# ------------------------------------------------------------------ #
# 引擎调用包装（统一语言规范化 / 上下文 / 冷启动提示）
# ------------------------------------------------------------------ #
def _prepare_request(language, initial_prompt):
    """把请求参数规范化成引擎可直接使用的 (language_code, context)。

    language 为空、"auto"、"detect" 等哨兵值时返回 None，交回引擎自动检测语言。
    这里必须把「没指定」和「指定了某语言」区分开：早期版本无条件回落到
    WHISPER_DEFAULT_LANGUAGE（曾在启动脚本里被设成 zh），于是英文视频被当成
    中文解码，Whisper 直接把英文「翻译/改写」成中文输出了。
    """
    final_language = language if language else DEFAULT_LANGUAGE
    language_code = None if is_auto_language(final_language) else normalize_language(final_language)
    final_prompt = initial_prompt if initial_prompt else DEFAULT_INITIAL_PROMPT
    return language_code, build_context(final_prompt, DEFAULT_HOTWORDS)


def _log_infer_start(infer_idx, language_code, context):
    """打印统一格式的推理开始日志，含冷启动提示。"""
    desc = engine.describe()
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 启动 {engine.display_name} 识别 "
          f"(language={language_code or 'auto'}, device={desc.get('device')}, "
          f"本进程第 {infer_idx} 次推理)...")
    if infer_idx == 1:
        print(f"[{time.strftime('%H:%M:%S')}] 提示：模型刚加载完毕，首次推理会稍慢"
              f"（CUDA 内核首次编译/调度），同进程内后续任务会明显更快。")
    if context:
        print(f"[{time.strftime('%H:%M:%S')}] 上下文偏置: {context[:120]}{'...' if len(context) > 120 else ''}")


async def _run_engine(audio_path, language_code, context):
    """在线程池中执行引擎转录（避免阻塞 uvicorn 单线程事件循环）。

    期间登记「推理进行中」，防止空闲看门狗在转录途中卸载模型。
    """
    _enter_inference()
    try:
        return await asyncio.to_thread(engine.transcribe, audio_path, language_code, context)
    finally:
        _exit_inference()


# ------------------------------------------------------------------ #
# 核心转录（普通模式）
# ------------------------------------------------------------------ #
async def do_transcribe(
    file: UploadFile = None,
    audio_url: str = None,
    video_id: str = None,
    file_path: str = None,
    model_name: str = "large-v2",
    beam_size: str = None,      # 兼容旧接口参数；实际取值由引擎预设/环境变量决定
    vad_filter: str = None,     # 兼容旧接口参数；实际取值由引擎预设/环境变量决定
    language: str = None,
    initial_prompt: str = None,
):
    start_time = time.time()
    tmp_path = None
    is_temp = False
    cleanup_paths = []

    # 先解析识别语言：缓存路径要按语言分档（同一视频不同语言结果不同）
    language_code, context = _prepare_request(language, initial_prompt)
    cache_dir, txt_cache_path, mp3_cache_path, srt_cache_path, safe_video_id = _cache_paths(
        video_id, language_code
    )

    # 1. 字幕文本缓存命中（瞬发）
    if safe_video_id:
        os.makedirs(cache_dir, exist_ok=True)
        if os.path.exists(txt_cache_path) and os.path.getsize(txt_cache_path) > 0:
            print(f"[{time.strftime('%H:%M:%S')}] 命中字幕文本缓存: {safe_video_id}, 瞬发返回!")
            try:
                with open(txt_cache_path, "r", encoding="utf-8") as f:
                    cached_text = f.read()
                cached_srt_text = None
                if os.path.exists(srt_cache_path):
                    try:
                        with open(srt_cache_path, "r", encoding="utf-8") as f2:
                            cached_srt_text = f2.read()
                    except Exception as e:
                        print(f"[{time.strftime('%H:%M:%S')}] 读取 SRT 缓存失败: {e}")
                return {
                    "text": cached_text,
                    "srt": cached_srt_text,
                    "language": language_code or "auto",
                    "duration": 0,
                    "word_count": len(cached_text),
                    "cached_mp3": mp3_cache_path if os.path.exists(mp3_cache_path) else None,
                    "cached_txt": txt_cache_path,
                    "cached_srt": srt_cache_path if os.path.exists(srt_cache_path) else None,
                    "info": {"language_probability": 1.0, "duration": 0},
                }
            except Exception as e:
                print(f"[{time.strftime('%H:%M:%S')}] 读取字幕文本缓存失败: {e}，将重新识别")

    # 模型按需加载：缓存未命中且确实需要推理时，才把模型载入显存
    if not engine.is_loaded:
        if not ensure_model_loaded():
            return JSONResponse(
                status_code=503,
                content={"error": "模型加载失败，请检查服务器日志（首次加载约需 10-20s）"},
            )

    try:
        logs = []
        tmp_path, is_temp = await _acquire_audio(
            file, audio_url, video_id, file_path, cache_dir, mp3_cache_path, safe_video_id, logs
        )
        for line in logs:
            print(f"[{time.strftime('%H:%M:%S')}] {line}")
        if is_temp:
            cleanup_paths.append(tmp_path)

        infer_idx = next_infer_index()
        _log_infer_start(infer_idx, language_code, context)
        res = await _run_engine(tmp_path, language_code, context)

        result_text = res["text"]
        srt_text = res["srt"]
        duration = time.time() - start_time
        print(f"[{time.strftime('%H:%M:%S')}] 转录完成！语言: {res['language']}, "
              f"耗时: {duration:.2f}s, 字数: {len(result_text)}")

        # 写入字幕文本缓存
        if video_id and result_text and txt_cache_path:
            try:
                with open(txt_cache_path, "w", encoding="utf-8") as f:
                    f.write(result_text)
                print(f"[{time.strftime('%H:%M:%S')}] 成功保存字幕文本缓存: {txt_cache_path}")
            except Exception as e:
                print(f"保存字幕缓存时发生异常: {e}")

        # 写入 SRT 字幕文件
        if video_id and srt_text and srt_cache_path:
            try:
                with open(srt_cache_path, "w", encoding="utf-8") as f:
                    f.write(srt_text)
                print(f"[{time.strftime('%H:%M:%S')}] 成功保存 SRT 字幕: {srt_cache_path}")
            except Exception as e:
                print(f"保存 SRT 字幕时发生异常: {e}")

        return {
            "text": result_text,
            "srt": srt_text,
            "language": res["language"],
            "duration": duration,
            "word_count": len(result_text),
            "cached_mp3": mp3_cache_path if (video_id and os.path.exists(mp3_cache_path)) else None,
            "cached_txt": txt_cache_path if (video_id and os.path.exists(txt_cache_path)) else None,
            "cached_srt": srt_cache_path if (video_id and os.path.exists(srt_cache_path)) else None,
            "info": {
                "language_probability": 1.0,
                "duration": duration,
            },
        }

    except FileNotFoundError as e:
        return JSONResponse(status_code=400, content={"error": f"指定的本地文件不存在: {e}"})
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    except requests.exceptions.RequestException as e:
        print(f"下载失败: {e}")
        return JSONResponse(status_code=400, content={"error": f"音频下载失败: {str(e)}"})
    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"识别过程发生错误:\n{error_trace}")
        return JSONResponse(
            status_code=500,
            content={
                "error": f"识别代码执行异常: {str(e)}",
                "detail": error_trace.splitlines()[-1] if error_trace else "",
            },
        )
    finally:
        for p in cleanup_paths:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass


# ------------------------------------------------------------------ #
# 接口 1：/transcribe （支持 stream）
# ------------------------------------------------------------------ #
@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(None),
    audio_url: str = Form(None),
    video_id: str = Form(None),
    file_path: str = Form(None),
    model_name: str = Form("large-v2", alias="model"),
    beam_size: str = Form(None),
    vad_filter: str = Form(None),
    language: str = Form(None),
    initial_prompt: str = Form(None),
    stream: bool = Form(False),
):
    """统一转录入口。stream=True 时改为流式返回日志。"""
    if stream:
        return await _transcribe_stream(
            file, audio_url=audio_url, video_id=video_id, file_path=file_path,
            model_name=model_name, beam_size=beam_size, vad_filter=vad_filter,
            language=language, initial_prompt=initial_prompt, response_format="json",
        )
    result = await do_transcribe(
        file=file, audio_url=audio_url, video_id=video_id, file_path=file_path,
        model_name=model_name, beam_size=beam_size, vad_filter=vad_filter,
        language=language, initial_prompt=initial_prompt,
    )
    if isinstance(result, JSONResponse):
        return result
    return result


# ------------------------------------------------------------------ #
# 接口 2：/v1/audio/transcriptions （OpenAI 兼容，支持 stream）
# ------------------------------------------------------------------ #
@app.post("/v1/audio/transcriptions")
async def openai_transcribe(
    file: UploadFile = File(None),
    model_name: str = Form("large-v2", alias="model"),
    response_format: str = Form("json"),
    language: str = Form(None),
    beam_size: str = Form(None),
    vad_filter: str = Form(None),
    audio_url: str = Form(None),
    video_id: str = Form(None),
    file_path: str = Form(None),
    initial_prompt: str = Form(None),
    stream: bool = Form(False),
):
    """OpenAI 兼容接口。stream=True 时返回流式日志 + JSON 结果行。"""
    if stream:
        return await _transcribe_stream(
            file, audio_url=audio_url, video_id=video_id, file_path=file_path,
            model_name=model_name, beam_size=beam_size, vad_filter=vad_filter,
            language=language, initial_prompt=initial_prompt, response_format=response_format,
        )

    result = await do_transcribe(
        file=file, audio_url=audio_url, video_id=video_id, file_path=file_path,
        model_name=model_name, beam_size=beam_size, vad_filter=vad_filter,
        language=language, initial_prompt=initial_prompt,
    )
    if isinstance(result, JSONResponse):
        return result
    if response_format == "text":
        return PlainTextResponse(result["text"])
    return result


# ------------------------------------------------------------------ #
# 流式返回实现（/transcribe 与 /v1/audio/transcriptions 共用）
# 协议：普通文本行=进度日志；JSON:{...}=最终结果；ERROR:{...}=出错
# ------------------------------------------------------------------ #
async def _transcribe_stream(
    file: UploadFile,
    audio_url: str = None,
    video_id: str = None,
    file_path: str = None,
    model_name: str = "large-v2",
    beam_size: str = None,
    vad_filter: str = None,
    language: str = None,
    initial_prompt: str = None,
    response_format: str = "json",
):
    async def generator():
        def out(text):
            return f"{text}\n".encode("utf-8")

        start_time = time.time()
        tmp_path = None
        is_temp = False
        cleanup_paths = []
        # 先解析识别语言：缓存路径要按语言分档（同一视频不同语言结果不同）
        language_code, context = _prepare_request(language, initial_prompt)
        cache_dir, txt_cache_path, mp3_cache_path, srt_cache_path, safe_video_id = _cache_paths(
            video_id, language_code
        )

        try:
            yield out(f"[{time.strftime('%H:%M:%S')}] 开始转录任务 "
                      f"(引擎: {engine.display_name}, model={model_name})...")

            # 1. 字幕文本缓存命中（瞬发）
            if safe_video_id and os.path.exists(txt_cache_path) and os.path.getsize(txt_cache_path) > 0:
                try:
                    with open(txt_cache_path, "r", encoding="utf-8") as f:
                        cached_text = f.read()
                    cached_srt_text = None
                    if os.path.exists(srt_cache_path):
                        try:
                            with open(srt_cache_path, "r", encoding="utf-8") as f2:
                                cached_srt_text = f2.read()
                        except Exception as e:
                            print(f"[{time.strftime('%H:%M:%S')}] 读取 SRT 缓存失败: {e}")
                    yield out(f"[{time.strftime('%H:%M:%S')}] 命中字幕文本缓存: {safe_video_id}, 瞬发返回!")
                    payload = {
                        "text": cached_text, "srt": cached_srt_text,
                        "language": language_code or "auto", "duration": 0,
                    }
                    if response_format == "text":
                        yield out(cached_text)
                    else:
                        yield out("JSON:" + json.dumps(payload, ensure_ascii=False))
                    return
                except Exception as e:
                    yield out(f"[{time.strftime('%H:%M:%S')}] 读取缓存失败: {e}，将重新识别")

            if not engine.is_loaded:
                yield out(f"[{time.strftime('%H:%M:%S')}] 模型未加载，正在按需加载（首次约 10-20s）...")
                if not ensure_model_loaded():
                    yield out("ERROR:" + json.dumps(
                        {"error": "模型加载失败，请检查服务器日志"}, ensure_ascii=False))
                    return
                yield out(f"[{time.strftime('%H:%M:%S')}] 模型加载完成，开始识别。")

            # 2. 获取音频
            logs = []
            try:
                tmp_path, is_temp = await _acquire_audio(
                    file, audio_url, video_id, file_path, cache_dir,
                    mp3_cache_path, safe_video_id, logs
                )
            except FileNotFoundError as e:
                yield out("ERROR:" + json.dumps(
                    {"error": f"指定的本地文件不存在: {e}"}, ensure_ascii=False))
                return
            except ValueError as e:
                yield out("ERROR:" + json.dumps({"error": str(e)}, ensure_ascii=False))
                return
            except requests.exceptions.RequestException as e:
                yield out("ERROR:" + json.dumps(
                    {"error": f"音频下载失败: {str(e)}"}, ensure_ascii=False))
                return

            for line in logs:
                yield out(f"[{time.strftime('%H:%M:%S')}] {line}")
            if is_temp:
                cleanup_paths.append(tmp_path)

            # 3. 执行识别
            infer_idx = next_infer_index()
            desc = engine.describe()
            yield out(f"[{time.strftime('%H:%M:%S')}] 正在使用 {engine.display_name} 识别 "
                      f"(language={language_code or 'auto'}, device={desc.get('device')}, "
                      f"本进程第 {infer_idx} 次推理)...")
            if infer_idx == 1:
                yield out(f"[{time.strftime('%H:%M:%S')}] 提示：模型刚加载完毕，首次推理会稍慢"
                          f"（CUDA 内核首次编译/调度），同进程内后续任务会明显更快。")
            if context:
                yield out(f"[{time.strftime('%H:%M:%S')}] 上下文偏置: "
                          f"{context[:120]}{'...' if len(context) > 120 else ''}")

            try:
                res = await _run_engine(tmp_path, language_code, context)
            except Exception as e:
                traceback.print_exc()
                yield out("ERROR:" + json.dumps(
                    {"error": f"识别代码执行异常: {str(e)}"}, ensure_ascii=False))
                return

            result_text = res["text"]
            srt_text = res["srt"]
            duration = time.time() - start_time

            # 写入字幕文本缓存
            if video_id and result_text and txt_cache_path:
                try:
                    os.makedirs(cache_dir, exist_ok=True)
                    with open(txt_cache_path, "w", encoding="utf-8") as f:
                        f.write(result_text)
                    yield out(f"[{time.strftime('%H:%M:%S')}] 成功保存字幕文本缓存: {txt_cache_path}")
                except Exception as e:
                    yield out(f"保存字幕缓存时发生异常: {e}")

            # 写入 SRT 字幕文件
            if video_id and srt_text and srt_cache_path:
                try:
                    os.makedirs(cache_dir, exist_ok=True)
                    with open(srt_cache_path, "w", encoding="utf-8") as f:
                        f.write(srt_text)
                    yield out(f"[{time.strftime('%H:%M:%S')}] 成功保存 SRT 字幕: {srt_cache_path}")
                except Exception as e:
                    yield out(f"保存 SRT 字幕时发生异常: {e}")

            print(f"[{time.strftime('%H:%M:%S')}] 转录完成！语言: {res['language']}, "
                  f"耗时: {duration:.2f}s, 字数: {len(result_text)}")

            if response_format == "text":
                yield out(result_text)
            else:
                yield out("JSON:" + json.dumps(
                    {"text": result_text, "srt": srt_text,
                     "language": res["language"], "duration": duration},
                    ensure_ascii=False))

        except Exception as e:
            traceback.print_exc()
            yield out("ERROR:" + json.dumps(
                {"error": f"识别代码执行异常: {str(e)}"}, ensure_ascii=False))
        finally:
            for p in cleanup_paths:
                try:
                    if p and os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass

    return StreamingResponse(generator(), media_type="text/plain")


# ------------------------------------------------------------------ #
# 接口 3：/v1/models
# ------------------------------------------------------------------ #
@app.get("/v1/models")
async def list_models():
    """OpenAI 兼容的模型列表（保留旧版条目，扩展端探测依赖这些 id）。"""
    return {
        "object": "list",
        "data": [
            {"id": "large-v2", "object": "model", "created": 1677610602, "owned_by": "openai"},
            {"id": "whisper-1", "object": "model", "created": 1677610602, "owned_by": "openai"},
        ],
    }


# ------------------------------------------------------------------ #
# 接口 4：/health
# ------------------------------------------------------------------ #
@app.get("/health")
async def health():
    with _MODEL_LOCK:
        in_flight = _IN_FLIGHT
        idle_for = int(time.time() - _LAST_ACTIVITY)
    return {
        "status": "ok" if engine.is_loaded else "model_not_loaded",
        "model_loaded": bool(engine.is_loaded),
        "in_flight": in_flight,
        "idle_seconds": idle_for,
        "idle_unload_sec": _IDLE_UNLOAD_SEC,
        "eager_load": _EAGER_LOAD,
        **engine.describe(),
    }


# ------------------------------------------------------------------ #
# 接口 5：/unload  手动卸载模型、立即归还显存（服务进程继续运行，
#               下次请求自动重载）。对应「平时不占显存」的核心动作。
# ------------------------------------------------------------------ #
@app.post("/unload")
async def unload_endpoint():
    freed = unload_model()
    with _MODEL_LOCK:
        loaded = engine.is_loaded
        in_flight = _IN_FLIGHT
    return {
        "unloaded": freed,
        "model_loaded": loaded,
        "in_flight": in_flight,
        "note": "模型已卸载，显存已归还；下次转录将自动重新加载。"
                if freed else "无可卸载模型（未加载或正在推理中）。",
    }


# ------------------------------------------------------------------ #
# 接口 6：/shutdown  手动关停整个 ASR 服务进程（彻底退出，显存与进程一并释放）。
# ------------------------------------------------------------------ #
@app.post("/shutdown")
async def shutdown_endpoint():
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 收到 POST /shutdown，服务进程即将退出。")

    def _do_exit():
        time.sleep(0.5)  # 让响应先发回客户端再退出
        os._exit(0)

    threading.Thread(target=_do_exit, name="asr-shutdown", daemon=True).start()
    return {"shutting_down": True}


# ------------------------------------------------------------------ #
# 接口 7：/cache/cleanup  手动清理过期 .mp3 音频缓存（自动清理之外按需触发）。
# ------------------------------------------------------------------ #
@app.post("/cache/cleanup")
async def cache_cleanup_endpoint():
    removed = cleanup_mp3_cache()
    return {
        "removed": removed,
        "ttl_days": _MP3_TTL_DAYS,
        "note": f"已删除 {removed} 个过期 .mp3（TTL={_MP3_TTL_DAYS} 天）。"
                if _MP3_TTL_DAYS > 0 else "TTL 已关闭（ASR_MP3_TTL_DAYS=0），未清理。",
    }


# ------------------------------------------------------------------ #
# 命令行入口：直接转录本地文件（导出 .txt + .srt）
#   python whisper_server.py <文件路径> [--engine faster-whisper]
# ------------------------------------------------------------------ #
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="本地 ASR 服务 / 命令行转录工具（多引擎）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  python whisper_server.py --port 2233            启动 Web 服务\n"
            "  python whisper_server.py D:\\Videos\\a.mp4       直接转录并导出 .txt/.srt\n"
            "  set ASR_ENGINE=qwen3 && python whisper_server.py --port 2233\n"
        ),
    )
    parser.add_argument("file_path", nargs="?", help="要转录的本地视频/音频文件")
    parser.add_argument("--port", "-p", type=int, default=2233, help="Web 服务端口（默认 2233）")
    parser.add_argument("--engine", "-e", default=None,
                        help=f"指定引擎（默认读 {ENGINE_ENV} 环境变量，否则 faster-whisper）")
    args = parser.parse_args()

    if args.file_path:
        if not os.path.exists(args.file_path):
            print(f"错误：文件不存在 {args.file_path}")
            sys.exit(1)
        if not ensure_model_loaded():
            print("错误：引擎模型加载失败，请检查上方日志。")
            sys.exit(1)

        language_code, context = _prepare_request(None, None)
        print(f"开始转录：{args.file_path}  (引擎: {engine.display_name})")
        _enter_inference()
        try:
            res = engine.transcribe(args.file_path, language_code, context)
        except Exception as e:
            traceback.print_exc()
            print(f"转录失败：{e}")
            sys.exit(1)
        finally:
            _exit_inference()

        base = os.path.splitext(args.file_path)[0]
        txt_path = base + ".txt"
        srt_path = base + ".srt"
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(res["text"])
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(res["srt"])
        print(f"已导出文本：{txt_path}")
        print(f"已导出字幕：{srt_path}")

    else:
        print(f"启动 Web 服务，端口 {args.port}，浏览器访问 http://127.0.0.1:{args.port}")
        uvicorn.run(app, host="0.0.0.0", port=args.port)
