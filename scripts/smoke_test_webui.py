# -*- coding: utf-8 -*-
"""
冒烟测试：不加载真实模型，只验证接口契约与 SRT 字段。

做法：
  1. 设 _BOOT_GUARD=1 跳过引擎模型加载（仅做接口校验，不占 GPU）；
  2. exec 服务端源码，拿到 FastAPI app；
  3. 把 engine 换成假引擎、_acquire_audio 换成假实现，绕过真实推理；
  4. 逐条打 GET / 网页、GET /health、POST /transcribe（流式/非流式）、
     POST /v1/audio/transcriptions。

用法：
    cd scripts
    python smoke_test_webui.py

预期最后一行： === ALL SMOKE TESTS PASSED ===
"""
import json
import os
import re
import sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "whisper_server.py")

# --- 关键：跳过模型加载 ---
os.environ["_BOOT_GUARD"] = "1"

code = open(SRC, encoding="utf-8").read()
ns = {"__file__": SRC, "__name__": "ws_smoke"}
exec(compile(code, SRC, "exec"), ns)
app = ns["app"]

from fastapi.testclient import TestClient  # noqa: E402

c = TestClient(app)

# ============================================================ #
# 1) GET /  ->  网页版「视频语音识别 / SRT 字幕生成器」
# ============================================================ #
r = c.get("/")
assert r.status_code == 200, r.status_code
body = r.text
assert "SRT 字幕生成器" in body, "网页标题缺失"
print("[OK] GET / -> HTTP", r.status_code, "|", r.headers.get("content-type"), "| bytes:", len(body))
print("     关键控件:", all(k in body for k in
                      ['id="drop"', 'id="btnStart"', 'id="btnSrt"', 'id="optVideoId"', 'inlineToSrt']))

# ============================================================ #
# 2) GET /health  ->  模型未加载（_BOOT_GUARD 生效）
# ============================================================ #
r = c.get("/health")
assert r.status_code == 200
h = r.json()
print("[OK] GET /health ->", json.dumps(h, ensure_ascii=False))
assert h["model_loaded"] is False
assert h["engine"] == "faster-whisper"

# ============================================================ #
# 3) GET /v1/models  ->  OpenAI 兼容列表（扩展端探测依赖）
# ============================================================ #
r = c.get("/v1/models")
assert r.status_code == 200
m = r.json()
ids = [d["id"] for d in m["data"]]
print("[OK] GET /v1/models ->", ids)
assert "large-v2" in ids and "whisper-1" in ids

# ============================================================ #
# 4) 注入假引擎，验证 SRT 字段
# ============================================================ #
class FakeEngine:
    name = "faster-whisper"
    display_name = "Faker (smoke test)"

    def is_loaded(self):
        return True

    def describe(self):
        return {"engine": self.name, "display_name": self.display_name,
                "model": "large-v3", "device": "cuda:0", "compute_type": "float16"}

    def transcribe(self, audio_path, language=None, context=None):
        cues = [{"text": "这是一段测试音频内容。", "start": 0.0, "end": 5.0}]
        from asr_engines.common import build_inline_text, build_srt
        return {"text": build_inline_text(cues), "srt": build_srt(cues),
                "cues": cues, "language": "zh"}

ns["engine"] = FakeEngine()
ns["engine"].is_loaded = property(lambda s: True)

payload = {"model": "large-v2", "response_format": "json", "stream": "true",
           "language": "zh", "file_path": "NOT_EXISTS_BUT_STUBBED"}

orig_acquire = ns["_acquire_audio"]

async def fake_acquire(file, audio_url, video_id, file_path, cache_dir, mp3, safe_id, logs):
    logs.append("STUB: 使用打桩音频")
    return "STUB_AUDIO_PATH", False

ns["_acquire_audio"] = fake_acquire

# --- 4a) 流式 ---
r = c.post("/transcribe", data=payload)
assert r.status_code == 200, (r.status_code, r.text[:300])
lines = [l for l in r.text.splitlines() if l.strip()]
print("[OK] POST /transcribe (stream) -> HTTP", r.status_code, "| 行数:", len(lines))
for l in lines:
    print("     |", l[:100])
last = [l for l in lines if l.startswith("JSON:")]
assert last, "未收到 JSON 行"
j = json.loads(last[-1][5:])
assert j["text"], "text 为空"
assert j.get("srt") and "-->" in j["srt"], "srt 缺失，实际: %r" % (j.get("srt"),)
print("[OK] JSON 行字段:", {k: (len(v) if isinstance(v, str) else v) for k, v in j.items()})

# --- 4b) 非流式 JSON ---
r2 = c.post("/transcribe", data={k: v for k, v in payload.items() if k != "stream"})
assert r2.status_code == 200, (r2.status_code, r2.text[:300])
j2 = r2.json()
assert j2.get("srt") and "-->" in j2["srt"], "非流式响应缺少 srt"
print("[OK] POST /transcribe (json)   字段:", list(j2.keys()))

# --- 4c) OpenAI 兼容接口 ---
r3 = c.post("/v1/audio/transcriptions",
            data={"model": "large-v2", "response_format": "json", "file_path": "X"})
assert r3.status_code == 200, (r3.status_code, r3.text[:300])
j3 = r3.json()
assert j3.get("srt"), "OpenAI 兼容接口缺少 srt"
print("[OK] POST /v1/audio/transcriptions 字段:", list(j3.keys()))

# --- 4d) response_format=text ---
r4 = c.post("/v1/audio/transcriptions",
            data={"model": "large-v2", "response_format": "text", "file_path": "X"})
assert r4.status_code == 200
assert "-->" not in r4.text, "text 模式不应含 SRT"
print("[OK] POST /v1/audio/transcriptions (text) ->", repr(r4.text[:60]))

# ============================================================ #
# 5) 引擎注册表与参数预设
# ============================================================ #
from asr_engines import create_engine, ENGINES, select_engine_name  # noqa: E402
from asr_engines.fasterwhisper import load_config, PRESETS  # noqa: E402

os.environ.pop("ASR_ENGINE", None)
assert select_engine_name() == "faster-whisper", "默认引擎应为 faster-whisper"
print("[OK] 默认引擎 = faster-whisper | 已登记引擎:", sorted({v[1] for v in ENGINES.values()}))

cfg = load_config()
print("[OK] large-v3 预设 ->", {k: cfg[k] for k in
                          ("model", "compute_type", "beam_size", "best_of", "vad_filter")})
assert cfg["model"] == "large-v3"
assert cfg["compute_type"] == "int8_float16", "GPU 默认应为 int8_float16"
assert cfg["beam_size"] == 1
assert cfg["vad_filter"] is True

print("\n=== ALL SMOKE TESTS PASSED ===")
