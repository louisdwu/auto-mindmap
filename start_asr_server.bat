@echo off
setlocal
chcp 65001 >nul
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

:: --- High Performance Config (2080 Ti 11G) ---
:: GPU Worker count
set WHISPER_NUM_WORKERS=2
:: CPU threads
set WHISPER_CPU_THREADS=4
:: Default model
set WHISPER_MODEL=large-v2

:: Task parameters (will be overridden by request)
set WHISPER_BEAM_SIZE=5
set WHISPER_VAD_FILTER=True

python scripts/whisper_server.py

if errorlevel 1 (
    echo [ERROR] Server exited unexpectedly.
    pause
)
