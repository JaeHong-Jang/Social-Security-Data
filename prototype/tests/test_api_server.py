"""API 서버(prototype/api/server.py) — CONTRACT.md 이벤트 순서·입력 검사·audit 제외. Ollama 없이 돈다(LLM은 가짜)."""
import json

import pytest
from fastapi.testclient import TestClient

from prototype.api import server
from prototype.pipeline import f1_classify
from prototype.pipeline.f1_classify import F1LLMOut

STEP_IDS = [i for i, _ in server.STEPS]
MEMO = "생계 곤란으로 발굴. 서류가 너무 많다며 나중에 하겠다고 함. 문자 안내는 괜찮다고 함. 상담안내 종결."


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("IEUM_NO_WARMUP", "1")
    monkeypatch.setattr(server, "REPLAY_MAX_MS", 30)  # 재생을 빠르게
    with TestClient(server.app) as c:
        yield c


def ollama(monkeypatch, up: bool):
    monkeypatch.setattr(server, "ollama_status", lambda: {"reachable": up, "model_ok": up})


def fake_llm(monkeypatch):
    def gen(model, system, user, schema):
        memo = user.removeprefix("메모: ")
        out = F1LLMOut(work_status_quote="상담안내 종결", work_status="종결",
                       closure_type_quote="나중에 하겠다고 함", closure_type="D1",
                       barrier_cause_quote="서류가 너무 많다며", barrier_cause="서류·절차",
                       신청_quote="나중에 하겠다고 함", 신청="보류(장벽)", 문자_quote="문자 안내는 괜찮다고 함", 문자="동의",
                       방문_quote="", 방문="미확인", support_network_quote="", support_network="미확인",
                       isolation_signals=[])
        assert "서류가 너무 많다며" in memo
        return out, {"model": model, "latency_s": 0.01, "attempts": 1, "errors": []}
    monkeypatch.setattr(f1_classify, "generate_structured", gen)


def events(resp) -> list[tuple[str, dict]]:
    assert resp.headers["content-type"].startswith("text/event-stream")
    out = []
    for block in resp.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def body(memos, mode="auto", ht="1인가구"):
    return {"household_type": ht, "memos": memos, "mode": mode}


def memo(text=MEMO, d="2026-03-04"):
    return {"date": d, "consult_type": "전화", "text": text}


def assert_contract_order(evs, n_memos):
    names = [e for e, _ in evs]
    assert names[0] == "start" and names[-1] == "end" and names[-2] == "result"
    assert names.count("f1") == n_memos and "error" not in names
    start = evs[0][1]
    assert [s["id"] for s in start["steps"]] == STEP_IDS and start["run_id"] == evs[-1][1]["run_id"]
    steps = [d for e, d in evs if e == "step"]
    # 단계 id는 계약 순서대로만 나아간다. 각 단계는 running 뒤에 done
    order = [STEP_IDS.index(s["id"]) for s in steps]
    assert order == sorted(order) and {s["id"] for s in steps} == set(STEP_IDS)
    for sid in STEP_IDS:
        st = [s["status"] for s in steps if s["id"] == sid]
        assert st[0] == "running" and st[-1] in ("done", "error")
    f1_steps = [s for s in steps if s["id"] == "f1"]
    assert [(s["memo_index"], s["status"]) for s in f1_steps if s["status"] == "running"] == \
        [(i, "running") for i in range(n_memos)]
    assert all("ms" in s for s in steps if s["status"] == "done")
    # f1 이벤트는 그 메모의 f1 done 바로 뒤
    for i in range(n_memos):
        k = next(j for j, (e, d) in enumerate(evs) if e == "step" and d["id"] == "f1" and d.get("memo_index") == i
                 and d["status"] != "running")
        assert evs[k + 1] == ("f1", evs[k + 1][1]) and evs[k + 1][1]["memo_index"] == i
    res = evs[-2][1]
    assert set(res) == {"f1", "repeated_barrier", "f2", "action", "f3"} and len(res["f1"]) == n_memos
    assert res["f3"]["notice_source"] == "mock" and len(res["f3"]["candidates"]) <= 3
    assert set(res["f2"]["excluded_attributes"]) >= {"성별", "연령", "국적"}
    return res


def test_health_reports_without_address(client, monkeypatch):
    ollama(monkeypatch, False)
    r = client.get("/api/health").json()
    assert r == {"ok": True, "ollama": False, "model": server.MODEL, "prompt_version": f1_classify.PROMPT_VERSION,
                 "mode": "replay"}
    ollama(monkeypatch, True)
    r = client.get("/api/health")
    assert r.json()["mode"] == "live" and "11434" not in r.text and "172." not in r.text


def test_cases_strip_audit(client):
    r = client.get("/api/cases")
    data = r.json()
    assert set(data) == {"meta", "cases"} and len(data["cases"]) == 16
    assert "audit" not in r.text and "gender" not in r.text and "age_band" not in r.text


