@echo off
setlocal
chcp 65001 >nul
title ASR_Server

cd /d "%~dp0"

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found.
    pause
    exit /b
)

echo Starting Faster-Whisper ASR (Optimized for 2080 Ti)...
set WHISPER_DEVICE=cuda
set WHISPER_COMPUTE=float16

set WHISPER_NUM_WORKERS=2
set WHISPER_CPU_THREADS=4
set WHISPER_MODEL=large-v2

set WHISPER_BEAM_SIZE=5
set WHISPER_VAD_FILTER=True

set WHISPER_DEFAULT_LANGUAGE=zh
set WHISPER_DEFAULT_INITIAL_PROMPT=Chinese

python scripts/whisper_server.py

if %errorlevel% neq 0 (
    echo [ERROR] Server exited unexpectedly.
    pause
)
