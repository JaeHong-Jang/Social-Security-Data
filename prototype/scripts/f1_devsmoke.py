"""F1 개발용 점검 — 정식 평가 아님(개발셋=mock, 작성자=개발팀).

prototype/web/mock/households.v2.json의 메모 전부를 모델별로 F1 분류하고, 손으로 채운 mock 라벨과 비교한다.
eval/testset/은 읽지 않는다. 실행: .venv/bin/python -m prototype.scripts.f1_devsmoke
"""
import json
import statistics as st
import sys
import time
from pathlib import Path

from prototype.api.schemas_v2 import F1ResultV2
from prototype.llm import ollama
from prototype.pipeline import f1_baseline, f1_classify, f1_cross

ROOT = Path(__file__).resolve().parents[2]
MOCK = ROOT / "prototype/web/mock/households.v2.json"
OUT = ROOT / "eval/results/2026-11-13_f1_devsmoke"
MODELS = sys.argv[1:] or ["ax4-light:q4_K_M", "qwen2.5:7b", "qwen3:4b-instruct-2507-q4_K_M"]
LABEL = "개발용 점검 — 정식 평가 아님(개발셋=mock, 작성자=개발팀)"
FIELDS = ["work_status", "closure_type", "barrier_cause", "consent.신청", "consent.문자", "consent.방문", "support_network",
          "isolation_signals"]


def get(f: F1ResultV2, k: str):
    if k.startswith("consent."):
        return getattr(f.consent, k.split(".")[1])
    return sorted(f.isolation_signals) if k == "isolation_signals" else getattr(f, k)


def score(households, preds):
    """preds[h][m] = (F1ResultV2, info)."""
    pairs = [(F1ResultV2.model_validate(m["f1"]), preds[i][j][0]) for i, h in enumerate(households)
             for j, m in enumerate(h["memos"])]
    infos = [x[1] for p in preds for x in p]
    agree = {k: round(sum(get(g, k) == get(p, k) for g, p in pairs) / len(pairs), 3) for k in FIELDS}
    rb_ok = 0
    for i, h in enumerate(households):
        gold = (h["repeated_barrier"] or {}).get("cause")
        rb = f1_cross.repeated_barrier([x[0] for x in preds[i]])
        rb_ok += (rb.cause if rb else None) == gold
    lat = [x["latency_s"] for x in infos if x.get("latency_s") is not None]
    prop = sum(x.get("quotes_proposed", 0) for x in infos)
    return {"n_memos": len(pairs), "n_households": len(households),
            "json_valid_first_try": round(sum(x.get("llm_ok", True) and x.get("attempts", 1) == 1 for x in infos) / len(infos), 3),
            "json_valid": round(sum(x.get("llm_ok", True) for x in infos) / len(infos), 3),
            "quotes_proposed": prop,
            "quote_verified_rate": round(sum(x.get("quotes_verified", 0) for x in infos) / prop, 3) if prop else None,
            "needs_check_rate": round(sum(p.needs_check for _, p in pairs) / len(pairs), 3),
            "agreement": agree, "repeated_barrier_agreement": round(rb_ok / len(households), 3),
            "latency_mean_s": round(st.mean(lat), 2) if lat else None, "latency_max_s": max(lat) if lat else None}