def test_samples_shape(client):
    s = client.get("/api/samples").json()
    assert [x["id"] for x in s] == ["S1", "S2", "S3", "S4"]
    for x in s:
        assert set(x) == {"id", "title", "household_type", "memos"} and 1 <= len(x["memos"]) <= 5
        assert all(set(m) == {"date", "consult_type", "text"} and len(m["text"]) <= 1000 for m in x["memos"])


@pytest.mark.parametrize("b,msg", [
    (body([]), "1건 이상 5건 이하"),
    (body([memo()] * 6), "1건 이상 5건 이하"),
    (body([memo("가" * 1001)]), "1,000자 이하"),
    (body([memo()], ht="외계가구"), "가구 유형"),
    (body([memo(d="2026-13-40")]), "YYYY-MM-DD"),
    (body([memo(d="2026-05-01"), memo(d="2026-03-01")]), "날짜순"),
    (body([memo()], mode="fast"), "mode"),
    ("not json", "요청 형식"),
])
def test_analyze_validation_error(client, monkeypatch, b, msg):
    ollama(monkeypatch, False)
    r = client.post("/api/analyze", content=b if isinstance(b, str) else json.dumps(b))
    evs = events(r)
    assert [e for e, _ in evs] == ["start", "step", "step", "error", "end"]
    assert evs[2][1] == {"id": "validate", "status": "error", "detail": evs[3][1]["message"]}
    assert msg in evs[3][1]["message"]


def test_analyze_replay_sample_in_contract_order(client, monkeypatch):
    ollama(monkeypatch, False)  # auto + 꺼짐 → replay
    s = client.get("/api/samples").json()[0]
    evs = events(client.post("/api/analyze", json=body(s["memos"], ht=s["household_type"])))
    assert evs[0][1]["mode"] == "replay" and evs[0][1]["sample_id"] == "S1"
    res = assert_contract_order(evs, len(s["memos"]))
    rec = server.load_recording("S1")
    assert res == next(e["data"] for e in rec["events"] if e["event"] == "result")  # 녹화 그대로


def test_recordings_are_live_runs_of_current_samples():
    for s in server.SAMPLES:
        rec = server.load_recording(s["id"])
        assert rec["sample"] == server.public_sample(s) and rec["model"] == rec["model_info"]["model"]
        assert rec["events"][0]["data"]["mode"] == "live" and rec["model_info"]["ollama_version"]
        assert rec["prompt_version"] == f1_classify.PROMPT_VERSION  # 프롬프트가 바뀌면 다시 녹화
        assert_contract_order([(e["event"], e["data"]) for e in rec["events"]], len(s["memos"]))


def test_analyze_replay_typed_memo_errors(client, monkeypatch):
    ollama(monkeypatch, False)
    evs = events(client.post("/api/analyze", json=body([memo()], mode="replay")))
    assert evs[0][1]["mode"] == "replay"
    assert [e for e, _ in evs][-2:] == ["error", "end"] and "일치하는 메모가 없습니다" in evs[-2][1]["message"]


def test_analyze_live_with_fake_llm(client, monkeypatch):
    ollama(monkeypatch, True)
    fake_llm(monkeypatch)
    memos = [memo(d="2026-03-04"), memo(d="2026-07-10")]
    evs = events(client.post("/api/analyze", json=body(memos)))
    assert evs[0][1]["mode"] == "live"
    res = assert_contract_order(evs, 2)
    assert [f["barrier_cause"] for f in res["f1"]] == ["서류·절차", "서류·절차"]
    assert res["repeated_barrier"]["cause"] == "서류·절차"
    assert res["action"]["outreach"] == "동행 신청 지원(재방문)" and res["f3"]["candidates"] == []
    for f in res["f1"]:  # 인용은 원문 부분 문자열
        assert all(MEMO[e["start"]:e["end"]] == e["quote"] for e in f["evidence"])


def test_analyze_live_explicit_but_ollama_down(client, monkeypatch):
    ollama(monkeypatch, False)
    evs = events(client.post("/api/analyze", json=body([memo()], mode="live")))
    assert evs[0][1]["mode"] == "live" and evs[-2][0] == "error" and "Ollama" in evs[-2][1]["message"]


def test_analyze_live_refusal_guard_overrides_llm(client, monkeypatch):
    ollama(monkeypatch, True)
    fake_llm(monkeypatch)  # 가짜 LLM은 방문을 '미확인'으로 낸다
    evs = events(client.post("/api/analyze", json=body([memo(MEMO + " 집에 찾아오지 말라고 함.")])))
    res = assert_contract_order(evs, 1)
    guard = next(d for e, d in evs if e == "step" and d["id"] == "refusal_guard" and d["status"] == "done")
    assert "메모 1 방문" in guard["detail"] and res["f1"][0]["consent"]["방문"] == "거부"
    assert res["f1"][0]["consent_guard"] and res["action"]["outreach"] != "재방문"
