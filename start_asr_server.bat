@echo off
setlocal
title ASR_Server
cd /d %~dp0

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    pause
    exit /b
)

echo Starting Faster-Whisper ASR (Optimized for 2080 Ti)...
set WHISPER_DEVICE=cuda
set WHISPER_COMPUTE=float16

:: --- 高性能配置 (针对 2080 Ti 11G 显存) ---
:: 并行 Worker 数量，建议 11G 显存设为 2，可显著提升 GPU 利用率和转录速度
set WHISPER_NUM_WORKERS=2
:: CPU 辅助线程数
set WHISPER_CPU_THREADS=4
:: 默认模型名称 (large-v2, large-v3, medium 等)
set WHISPER_MODEL=large-v2

:: 任务参数 (若插件发送了参数则会被覆盖)
set WHISPER_BEAM_SIZE=5
set WHISPER_VAD_FILTER=True

python scripts/whisper_server.py

if errorlevel 1 (
    echo [ERROR] Server exited unexpectedly.
    pause
)
