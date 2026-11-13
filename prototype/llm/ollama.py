"""Ollama 최소 어댑터. 모든 LLM 호출은 이 모듈을 거친다.

generate_structured: /api/chat에 JSON 스키마(format)를 넘겨 구조화 출력을 받고 Pydantic으로 검증한다.
JSON·검증 실패 시 오류 문구를 되돌려 주며 최대 2번 다시 묻는다. 그래도 실패하면 LLMError.
접속 주소: 환경변수 OLLAMA_HOST → 없으면 WSL 기본 게이트웨이:11434 (Windows의 Ollama).
"""
import json
import os
import subprocess
import time
import urllib.request

from pydantic import BaseModel, ValidationError

SEED = 42
TIMEOUT_S = 180
MAX_RETRIES = 2
OPTIONS = {"temperature": 0, "seed": SEED, "num_ctx": 8192}


class LLMError(RuntimeError):
    def __init__(self, msg: str, meta: dict):
        super().__init__(msg)
        self.meta = meta


def host() -> str:
    h = os.environ.get("OLLAMA_HOST", "").strip()
    if not h:
        out = subprocess.run(["ip", "route"], capture_output=True, text=True).stdout
        gw = next((l.split()[2] for l in out.splitlines() if l.startswith("default")), "127.0.0.1")
        h = f"{gw}:11434"
    if not h.startswith("http"):
        h = "http://" + h
    return h.rstrip("/")


def _post(path: str, body: dict, timeout: float = TIMEOUT_S) -> dict:
    req = urllib.request.Request(host() + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def generate_structured(model: str, system: str, user: str, schema: type[BaseModel]):
    """→ (parsed: schema, meta{model, latency_s, attempts, errors}). 끝내 실패하면 LLMError(meta 포함)."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    meta = {"model": model, "latency_s": 0.0, "attempts": 0, "errors": []}
    t0 = time.monotonic()
    for _ in range(1 + MAX_RETRIES):
        meta["attempts"] += 1
        resp = _post("/api/chat", {"model": model, "messages": messages, "stream": False,
                                   "format": schema.model_json_schema(), "options": OPTIONS,
                                   "keep_alive": "30m"})  # 시연 중 모델이 내려가 첫 요청이 느려지는 것을 막는다
        content = resp.get("message", {}).get("content", "")
        try:
            parsed = schema.model_validate(json.loads(content))
            meta["latency_s"] = round(time.monotonic() - t0, 2)
            return parsed, meta
        except (json.JSONDecodeError, ValidationError) as e:
            err = str(e).splitlines()[0][:300]
            meta["errors"].append(err)
            messages += [{"role": "assistant", "content": content},
                         {"role": "user", "content": f"출력이 형식 검사에 실패했다: {err}\n지정된 JSON 형식으로만 다시 답하라."}]
    meta["latency_s"] = round(time.monotonic() - t0, 2)
    raise LLMError(f"{model}: {meta['attempts']}회 모두 형식 검사 실패", meta)


def model_info(model: str) -> dict:
    """결과 파일 기록용: Ollama 버전, 모델 digest·양자화·크기."""
    tags = json.loads(urllib.request.urlopen(host() + "/api/tags", timeout=10).read())
    ver = json.loads(urllib.request.urlopen(host() + "/api/version", timeout=10).read())["version"]
    m = next((t for t in tags["models"] if t["name"] == model), {})
    d = m.get("details", {})
    return {"model": model, "ollama_version": ver, "digest": m.get("digest", "")[:12],
            "parameter_size": d.get("parameter_size"), "quantization": d.get("quantization_level")}
