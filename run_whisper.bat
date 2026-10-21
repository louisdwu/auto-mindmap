@echo off
chcp 65001 > nul
title 本地 ASR 服务 / 拖拽识别工具（多引擎）

echo ====================================================
echo   本地 ASR 识别助手  (多引擎：faster-whisper / Qwen3)
echo   默认引擎：faster-whisper large-v3
echo ====================================================
echo.

if "%ASR_ENGINE%"=="" set ASR_ENGINE=faster-whisper

echo [引擎] %ASR_ENGINE%
echo [模型] %FW_MODEL%
echo.
echo   切换引擎：set ASR_ENGINE=qwen3   （Qwen3-ASR，精度更高但慢很多）
echo   参数文档：scripts\ENGINE_PARAMS.md
echo.

set SCRIPT_PATH=%~dp0scripts\whisper_server.py

if "%~1"=="" (
    echo [模式] 启动 ASR Web API 服务器 (端口: 2233)...
    echo 正在加载模型中，请稍候...
    echo.
    echo ====================================================
    echo   服务启动后浏览器直接打开:
    echo     http://localhost:2233
    echo   即可使用网页版「视频语音识别 / SRT 字幕生成器」
    echo ====================================================
    echo.
    python "%SCRIPT_PATH%"
) else (
    echo [模式] 本地文件拖拽转录 (同时输出 .txt 与 .srt)
    echo 目标文件: %1
    echo.
    python "%SCRIPT_PATH%" "%~1"
)

echo.
echo ====================================================
echo 执行结束。
pause
