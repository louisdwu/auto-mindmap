@echo off
chcp 65001 > nul
title Faster-Whisper 本地 ASR 服务 / 拖拽识别工具

echo ====================================================
echo   Faster-Whisper 本地 ASR 识别助手
echo ====================================================
echo.

set SCRIPT_PATH=%~dp0scripts\whisper_server.py

if "%~1"=="" (
    echo [模式] 启动 ASR Web API 服务器 (端口: 2233)...
    echo 正在加载 Faster-Whisper 模型中，请稍候...
    python "%SCRIPT_PATH%"
) else (
    echo [模式] 本地文件拖拽转录
    echo 目标文件: %1
    echo.
    python "%SCRIPT_PATH%" "%~1"
)

echo.
echo ====================================================
echo 执行结束。
pause
