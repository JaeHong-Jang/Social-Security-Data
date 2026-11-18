"""이음등 로컬 API 서버 (계약: prototype/api/CONTRACT.md).

실행: .venv/bin/uvicorn prototype.api.server:app --host 127.0.0.1 --port 8787
- GET  /api/health   Ollama 연결·모델·프롬프트 버전. 주소(IP)는 응답에 넣지 않는다.
- GET  /api/cases    households.v3.json에서 audit(성별·연령)을 뺀 것
- GET  /api/samples  예시 메모 세트(가상 mock 가구의 메모. eval/testset은 쓰지 않는다)
- POST /api/analyze  메모 → SSE(start → step… → f1… → result → end). live는 실제 LLM, replay는 녹화 재생.

파이프라인 배선은 build_mock_v3와 같다: F1 = f1_classify(extract → finalize), 반복 장벽 = f1_cross,
가구 = build_mock_v2.build_household, F2·행동 = f2_priority_v2, F3 = 손 작성 mock 매핑(예시 가구만, 그 외 0개).
입력 메모는 메모 1건 = 발굴·종결 1회로 본다. 직접 입력한 메모에는 행정 정보(위기영역·종결 후 신호)가 없어 그 항목은 0점이다.
"""
import asyncio
import json
import logging
import os
import re
import time
import urllib.request
import uuid
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from prototype.api.schemas_v2 import F1ResultV2, admin_closure_label
from prototype.llm import ollama
from prototype.pipeline import f1_classify, f1_cross
from prototype.pipeline import f2_priority_v2 as f2
from prototype.pipeline.f3_match import checks_narrowed, household_tags
from prototype.scripts import build_mock_v2 as v2

