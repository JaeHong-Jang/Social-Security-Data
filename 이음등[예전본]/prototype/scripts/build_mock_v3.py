"""시연 데이터 v3 → prototype/web/mock/households.v3.json
v2와 같은 가상 16가구·메모를 쓰되, 메모별 F1과 회차 교차(반복 장벽)는 **실제 로컬 LLM 출력**이다.
- F1: f1_classify.classify(메모, 모델) 결과를 그대로 쓴다(거부 가드 포함). 모델 오류를 손으로 고치지 않는다.
  메모마다 LLM 원출력(raw)을 meta.f1_runs에 남겨, 테스트가 raw → build_result 재계산으로 같은 F1인지 확인한다.
- 반복 장벽은 f1_cross 규칙, F2·행동 제안은 f2_priority_v2 규칙으로 실제 F1에서 다시 계산한다.
- F3 후보·조건 대조·안내문 초안은 v2와 같은 손 작성 mock이다(notice_source="mock", tag_filter_source="mock-mapping").
- 손으로 만든 담당자 결정(v2)이 새 AI 제안과 다르고 사유가 없으면 '미검토'로 되돌리고 meta.decisions_reset에 남긴다.
사용: .venv/bin/python -m prototype.scripts.build_mock_v3 [모델]
"""
import statistics as st
import sys
import time

from prototype.api.schemas_v2 import admin_closure_label
from prototype.llm import ollama
from prototype.pipeline import f1_classify
from prototype.scripts.build_mock_v2 import AUDIT, HH, ROOT, admin_results, base_meta, make_case, write

MODEL = sys.argv[1] if len(sys.argv) > 1 else "qwen3:4b-instruct-2507-q4_K_M"
OUT = ROOT / "prototype/web/mock/households.v3.json"


def run_memo(d, i, m):
    res, info = f1_classify.classify(m["text"], MODEL)
    memo = {"discovery_date": m["disc"], "written_at": m["written"], "consult_type": m["ctype"], "text": m["text"],
            "closure_label": admin_closure_label(admin_results(d)[m["disc"]]), "f1": res.model_dump(mode="json")}
    run = {"household_id": d["id"], "memo_index": i,
           **{k: info.get(k) for k in ("latency_s", "attempts", "llm_ok", "quotes_proposed", "quotes_verified",
                                       "dropped", "staff_plan_guard", "consent_guard", "errors", "error")},
           "raw": info.get("raw")}
    return memo, run


def main():
    info = ollama.model_info(MODEL)
    ollama._post("/api/generate", {"model": MODEL, "prompt": "", "keep_alive": "10m"})  # 적재(지연 측정에서 제외)
    t0 = time.time()
    cases, runs, reset = [], [], []
    for d in HH:
        memos = []
        for i, m in enumerate(d["memos"]):
            memo, run = run_memo(d, i, m)
            memos.append(memo)
            runs.append(run)
        case = make_case(d, memos, f1_source="llm")
        dec = d["decision"]
        if dec and dec[0] != case["action"]["outreach"] and not dec[2]:
            reset.append({"household_id": d["id"], "hand_decision": dec[0], "ai_suggestion": case["action"]["outreach"]})
            case["decision"] = {"status": "미검토", "ai_suggestion": case["action"]["outreach"]}
        cases.append(case)
        print(d["id"], [(x["f1"]["work_status"], x["f1"]["closure_type"], x["f1"]["barrier_cause"]) for x in memos],
              flush=True)
    ollama._post("/api/generate", {"model": MODEL, "prompt": "", "keep_alive": 0})
    lat = [r["latency_s"] for r in runs if r["latency_s"] is not None]
    prop = sum(r["quotes_proposed"] or 0 for r in runs)
    meta = base_meta() | {
        "notice": "가상 데이터 — 가구·메모는 UI 개발용 가상 16가구. F1·반복 장벽은 실제 로컬 LLM 출력이며 "
                  "손으로 고치지 않았다. F3 후보·안내문·태그 매핑은 mock이다.",
        "f1_source": "llm", "f1_model": MODEL, "f1_model_info": info,
        "f1_prompt": f1_classify.PROMPT_FILE, "f1_prompt_version": f1_classify.PROMPT_VERSION,
        "f1_options": ollama.OPTIONS, "f1_run_at": time.strftime("%Y-%m-%d %H:%M"),
        "f1_wall_s": round(time.time() - t0, 1),
        "f1_latency": {"n_memos": len(runs), "mean_s": round(st.mean(lat), 2) if lat else None,
                       "max_s": max(lat) if lat else None},
        "f1_llm_ok": sum(bool(r["llm_ok"]) for r in runs), "f1_quotes_proposed": prop,
        "f1_quote_verified_rate": round(sum(r["quotes_verified"] or 0 for r in runs) / prop, 3) if prop else None,
        "f1_runs": runs, "decisions_reset": reset,
    }
    v = write({"meta": meta, "cases": cases,
               "audit": [{"household_id": k, "gender": g, "age_band": a} for k, (g, a) in AUDIT.items()]}, OUT)
    rb = {c.household.id: c.household.repeated_barrier for c in v.cases}
    print("H-0412 반복 장벽:", rb["H-0412"].summary if rb["H-0412"] else None, "| reset:", reset)


if __name__ == "__main__":
    main()