def main():
    hh = [c["household"] for c in json.loads(MOCK.read_text(encoding="utf-8"))["cases"]]
    result = {"label": LABEL, "dev_set": str(MOCK.relative_to(ROOT)), "reference": "mock 손라벨(f1_model=mock)",
              "prompt": "prototype/prompts/f1_memo.md", "options": ollama.OPTIONS, "run_at": time.strftime("%Y-%m-%d %H:%M"),
              "models": {}, "per_memo": {}}

    base = [[(f1_baseline.classify(m["text"]), {"latency_s": None}) for m in h["memos"]] for h in hh]
    result["models"][f1_baseline.MODEL] = {"info": {"model": f1_baseline.MODEL}, **score(hh, base)}
    result["per_memo"][f1_baseline.MODEL] = [[p.model_dump() for p, _ in x] for x in base]

    for model in MODELS:
        info = ollama.model_info(model)
        ollama._post("/api/generate", {"model": model, "prompt": "", "keep_alive": "10m"})  # 적재(지연 측정에서 제외)
        preds = []
        for h in hh:
            preds.append([f1_classify.classify(m["text"], model) for m in h["memos"]])
            print(model, h["id"], [p.closure_type for p, _ in preds[-1]], flush=True)
        ollama._post("/api/generate", {"model": model, "prompt": "", "keep_alive": 0})  # 8GB: 한 번에 한 모델
        result["models"][model] = {"info": info, **score(hh, preds)}
        result["per_memo"][model] = [[{"f1": p.model_dump(), "meta": i} for p, i in x] for x in preds]

    OUT.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    OUT.with_suffix(".md").write_text(render(result), encoding="utf-8")
    print(render(result))


def render(r) -> str:
    ms = r["models"]
    head = "| 지표 | " + " | ".join(ms) + " |\n|---|" + "---:|" * len(ms) + "\n"
    rows = [("JSON 유효(1회차)", "json_valid_first_try"), ("JSON 유효(재시도 포함)", "json_valid"),
            ("인용 원문 검증률", "quote_verified_rate"), ("판단보류·확인 필요율", "needs_check_rate")]
    body = "".join(f"| {n} | " + " | ".join(str(m[k]) for m in ms.values()) + " |\n" for n, k in rows)
    body += "".join(f"| 일치: {k} | " + " | ".join(str(m["agreement"][k]) for m in ms.values()) + " |\n" for k in FIELDS)
    body += "| 일치: 반복 장벽(가구) | " + " | ".join(str(m["repeated_barrier_agreement"]) for m in ms.values()) + " |\n"
    body += "| 평균 지연(초/메모) | " + " | ".join(str(m["latency_mean_s"]) for m in ms.values()) + " |\n"
    body += "| 최대 지연(초/메모) | " + " | ".join(str(m["latency_max_s"]) for m in ms.values()) + " |\n"
    ver = "\n".join(f"- `{k}`: " + ", ".join(f"{a}={b}" for a, b in v["info"].items() if a != "model") for k, v in ms.items())
    n = next(iter(ms.values()))
    return f"""# F1 개발용 점검 (2026-11-13)

> **{r['label']}**
> 기준 라벨은 UI 개발용 mock에 사람이 손으로 채운 값이며, 메모도 개발팀이 썼다. 프롬프트·기준선 규칙 작성자가
> 이 메모를 본 상태이므로 수치는 낙관적이다. 제안서 대표 수치로 쓰지 않는다(대표 수치는 사람 작성 시험셋).

- 개발셋: `{r['dev_set']}` — 메모 {n['n_memos']}건, 가구 {n['n_households']}곳
- 프롬프트: `{r['prompt']}` / 옵션: {r['options']} / 실행: {r['run_at']}
- 일치율: 메모별 mock 라벨과 값이 정확히 같은 비율(미확인끼리 같아도 일치). 고립 징후는 집합 일치.
- 인용 원문 검증률: 모델이 낸 인용 중 코드가 원문에서 찾은 비율(정확 일치 또는 공백 정규화). 못 찾은 인용의 항목은 미확인 처리.
- 프롬프트 r2: r1(`2026-11-13_f1_devsmoke_prompt-r1.md`)에서 종결인데 종결 사유를 '없음'으로 내는 오류가 많아
  "종결이면 A~D3 중 하나를 반드시 고른다" 규칙 한 줄을 더했다. 이 개발셋을 보고 고친 것이므로 이 표는 더 낙관적이다.
- 반복 장벽: 회차 메모 F1에 규칙(f1_cross, 같은 장벽 원인)을 적용한 결과가 mock 라벨과 같은 가구 비율.

{head}{body}
모델 정보:
{ver}
"""


if __name__ == "__main__":
    main()