ROOT = Path(__file__).resolve().parents[2]
MODEL = os.environ.get("IEUM_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
CASES_FILE = ROOT / "prototype/web/mock/households.v3.json"
REC_DIR = ROOT / "prototype/web/mock/recordings"
REPLAY_MAX_MS = 6000
MAX_MEMOS, MAX_CHARS = 5, 1000
HOUSEHOLD_TYPES = ("1인가구", "부부가구", "한부모가구", "조손가구", "다인가구")
STEPS = [("validate", "원문 확인"), ("f1", "메모 읽기"), ("quote_check", "인용 원문 대조"),
         ("refusal_guard", "거부 표현 가드"), ("cross", "회차 비교"), ("f2", "재검토 점수"),
         ("action", "행동 제안"), ("f3", "조건 대조")]
NO_MATCH_MSG = "녹화된 예시와 일치하는 메모가 없습니다. '예시 불러오기'로 고른 메모를 그대로 재생해 주세요."
OFF_MSG = "AI 서버가 꺼져 있어 예시만 재생할 수 있습니다. '예시 불러오기'로 고른 메모를 그대로 분석해 주세요."

log = logging.getLogger("ieum.api")

# ---------- 예시 메모 세트: UI용 가상 mock 가구(build_mock_v2.HH)의 메모 ----------
# (id, 제목, 가구 id, 쓸 메모 위치)
_SAMPLE_DEFS = [("S1", "서류 부담으로 두 번 미룸", "H-0412", (0, 2)),
                ("S2", "문자·방문 거부와 고립 징후", "H-0233", (0, 1)),
                ("S3", "조사가 안 끝났는데 종결 처리된 메모", "H-0816", (0,)),
                ("S4", "위기가 잠시 풀렸다는 진술", "H-0205", (0, 1))]


def _sample_ctx(hh_id: str, idx: tuple[int, ...]) -> dict:
    """HH 가구에서 고른 메모만 남긴 문맥(행정 발굴 이력·종결 후 신호·F3 mock 후보 포함)."""
    d = next(x for x in v2.HH if x["id"] == hh_id)
    memos = [d["memos"][i] for i in idx]
    keep = {m["disc"] for m in memos}
    return d | {"memos": memos, "disc": [x for x in d["disc"] if x[0] in keep]}


SAMPLES = []
for _sid, _title, _hh, _idx in _SAMPLE_DEFS:
    _ctx = _sample_ctx(_hh, _idx)
    SAMPLES.append({"id": _sid, "title": _title, "household_type": _ctx["type"],
                    "memos": [{"date": m["written"], "consult_type": m["ctype"], "text": m["text"]}
                              for m in _ctx["memos"]],
                    "_ctx": _ctx})


def public_sample(s: dict) -> dict:
    return {k: v for k, v in s.items() if not k.startswith("_")}


def match_sample(memos: list[dict]) -> dict | None:
    """메모 원문이 예시와 같으면 그 예시(행정 문맥·녹화를 쓴다)."""
    texts = [m["text"].strip() for m in memos]
    return next((s for s in SAMPLES if [m["text"] for m in s["memos"]] == texts), None)


# ---------- Ollama 상태 ----------
def ollama_status() -> dict:
    """→ {reachable, model_ok}. 주소는 밖으로 내보내지 않는다."""
    try:
        with urllib.request.urlopen(ollama.host() + "/api/tags", timeout=2) as r:
            names = {m["name"] for m in json.loads(r.read()).get("models", [])}
        return {"reachable": True, "model_ok": MODEL in names}
    except Exception as e:  # noqa: BLE001 - 연결 실패는 모두 '꺼짐'
        log.info("ollama 상태 확인 실패: %s", type(e).__name__)
        return {"reachable": False, "model_ok": False}


def warmup():
    """모델 적재 + F1 시스템 프롬프트를 한 번 읽혀 둔다(첫 분석의 적재·프롬프트 처리 지연을 측정·시연에서 뺀다)."""
    try:
        ollama._post("/api/generate", {"model": MODEL, "prompt": "", "keep_alive": "30m"}, timeout=120)
    except Exception as e:  # noqa: BLE001
        log.info("모델 적재 실패: %s", type(e).__name__)
        return
    f1_classify.extract("상담안내 종결.", MODEL)  # 예외를 내지 않는다


@asynccontextmanager
async def _lifespan(_app):
    if os.environ.get("IEUM_NO_WARMUP") != "1":
        asyncio.get_running_loop().run_in_executor(None, warmup)  # 첫 분석의 모델 적재 지연을 줄인다
    yield


app = FastAPI(title="이음등 API", version="1", lifespan=_lifespan)


@app.get("/api/health")
def health():
    st = ollama_status()
    up = st["reachable"] and st["model_ok"]
    return {"ok": True, "ollama": up, "model": MODEL, "prompt_version": f1_classify.PROMPT_VERSION,
            "mode": "live" if up else "replay"}


@app.get("/api/cases")
def cases():
    data = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    return {"meta": data["meta"], "cases": data["cases"]}  # audit(성별·연령) 제외


@app.get("/api/samples")
def samples():
    return [public_sample(s) for s in SAMPLES]


# ---------- 입력 검사 ----------
class InputError(ValueError):
    pass


def _consult_type(v) -> str:
    s = str(v or "")
    return "전화 상담" if "전화" in s else "내방 상담" if "내방" in s else "방문 상담"


def validate(body) -> tuple[str, list[dict]]:
    """→ (가구 유형, 정규화된 메모[{date, consult_type, text}]). 문제가 있으면 한국어 InputError."""
    if not isinstance(body, dict):
        raise InputError("요청 형식이 올바르지 않습니다.")
    ht = body.get("household_type")
    if ht not in HOUSEHOLD_TYPES:
        raise InputError("가구 유형은 " + "·".join(HOUSEHOLD_TYPES) + " 중 하나여야 합니다.")
    memos = body.get("memos")
    if not isinstance(memos, list) or not 1 <= len(memos) <= MAX_MEMOS:
        raise InputError(f"메모는 1건 이상 {MAX_MEMOS}건 이하로 넣어 주세요.")
    out, today = [], date.today()
    for i, m in enumerate(memos, 1):
        if not isinstance(m, dict):
            raise InputError(f"메모 {i}의 형식이 올바르지 않습니다.")
        text = str(m.get("text") or "").strip()
        if not text:
            raise InputError(f"메모 {i}의 내용이 비어 있습니다.")
        if len(text) > MAX_CHARS:
            raise InputError(f"메모 {i}가 {len(text):,}자입니다. 메모 1건은 {MAX_CHARS:,}자 이하로 줄여 주세요.")
        try:
            d = date.fromisoformat(str(m.get("date") or ""))
        except ValueError:
            raise InputError(f"메모 {i}의 날짜를 YYYY-MM-DD 형식으로 넣어 주세요.") from None
        if d > today:
            raise InputError(f"메모 {i}의 날짜({d})가 오늘 이후입니다.")
        out.append({"date": d.isoformat(), "consult_type": _consult_type(m.get("consult_type")), "text": text})
    if [m["date"] for m in out] != sorted(m["date"] for m in out):
        raise InputError("메모는 오래된 것부터 날짜순으로 넣어 주세요.")
    return ht, out


def _ctx_for(ht: str, memos: list[dict]) -> tuple[dict, date]:
    """→ (HH 모양 문맥, 기준일). 예시면 그 가구의 행정 문맥, 아니면 메모 1건 = 상담안내 종결 1회로 만든다."""
    s = match_sample(memos)
    if s:
        return s["_ctx"], v2.TODAY
    return {"id": "H-9000", "gu": "미입력", "dong": "미입력", "type": ht,
            "disc": [(m["date"], [], "D") for m in memos], "signals": [], "f3": [], "notice": None,
            "memos": [{"disc": m["date"], "written": m["date"], "ctype": m["consult_type"], "text": m["text"],
                       "_typed": True} for m in memos]}, date.today()


# ---------- 분석 (live) ----------
def _ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)


