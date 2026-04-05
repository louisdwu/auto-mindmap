import os
import io
import sys
import time
import site
import tempfile
import traceback
import requests
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# --- 修复 CUDA 12 DLL 缺失问题 (针对 Windows) ---
if sys.platform == "win32":
    # 尽可能收集所有的 site-packages 路径 (pip 安装情况)
    site_dirs = []
    if hasattr(site, 'getsitepackages'):
        site_dirs.extend(site.getsitepackages())
    if hasattr(site, 'getusersitepackages'):
        site_dirs.append(site.getusersitepackages())
    
    # 【新增】显式包含本地已有的 CUDA 12 目录 (从卡卡字幕助手提取)
    local_cuda_paths = [
        r"D:\Green\卡卡字幕助手VideoCaptioner\resource\bin\Faster-Whisper-XXL\_xxl_data\torch\lib",
        r"D:\Green\卡卡字幕助手VideoCaptioner\resource\bin",
        r"D:\Green\卡卡字幕助手VideoCaptioner\resource"
    ]
    
    # 结合 site-packages 中的 nvidia 运行库目录
    nvidia_libs = [
        os.path.join("nvidia", "cublas", "bin"),
        os.path.join("nvidia", "cudnn", "bin")
    ]
    
    search_paths = local_cuda_paths[:]
    for base in site_dirs:
        for lib_rel in nvidia_libs:
            search_paths.append(os.path.join(base, lib_rel))
    
    added_count = 0
    for full_path in search_paths:
        if os.path.isdir(full_path):
            # 显式加入 DLL 搜索路径 (Python 3.8+)
            os.add_dll_directory(full_path)
            # 同时注入 PATH 以防万一
            os.environ["PATH"] = full_path + os.pathsep + os.environ["PATH"]
            added_count += 1
    
    if added_count > 0:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 已自动加载 {added_count} 个本地/环境 CUDA 运行库目录。")


from faster_whisper import WhisperModel
import uvicorn

app = FastAPI(title="Faster Whisper Local ASR Server")


# 允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 核心配置：优先级 (环境变量 > 代码默认值) ---
MODEL_NAME = os.getenv("WHISPER_MODEL", "large-v2")
# 默认指向用户在 D 盘的卡卡字幕助手模型库
MODEL_BASE_DIR = os.getenv("WHISPER_MODEL_BASE_DIR", r"D:\Green\卡卡字幕助手VideoCaptioner\AppData\models")
# 拼接完整路径。如果模型名包含完整路径，则直接使用。
if os.path.exists(MODEL_NAME):
    MODEL_PATH = MODEL_NAME
else:
    MODEL_PATH = os.path.join(MODEL_BASE_DIR, f"faster-whisper-{MODEL_NAME}")
    if not os.path.isdir(MODEL_PATH):
        # 兼容简写或直接名称的情况 (如 "medium" 而不是 "faster-whisper-medium")
        MODEL_PATH = os.path.join(MODEL_BASE_DIR, MODEL_NAME)

DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "float16")
# 高性能参数：并行 Worker 数量。2080 Ti (11G) 建议设置为 2
NUM_WORKERS = int(os.getenv("WHISPER_NUM_WORKERS", 1))
# CPU 并行线程数，防止喂数据瓶颈
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", 4))

print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 正在初始化 ASR 服务 (性能增强模式)...")
print(f"模型名称: {MODEL_NAME}")
print(f"本地路径: {MODEL_PATH}")
print(f"设备参数: {DEVICE} ({COMPUTE_TYPE}), Workers: {NUM_WORKERS}, CPU Threads: {CPU_THREADS}")

model = None

