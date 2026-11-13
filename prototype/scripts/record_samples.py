"""예시 메모 세트(GET /api/samples)를 실제 로컬 LLM으로 한 번씩 분석하고 이벤트 흐름을 녹화한다.
→ prototype/web/mock/recordings/<id>.json (+ index.json: 예시 목록). 서버 replay 모드와 오프라인 웹 빌드가 재생한다.
녹화는 서버의 analyze_events를 그대로 돌려 만든다(같은 코드 경로). t_ms는 실행 시작부터의 실제 경과 시간이다.
사용: .venv/bin/python -m prototype.scripts.record_samples [S1 S2 ...]
"""
import asyncio
import json
import sys
import time

from prototype.api import server
from prototype.llm import ollama
from prototype.pipeline import f1_classify


async def record(sample: dict) -> list[dict]:
    body = {"household_type": sample["household_type"], "memos": sample["memos"], "mode": "live"}
    t0 = time.perf_counter()
    out = []
    async for event, data in server.analyze_events(body):
        out.append({"t_ms": round((time.perf_counter() - t0) * 1000, 1), "event": event, "data": data})
    return out


def main():
    want = set(sys.argv[1:])
    server.REC_DIR.mkdir(parents=True, exist_ok=True)
    info = ollama.model_info(server.MODEL)
    server.warmup()  # 모델 적재·프롬프트 처리는 지연 측정에서 뺀다
    for s in server.SAMPLES:
        if want and s["id"] not in want:
            continue
        events = asyncio.run(record(s))
        names = [e["event"] for e in events]
        assert names[0] == "start" and names[-1] == "end" and "result" in names and "error" not in names, names
        rec = {"sample_id": s["id"], "sample": server.public_sample(s), "notice": "가상 데이터 — 실제 로컬 LLM 실행 녹화",
               "model": server.MODEL, "model_info": info, "prompt_version": f1_classify.PROMPT_VERSION,
               "llm_options": ollama.OPTIONS, "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "elapsed_ms": events[-1]["data"]["elapsed_ms"], "events": events}
        (server.REC_DIR / f"{s['id']}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
        res = next(e["data"] for e in events if e["event"] == "result")
        print(s["id"], f"{rec['elapsed_ms'] / 1000:.1f}s", [(f["work_status"], f["closure_type"], f["barrier_cause"])
                                                            for f in res["f1"]],
              res["f2"]["total"], res["f2"]["level"], res["action"]["outreach"], flush=True)
    (server.REC_DIR / "index.json").write_text(
        json.dumps([server.public_sample(s) for s in server.SAMPLES], ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