def _step(id_, status, ms=None, detail=None, memo_index=None) -> tuple[str, dict]:
    d = {"id": id_, "status": status}
    if ms is not None:
        d["ms"] = ms
    if detail:
        d["detail"] = detail
    if memo_index is not None:
        d["memo_index"] = memo_index
    return "step", d


def _f1_detail(f: F1ResultV2, info: dict) -> str:
    if not info["llm_ok"]:
        return "AI 출력 형식 검사 실패 → 판단보류(담당자 확인)"
    ct = f" {f.closure_type}" if f.closure_type else ""
    return f"{f.work_status}{ct} · 장벽 {f.barrier_cause} · 근거 인용 {info['quotes_proposed']}개 제안"


async def live_events(ht: str, memos: list[dict], validate_ms: float):
    """검증된 입력 → (event, data) 순서열. 느린 LLM 호출은 스레드풀에서 돌려 이벤트가 바로바로 나가게 한다."""
    ctx, today = _ctx_for(ht, memos)
    yield _step("validate", "done", validate_ms, f"메모 {len(memos)}건 · {sum(len(m['text']) for m in memos):,}자"
                + (" · 예시 가구 행정 정보 사용" if not ctx["memos"][0].get("_typed") else
                   " · 행정 정보(위기영역·새 신호) 없음"))

    f1s, infos = [], []
    for i, m in enumerate(memos):
        yield _step("f1", "running", memo_index=i)
        t0 = time.perf_counter()
        out, meta, err = await run_in_threadpool(f1_classify.extract, m["text"], MODEL)
        ms = _ms(t0)
        if err is not None:
            log.warning("F1 실패 memo=%d: %s", i, type(err).__name__)
        res, info = f1_classify.finalize(m["text"], MODEL, out, meta, err)
        f1s.append(res)
        infos.append(info)
        yield _step("f1", "done" if info["llm_ok"] else "error", ms, _f1_detail(res, info), i)
        yield "f1", {"memo_index": i, "f1": res.model_dump(mode="json")}

    yield _step("quote_check", "running")
    prop = sum(x["quotes_proposed"] for x in infos)
    ver = sum(x["quotes_verified"] for x in infos)
    det = f"인용 {prop}개 중 {ver}개 원문과 일치" + (f", {prop - ver}개 버림(미확인 처리)" if prop > ver else "")
    staff = [f"메모 {i + 1} {'·'.join(x['staff_plan_guard'])}" for i, x in enumerate(infos) if x["staff_plan_guard"]]
    if staff:
        det += " · 담당자 계획 구절은 동의로 안 봄: " + ", ".join(staff)
    yield _step("quote_check", "done", round(sum(x["quote_check_ms"] for x in infos), 2), det)

    yield _step("refusal_guard", "running")
    moved = [f"메모 {i + 1} {'·'.join(x['consent_guard'])}" for i, x in enumerate(infos) if x["consent_guard"]]
    found = [f"메모 {i + 1} {'·'.join(chs)}" for i, m in enumerate(memos)
             if (chs := [ch for ch, pats in f1_classify.REFUSAL.items() if any(re.search(p, m["text"]) for p in pats)])]
    yield _step("refusal_guard", "done", round(sum(x["guard_ms"] for x in infos), 2),
                ("AI가 놓친 명시적 거부를 '거부'로 올림: " + ", ".join(moved)) if moved else
                ("명시적 거부 표현 확인, AI 값과 같음: " + ", ".join(found)) if found else "명시적 거부 표현 없음")

    yield _step("cross", "running")
    t0 = time.perf_counter()
    rb = f1_cross.repeated_barrier(f1s)
    yield _step("cross", "done", _ms(t0), rb.summary if rb else
                "비교할 메모가 1건뿐입니다" if len(f1s) < 2 else "같은 장벽 원인의 반복 없음")

    yield _step("f2", "running")
    t0 = time.perf_counter()
    res_by_disc = v2.admin_results(ctx)
    hmemos = [{"discovery_date": cm["disc"], "written_at": cm["written"], "consult_type": cm["ctype"],
               "text": cm["text"], "closure_label": None if cm.get("_typed") else admin_closure_label(res_by_disc[cm["disc"]]),
               "f1": f.model_dump(mode="json")} for cm, f in zip(ctx["memos"], f1s)]
    h = v2.build_household(ctx, hmemos, rb, today=today)
    score = f2.score(h)
    yield _step("f2", "done", _ms(t0), f"{score.total}점 · {score.level}"
                + (f" · {', '.join(score.flags)}" if score.flags else ""))

    yield _step("action", "running")
    t0 = time.perf_counter()
    tags = household_tags(h)
    cands = [v2.cand(s, q, c, ctx["gu"], tags) for s, q, c in ctx["f3"]]
    action = f2.suggest_action(h, score, n_candidates=len(cands))
    yield _step("action", "done", _ms(t0), action.outreach + (" · 안전 확인 경로 따로" if action.safety_check else ""))

    yield _step("f3", "running")
    t0 = time.perf_counter()
    f3 = {"concept": "조건 대조", "candidates": cands, "checks_narrowed": checks_narrowed(cands).model_dump(),
          "tag_filter": tags, "tag_filter_source": "mock-mapping",
          "notice_draft": ctx["notice"] if cands else None, "notice_source": "mock", "model": "mock"}
    yield _step("f3", "done", _ms(t0), f"후보 {len(cands)}개 (mock 매핑)" if cands else
                "후보 0개 (이 메모에 대한 mock 매핑 없음)")

    yield "result", {"f1": [f.model_dump(mode="json") for f in f1s],
                     "repeated_barrier": rb.model_dump(mode="json") if rb else None,
                     "f2": score.model_dump(mode="json"), "action": action.model_dump(mode="json"), "f3": f3}


