@echo off
setlocal
chcp 65001 >nul
title ASR_Server_MultiEngine
cd /d "%~dp0"

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found.
    pause
    exit /b
)

echo ====================================================
echo   Local ASR Server  (multi-engine)
echo ====================================================
echo   Web UI / SRT generator : http://localhost:2233
echo   API                    : POST /transcribe  ^|  GET /health
echo.
echo   Engine : %ASR_ENGINE%
echo   Model  : %FW_MODEL%
echo.
echo   Switch engine : set ASR_ENGINE=qwen3        (Qwen3-ASR, slower)
echo                   set ASR_ENGINE=faster-whisper  (default, fast)
echo   Params docs   : scripts\ENGINE_PARAMS.md
echo ====================================================
echo.

rem ============================================================
rem  Engine selection.  faster-whisper is the default.
rem ============================================================
if "%ASR_ENGINE%"=="" set ASR_ENGINE=faster-whisper

rem ============================================================
rem  faster-whisper engine
rem ============================================================
rem large-v3 and large-v2 are identical in size (3087 MB), VRAM and speed.
rem large-v3 has better English / number recognition. Use large-v2 to match
rem the model used by the reference subtitle tool.
set FW_MODEL=large-v3
rem set FW_MODEL=large-v2

set FW_DEVICE=cuda
rem OPTIMAL for RTX 2080 Ti / Turing (sm_75): INT8 weights + FP16 activations.
rem INT8 Tensor Cores give 2x FP16 throughput (132 vs 66.2 TFLOPS) and halve
rem memory bandwidth. Model is stored as float16; CTranslate2 quantizes weights
rem to int8 automatically at load time - no offline conversion needed.
rem   VRAM   ~1.5 GB (vs ~3 GB for float16)
rem   speed  ~20-40% faster than float16
rem   quality: negligible loss (activations stay FP16)
set FW_COMPUTE=int8_float16
rem Revert to plain FP16 if you want bit-exact parity with the reference tool:
rem set FW_COMPUTE=float16
set FW_BEAM_SIZE=1
set FW_BEST_OF=1
set FW_VAD=true
set FW_CONDITION_PREV=false
set FW_NUM_WORKERS=1
set FW_CPU_THREADS=4

rem Term boost. faster-whisper has a native hotwords parameter,
rem which is more accurate than stuffing terms into an initial prompt.
set FW_HOTWORDS=AI,stock,crypto,BTC,ETH,SPY,NASDAQ,NVIDIA

rem NOTE: the local model root directory is not set here on purpose.
rem Python already defaults to D:\Green\<subtitle tool>\AppData\models
rem (see asr_engines\fasterwhisper.py). Keep this script ASCII-only so it
rem cannot be broken by console code-page switches.
rem To override, uncomment and edit:
rem set WHISPER_MODEL_BASE_DIR=D:\path\to\models

rem ============================================================
rem  Qwen3-ASR engine  (only used when ASR_ENGINE=qwen3)
rem ============================================================
set QWEN_ASR_MODEL=Qwen/Qwen3-ASR-1.7B
set QWEN_ALIGNER_MODEL=Qwen/Qwen3-ForcedAligner-0.6B
set QWEN_ASR_CHUNK_SECONDS=240
set QWEN_ASR_MAX_NEW_TOKENS=2048
set QWEN_ASR_BATCH=1

rem ============================================================
rem  Shared / legacy-compatible options
rem ============================================================
set WHISPER_DEVICE=cuda
set WHISPER_COMPUTE=float16
set WHISPER_NUM_WORKERS=1
set WHISPER_CPU_THREADS=4

rem Do NOT hard-code WHISPER_DEFAULT_LANGUAGE here.
rem The server uses this value for every request that does not pass a language.
rem Forcing zh makes Whisper decode English audio as Chinese: it then rewrites
rem (translates) the speech into Chinese and mangles all English terms and
rem numbers. Leave it empty so the spoken language is auto-detected - faithful
rem transcription is what the LLM summarizer actually needs.
rem Set it only when every video you transcribe is in one language:
rem   set WHISPER_DEFAULT_LANGUAGE=zh
rem   set WHISPER_DEFAULT_LANGUAGE=en
set WHISPER_DEFAULT_LANGUAGE=
set WHISPER_DEFAULT_INITIAL_PROMPT=
set QWEN_ASR_HOTWORDS=

rem HF mirror (direct huggingface.co times out on this box)
set ASR_HF_ENDPOINT=https://hf-mirror.com

python scripts/whisper_server.py

if %errorlevel% neq 0 (
    echo [ERROR] Server exited unexpectedly.
    pause
)