def load_model():
    global model
    try:
        if os.path.exists(MODEL_PATH):
            model = WhisperModel(
                MODEL_PATH, 
                device=DEVICE, 
                compute_type=COMPUTE_TYPE,
                num_workers=NUM_WORKERS,
                cpu_threads=CPU_THREADS
            )
            print("模型加载成功！(使用本地高性能模式)")
        else:
            print(f"警告: 未找到本地模型 {MODEL_NAME}，尝试在线加载模式...")
            model = WhisperModel(
                MODEL_NAME, 
                device=DEVICE, 
                compute_type=COMPUTE_TYPE,
                num_workers=NUM_WORKERS,
                cpu_threads=CPU_THREADS
            )
            print(f"模型 {MODEL_NAME} 加载成功！(在线/缓存模式)")
    except Exception as e:
        print(f"CUDA 模型加载失败: {e}")
        print("尝试回退到 CPU 模式 (int8)...")
        try:
            model = WhisperModel("large-v2", device="cpu", compute_type="int8")
            print("CPU 模型加载成功！")
        except Exception as cpu_e:
            print(f"所有模型加载尝试均失败: {cpu_e}")

load_model()

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(None),
    audio_url: str = Form(None),
    model_name: str = Form("large-v2"),
    beam_size: str = Form(None),
    vad_filter: str = Form(None)
):
    start_time = time.time()
    tmp_path = None
    
    if model is None:
        return JSONResponse(
            status_code=503,
            content={"error": "模型尚未加载或加载失败，请检查服务器日志"}
        )

    try:
        # 1. 获取音频数据并存入临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            tmp_path = tmp.name
            
            if audio_url:
                print(f"[{time.strftime('%H:%M:%S')}] 正在从 URL 下载音频: {audio_url[:60]}...")
                headers = {
                    "Referer": "https://www.bilibili.com",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
                with requests.get(audio_url, headers=headers, stream=True, timeout=30) as r:
                    r.raise_for_status()
                    for chunk in r.iter_content(chunk_size=8192):
                        tmp.write(chunk)
            elif file:
                print(f"[{time.strftime('%H:%M:%S')}] 收到文件上传: {file.filename}")
                content = await file.read()
                tmp.write(content)
            else:
                return JSONResponse(status_code=400, content={"error": "未提供音频文件或 URL"})

        # 2. 检查文件是否有效
        file_size = os.path.getsize(tmp_path)
        if file_size == 0:
            raise ValueError("获取到的音频数据为空")
        print(f"音频准备完成，大小: {file_size / 1024 / 1024:.2f} MB")

        # 3. 获取转录参数
        # 优先使用请求参数，如果未提供则使用环境变量，最后使用默认值
        request_beam_size = int(beam_size) if beam_size else int(os.getenv("WHISPER_BEAM_SIZE", 2))
        request_vad_filter = str(vad_filter).lower() == "true" if vad_filter is not None else os.getenv("WHISPER_VAD_FILTER", "true").lower() == "true"
        
        print(f"[{time.strftime('%H:%M:%S')}] 启动识别流程 (beam_size={request_beam_size}, vad_filter={request_vad_filter})...")
        segments, info = model.transcribe(
            tmp_path, 
            beam_size=request_beam_size, 
            vad_filter=request_vad_filter
        )
        
        full_text = []
        for segment in segments:
            # 实时打印进度到控制台
            # print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
            full_text.append(segment.text)
        
        result_text = " ".join(full_text).strip()
        duration = time.time() - start_time
        print(f"转录完成！语言: {info.language}, 耗时: {duration:.2f}s, 字数: {len(result_text)}")
        
        return {
            "text": result_text,
            "language": info.language,
            "duration": duration,
            "info": {
                "language_probability": info.language_probability,
                "duration": info.duration
            }
        }

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
                "detail": error_trace.splitlines()[-1]
            }
        )
    finally:
        # 清理临时文件
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass

@app.get("/health")
async def health():
    return {
        "status": "ok" if model else "initializing/error",
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "model_loaded": model is not None
    }

if __name__ == "__main__":
    print(f"ASR 服务器启动在 http://0.0.0.0:5000")
    uvicorn.run(app, host="0.0.0.0", port=5000)