# ---------- 재생 (replay) ----------
def load_recording(sample_id: str) -> dict | None:
    p = REC_DIR / f"{sample_id}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


async def replay_events(rec: dict):
    """녹화의 start·end 사이 이벤트를 같은 순서로, 실제 간격 비율대로(최대 REPLAY_MAX_MS) 보낸다."""
    evs = [e for e in rec["events"] if e["event"] not in ("start", "end")]
    prev = next(e["t_ms"] for e in rec["events"] if e["event"] == "start")  # 시작 이벤트 기준
    total = evs[-1]["t_ms"] - prev if evs else 0
    scale = min(1.0, REPLAY_MAX_MS / total) if total else 0
    for e in evs:
        await asyncio.sleep(max(0.0, (e["t_ms"] - prev) * scale / 1000))
        prev = e["t_ms"]
        yield e["event"], e["data"]


# ---------- SSE ----------
def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def resolve_mode(req_mode) -> str:
    if req_mode in ("live", "replay"):
        return req_mode
    st = ollama_status()
    return "live" if st["reachable"] and st["model_ok"] else "replay"


async def analyze_events(body):
    """(event, data) 순서열 전체: start → … → end. 녹화 스크립트와 테스트도 이 함수를 쓴다."""
    run_id = uuid.uuid4().hex[:12]
    t_run = time.perf_counter()
    req_mode = body.get("mode", "auto") if isinstance(body, dict) else "auto"
    mode = await run_in_threadpool(resolve_mode, req_mode)
    sample = None
    try:
        if req_mode not in ("auto", "live", "replay"):
            raise InputError("mode는 auto·live·replay 중 하나여야 합니다.")
        t0 = time.perf_counter()
        ht, memos = validate(body)
        validate_ms = _ms(t0)
        sample = match_sample(memos)
    except InputError as e:
        ht = memos = None
        err = str(e)
    rec = load_recording(sample["id"]) if mode == "replay" and sample else None
    model = rec["model"] if rec else MODEL
    start = {"run_id": run_id, "mode": mode, "model": model, "steps": [{"id": i, "label": l} for i, l in STEPS]}
    if rec:
        start |= {"sample_id": sample["id"], "recorded_at": rec["recorded_at"]}
    yield "start", start
    if not rec:
        yield _step("validate", "running")  # 재생이면 녹화에 들어 있다
    if memos is None:
        yield _step("validate", "error", detail=err)
        yield "error", {"message": err}
    elif mode == "replay" and not rec:
        yield _step("validate", "done", validate_ms)
        msg = "이 예시의 녹화 파일이 없어 재생할 수 없습니다." if sample else OFF_MSG if req_mode != "replay" else NO_MATCH_MSG
        yield "error", {"message": msg}
    elif mode == "live" and req_mode == "live" and not (await run_in_threadpool(ollama_status))["model_ok"]:
        yield _step("validate", "done", validate_ms)
        yield "error", {"message": "AI 서버(Ollama)에 연결할 수 없습니다. 예시 재생(replay)으로 바꿔 주세요."}
    else:
        events = replay_events(rec) if rec else live_events(ht, memos, validate_ms)
        try:
            async for ev in events:
                yield ev
        except Exception as e:  # noqa: BLE001 - 사용자에게는 한국어 메시지만, 상세는 로그로
            log.exception("analyze 실패 run=%s", run_id)
            yield "error", {"message": f"분석 중 오류가 났습니다({type(e).__name__}). 담당자가 메모를 직접 확인해 주세요."}
    yield "end", {"run_id": run_id, "elapsed_ms": _ms(t_run)}


@app.post("/api/analyze")
async def analyze(request: Request):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - JSON이 아니면 validate가 한국어 메시지를 낸다
        body = None

    async def stream():
        async for event, data in analyze_events(body):
            yield _sse(event, data)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
