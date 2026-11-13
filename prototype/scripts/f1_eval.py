"""F1 시험셋 평가 — 사람이 쓴 메모(eval/testset/테스트메모_양식.csv)로 F1 모델과 키워드 기준선을 잰다.

- 열은 CSV 머리줄에서 읽는다. '[정답]'으로 시작하는 열이 정답이다.
- **정답 칸이 하나라도 비어 있으면 실행하지 않는다.** 라벨은 실행 전에 확정한다. 실행 시점의 CSV sha256을 결과에 남긴다.
- 정답 값이 아래 표기(ALIASES)로 읽히지 않으면 실행하지 않고 그 값을 알려 준다(라벨을 고친 뒤 다시 실행).
- 지표: 항목별 정확도·macro-F1, 판단보류율, 인용 원문 검증률, 혼동행렬, 반복 장벽(가구ID별, n/쌍), 오류 사례.
- 모델은 거부 가드(refusal_guard, '거부는 코드가 지킨다') 적용/미적용 두 가지로 따로 보고한다. LLM 호출은 한 번이다.
- 결과: eval/results/<날짜>_f1_testset_<모델>.{json,md}

사용: .venv/bin/python -m prototype.scripts.f1_eval qwen3:4b-instruct-2507-q4_K_M [--csv 경로] [--out-dir 폴더]
이 스크립트는 프롬프트·규칙 튜닝에 쓰지 않는다. 시험셋은 측정에만 쓴다(CLAUDE.md 규칙 6).
"""
import argparse
import csv
import hashlib
import json
import re
import statistics as st
import sys
import time
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from prototype.api.schemas_v2 import F1ResultV2
from prototype.llm import ollama
from prototype.pipeline import f1_baseline, f1_classify, f1_cross

ROOT = Path(__file__).resolve().parents[2]
CSV = ROOT / "eval/testset/테스트메모_양식.csv"
OUT_DIR = ROOT / "eval/results"
SIGNALS = ("우편물 적체", "반복 부재", "단전", "단수", "기타")
CAUSES = f1_cross.CAUSES  # 반복 장벽으로 세는 원인

# 정답 표기 → 표준값. 여기 없는 값이 나오면 실행을 멈춘다.
ALIASES = {
    "work_status": {"조사중": "조사중", "종결": "종결", "판단보류": "판단보류"},
    "closure_type": {**{c: c for c in ("A", "B", "C", "D1", "D2", "D3")},
                     "없음": "없음", "해당없음": "없음", "-": "없음"},
    "barrier_cause": {"서류·절차": "서류·절차", "서류": "서류·절차", "절차": "서류·절차", "서류절차": "서류·절차",
                      "서류·절차부담": "서류·절차", "건강": "건강", "시간·생계": "시간·생계", "시간": "시간·생계",
                      "생계": "시간·생계", "시간생계": "시간·생계", "기타": "기타", "해당없음": "해당없음",
                      "없음": "해당없음", "-": "해당없음", "미확인": "미확인"},
    "신청": {"동의": "동의", "거부": "거부", "보류(장벽)": "보류(장벽)", "보류": "보류(장벽)", "미확인": "미확인"},
    "문자": {"동의": "동의", "거부": "거부", "미확인": "미확인"},
    "방문": {"동의": "동의", "거부": "거부", "미확인": "미확인"},
}
# 관계망부재 열: 값이 있음/부재/미확인뿐이면 3값(support_network)으로, 예/아니오류면 '부재 여부' 2값으로 잰다.
NET3 = {"있음", "부재", "미확인"}
NET2 = {"부재": True, "예": True, "y": True, "yes": True, "o": True, "1": True, "true": True,
        "아니오": False, "아니요": False, "n": False, "no": False, "x": False, "0": False, "false": False}
SIG_ALIASES = {"우편물적체": "우편물 적체", "우편물": "우편물 적체", "고지서적체": "우편물 적체", "반복부재": "반복 부재",
               "단전": "단전", "단수": "단수", "기타": "기타"}
EMPTY_SET = {"없음", "해당없음", "-", "[]"}
GOLD_COLS = {"[정답]업무상태": "work_status", "[정답]종결유형": "closure_type", "[정답]장벽원인": "barrier_cause",
             "[정답]신청": "신청", "[정답]문자": "문자", "[정답]방문": "방문", "[정답]관계망부재": "network",
             "[정답]고립징후": "isolation"}
FIELDS = ["work_status", "closure_type", "barrier_cause", "신청", "문자", "방문", "network", "isolation"]


class LabelError(ValueError):
    """정답이 비었거나 읽을 수 없어 평가를 시작하지 않는다."""


def _norm(v: str) -> str:
    return re.sub(r"\s+", "", v.strip()).replace("ㆍ", "·").replace("・", "·").replace("/", "·")


def load(path: Path) -> tuple[list[dict], dict]:
    """CSV → 표준화한 행 목록. 정답 칸이 비었거나 표기를 못 읽으면 LabelError."""
    raw = path.read_bytes()
    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    header = list(rows[0].keys()) if rows else []
    gold_cols = [c for c in header if c.startswith("[정답]")]
    missing = [c for c in ("메모ID", "가구ID", "메모") if c not in header]
    unknown_cols = [c for c in gold_cols if c not in GOLD_COLS]
    if missing or not gold_cols:
        raise LabelError(f"필수 열이 없다: {missing or '[정답] 열'}")
    empty = [(r["메모ID"] or f"{i + 2}행", c) for i, r in enumerate(rows) for c in gold_cols + ["메모"]
             if not (r.get(c) or "").strip()]
    if empty:
        raise LabelError(f"정답(또는 메모) 칸이 비어 있어 실행하지 않는다. 라벨을 먼저 확정하라: {empty[:20]}"
                         + (f" 외 {len(empty) - 20}칸" if len(empty) > 20 else ""))
    net_col = "[정답]관계망부재" in gold_cols
    net_vals = {_norm(r["[정답]관계망부재"]) for r in rows} if net_col else set()
    net_mode = "3값" if net_vals <= NET3 else "2값"
    bad, out = [], []
    for r in rows:
        g = {}
        for col in gold_cols:
            if col not in GOLD_COLS:
                continue
            f, v = GOLD_COLS[col], r[col]
            if f == "network":
                n = _norm(v)
                g[f] = n if net_mode == "3값" else NET2.get(n.lower())
                if g[f] is None:
                    bad.append((r["메모ID"], col, v))
            elif f == "isolation":
                toks = [_norm(t) for t in re.split(r"[,;|/·]", v) if t.strip()]
                if all(t in EMPTY_SET for t in toks):
                    g[f] = []
                else:
                    vals = [SIG_ALIASES.get(t) for t in toks if t not in EMPTY_SET]
                    if None in vals:
                        bad.append((r["메모ID"], col, v))
                    g[f] = sorted({x for x in vals if x})
            else:
                n = _norm(v)
                if f == "closure_type":
                    m = re.match(r"(D[123]|[ABC])(?![0-9])", n.upper())
                    n = m.group(1) if m else n
                g[f] = ALIASES[f].get(n)
                if g[f] is None:
                    bad.append((r["메모ID"], col, v))
        out.append({"memo_id": r["메모ID"], "household_id": r["가구ID"], "date": (r.get("상담일") or "").strip(),
                    "consult_type": (r.get("상담방식") or "").strip(), "text": r["메모"].strip(), "gold": g})
    if bad:
        raise LabelError(f"정답 표기를 읽을 수 없다(ALIASES에 없음). 라벨을 고친 뒤 다시 실행하라: {bad[:20]}")
    return out, {"sha256": hashlib.sha256(raw).hexdigest(), "header": header, "gold_columns": gold_cols,
                 "unevaluated_columns": unknown_cols, "network_mode": net_mode if net_col else None}


def pred_value(f: F1ResultV2, field: str, net_mode: str | None):
    if field == "closure_type":
        return f.closure_type or "없음"
    if field in ("신청", "문자", "방문"):
        return getattr(f.consent, field)
    if field == "network":
        return f.support_network if net_mode == "3값" else f.support_network == "부재"
    if field == "isolation":
        return sorted(f.isolation_signals)
    return getattr(f, field)


def macro_f1(gold: list, pred: list) -> float | None:
    labels = sorted(set(map(str, gold)) | set(map(str, pred)))
    if not labels:
        return None
    fs = []
    for lab in labels:
        tp = sum(str(g) == lab and str(p) == lab for g, p in zip(gold, pred))
        fp = sum(str(g) != lab and str(p) == lab for g, p in zip(gold, pred))
        fn = sum(str(g) == lab and str(p) != lab for g, p in zip(gold, pred))
        fs.append(2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 1.0)
    return round(sum(fs) / len(fs), 3)


def set_macro_f1(gold: list[list], pred: list[list]) -> float | None:
    """고립 징후(다중 라벨): 징후별 F1의 평균(정답·예측 어디에도 없는 징후는 뺀다)."""
    fs = []
    for s in SIGNALS:
        tp = sum(s in g and s in p for g, p in zip(gold, pred))
        fp = sum(s not in g and s in p for g, p in zip(gold, pred))
        fn = sum(s in g and s not in p for g, p in zip(gold, pred))
        if tp + fp + fn:
            fs.append(2 * tp / (2 * tp + fp + fn))
    return round(sum(fs) / len(fs), 3) if fs else None


def confusion(gold: list, pred: list) -> dict:
    m = defaultdict(Counter)
    for g, p in zip(gold, pred):
        m[str(g)][str(p)] += 1
    return {g: dict(c) for g, c in sorted(m.items())}


def _order_key(r):
    d = re.sub(r"[./]", "-", r["date"])
    try:
        return date.fromisoformat(d).isoformat(), r["memo_id"]
    except ValueError:
        return "", r["memo_id"]


def repeated(rows, preds) -> dict:
    """가구ID별(메모 2건 이상): 정답 반복 원인(같은 원인 2건 이상) vs f1_cross 예측."""
    by = defaultdict(list)
    for r, p in zip(rows, preds):
        by[r["household_id"]].append((r, p))
    out = {"households": 0, "gold_positive": 0, "detected": 0, "false_positive": 0, "wrong_cause": 0, "per_household": []}
    for hid, items in sorted(by.items()):
        if len(items) < 2:
            continue
        items.sort(key=lambda x: _order_key(x[0]))
        cnt = Counter(r["gold"].get("barrier_cause") for r, _ in items)
        gold = sorted(c for c in CAUSES if cnt[c] >= 2)
        rb = f1_cross.repeated_barrier([p for _, p in items])
        pc = rb.cause if rb else None
        out["households"] += 1
        if gold:
            out["gold_positive"] += 1
            out["detected"] += pc in gold
            out["wrong_cause"] += pc is not None and pc not in gold
        elif pc:
            out["false_positive"] += 1
        out["per_household"].append({"household_id": hid, "memo_ids": [r["memo_id"] for r, _ in items],
                                     "gold_causes": gold, "pred_cause": pc,
                                     "pred_summary": rb.summary if rb else None,
                                     "pred_quotes": [q.quote for q in rb.quotes] if rb else []})
    out["detected_str"] = f"{out['detected']}/{out['gold_positive']}"
    return out


def evaluate(rows, preds, infos, net_mode) -> dict:
    res = {"n": len(rows), "fields": {}}
    for f in FIELDS:
        if f not in rows[0]["gold"]:
            continue
        g = [r["gold"][f] for r in rows]
        p = [pred_value(x, f, net_mode) for x in preds]
        acc = round(sum(a == b for a, b in zip(g, p)) / len(g), 3)
        res["fields"][f] = {"accuracy": acc,
                            "macro_f1": set_macro_f1(g, p) if f == "isolation" else macro_f1(g, p),
                            "confusion": None if f == "isolation" else confusion(g, p)}
    res["pending_rate"] = round(sum(x.work_status == "판단보류" for x in preds) / len(preds), 3)
    res["needs_check_rate"] = round(sum(x.needs_check for x in preds) / len(preds), 3)
    prop = sum(i.get("quotes_proposed", 0) for i in infos)
    res["quotes_proposed"] = prop
    res["quote_verified_rate"] = round(sum(i.get("quotes_verified", 0) for i in infos) / prop, 3) if prop else None
    res["llm_failures"] = sum(i.get("llm_ok") is False for i in infos)
    lat = [i["latency_s"] for i in infos if i.get("latency_s") is not None]
    res["latency_mean_s"] = round(st.mean(lat), 2) if lat else None
    res["latency_max_s"] = max(lat) if lat else None
    res["repeated_barrier"] = repeated(rows, preds)
    errs = []
    for r, x in zip(rows, preds):
        wrong = {f: {"gold": r["gold"][f], "pred": pred_value(x, f, net_mode)} for f in res["fields"]
                 if r["gold"][f] != pred_value(x, f, net_mode)}
        if wrong:
            errs.append({"memo_id": r["memo_id"], "household_id": r["household_id"], "text": r["text"],
                         "wrong": wrong, "evidence": [(e.field, e.quote) for e in x.evidence],
                         "needs_check_reason": x.needs_check_reason})
    res["n_error_memos"] = len(errs)
    res["errors"] = errs
    return res


def run(csv_path: Path, model: str, out_dir: Path, day: str, classify=None, model_info=None) -> dict:
    rows, src = load(csv_path)  # 정답 확인이 끝나기 전에는 모델을 부르지 않는다
    classify = classify or f1_classify.classify
    base = [f1_baseline.classify(r["text"]) for r in rows]
    outs = [classify(r["text"], model) for r in rows]
    preds, infos = [p for p, _ in outs], [i for _, i in outs]
    unguarded = [i.get("unguarded", p) for p, i in outs]  # 가드 전 결과
    result = {
        "label": "F1 시험셋 평가 — 사람이 쓴 메모, 정답은 실행 전 확정(csv sha256 기록)",
        "csv": str(csv_path.relative_to(ROOT)) if csv_path.is_relative_to(ROOT) else str(csv_path),
        "csv_sha256": src["sha256"], "gold_columns": src["gold_columns"],
        "unevaluated_columns": src["unevaluated_columns"], "network_mode": src["network_mode"],
        "run_at": time.strftime("%Y-%m-%d %H:%M"), "model": model, "model_info": model_info,
        "prompt": f1_classify.PROMPT_FILE, "prompt_version": f1_classify.PROMPT_VERSION, "options": ollama.OPTIONS,
        "baseline": f1_baseline.MODEL, "n_memos": len(rows), "n_households": len({r["household_id"] for r in rows}),
        "gold_distribution": {f: dict(Counter(str(r["gold"][f]) for r in rows)) for f in rows[0]["gold"]},
        "consent_guard_memos": sum(bool(i.get("consent_guard")) for i in infos),
        "systems": {model: evaluate(rows, preds, infos, src["network_mode"]),
                    f"{model} (거부 가드 없음)": evaluate(rows, unguarded, infos, src["network_mode"]),
                    f1_baseline.MODEL: evaluate(rows, base, [{} for _ in base], src["network_mode"])},
        "per_memo": [{"memo_id": r["memo_id"], "gold": r["gold"], "model": p.model_dump(), "model_meta":
                      {k: v for k, v in i.items() if k not in ("raw", "unguarded")}, "baseline": b.model_dump()}
                     for r, p, i, b in zip(rows, preds, infos, base)],
    }
    slug = re.sub(r"[^0-9A-Za-z._-]+", "-", model)
    stem = out_dir / f"{day}_f1_testset_{slug}"
    out_dir.mkdir(parents=True, exist_ok=True)
    stem.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    stem.with_suffix(".md").write_text(render(result), encoding="utf-8")
    result["_paths"] = [str(stem.with_suffix(".json")), str(stem.with_suffix(".md"))]
    return result


def _fmt(v):
    return "—" if v is None else str(v)


def render(r) -> str:
    ss = r["systems"]
    names = list(ss)
    head = "| 지표 | " + " | ".join(f"`{n}`" for n in names) + " |\n|---|" + "---:|" * len(names) + "\n"
    rows = []
    for f in next(iter(ss.values()))["fields"]:
        rows.append((f"{f} 정확도", [s["fields"][f]["accuracy"] for s in ss.values()]))
        rows.append((f"{f} macro-F1", [s["fields"][f]["macro_f1"] for s in ss.values()]))
    rows += [("판단보류율", [s["pending_rate"] for s in ss.values()]),
             ("확인 필요율", [s["needs_check_rate"] for s in ss.values()]),
             ("인용 원문 검증률", [s["quote_verified_rate"] for s in ss.values()]),
             ("LLM 실패(판단보류 대체)", [s["llm_failures"] for s in ss.values()]),
             ("반복 장벽 검출(n/정답 가구)", [s["repeated_barrier"]["detected_str"] for s in ss.values()]),
             ("반복 장벽 오검출(가구)", [s["repeated_barrier"]["false_positive"] for s in ss.values()]),
             ("반복 장벽 원인 틀림(가구)", [s["repeated_barrier"]["wrong_cause"] for s in ss.values()]),
             ("평균 지연(초/메모)", [s["latency_mean_s"] for s in ss.values()]),
             ("오류 메모 수", [s["n_error_memos"] for s in ss.values()])]
    body = "".join(f"| {n} | " + " | ".join(_fmt(v) for v in vs) + " |\n" for n, vs in rows)
    m = ss[r["model"]]
    conf = ""
    for f in ("work_status", "closure_type", "barrier_cause"):
        c = m["fields"].get(f, {}).get("confusion")
        if not c:
            continue
        cols = sorted({p for row in c.values() for p in row})
        conf += f"\n**{f}** (행=정답, 열=예측)\n\n| 정답＼예측 | " + " | ".join(cols) + " |\n|---|" + "---:|" * len(cols) + "\n"
        conf += "".join(f"| {g} | " + " | ".join(str(row.get(p, 0)) for p in cols) + " |\n" for g, row in c.items())
    rb = "".join(f"- {h['household_id']} ({', '.join(h['memo_ids'])}): 정답 {h['gold_causes'] or '없음'} / "
                 f"예측 {h['pred_cause'] or '없음'}\n" for h in m["repeated_barrier"]["per_household"])
    err = ""
    for e in m["errors"][:10]:
        w = "; ".join(f"{k}: 정답 {v['gold']} → 예측 {v['pred']}" for k, v in e["wrong"].items())
        err += f"- **{e['memo_id']}** ({e['household_id']}) {w}\n  - 메모: {e['text']}\n"
    mi = r["model_info"] or {}
    rb = rb or "- 메모 2건 이상인 가구 없음\n"
    err = err or "- 없음\n"
    return f"""# F1 시험셋 평가 — `{r['model']}` vs 키워드 기준선

> {r['label']}

- 시험셋: `{r['csv']}` (sha256 `{r['csv_sha256'][:16]}…`) — 메모 {r['n_memos']}건, 가구 {r['n_households']}곳
- 모델: `{r['model']}` digest `{mi.get('digest')}` / Ollama {mi.get('ollama_version')} / {mi.get('quantization')}
- 프롬프트: `{r['prompt']}` ({r['prompt_version']}) / 옵션 {r['options']} / 실행 {r['run_at']}
- 기준선: `{r['baseline']}` (정규식, LLM 없음)
- 거부 가드: 모델 열은 가드 적용, '(거부 가드 없음)' 열은 같은 LLM 출력에 가드를 빼고 잰 값. 가드가 값을 바꾼 메모 {r['consent_guard_memos']}건
- 관계망부재 채점 방식: {r['network_mode']} / 평가하지 않은 정답 열: {r['unevaluated_columns'] or '없음'}
- macro-F1: 정답·예측에 나온 값별 F1의 평균. 고립 징후는 징후별 F1 평균, 정확도는 집합 일치.
- 반복 장벽: 가구ID별 메모 2건 이상에서, 정답 장벽원인이 같은 값(서류·절차·건강·시간·생계)으로 2건 이상이면 정답 양성.
  예측은 f1_cross 규칙(같은 원인 + 메모별 원문 인용). 검출 = 예측 원인이 정답 원인과 같음.

{head}{body}
## 혼동행렬 (`{r['model']}`)
{conf}
## 반복 장벽 (가구별)
{rb}
## 오류 사례 (`{r['model']}`, 최대 10건 / 전체 {m['n_error_memos']}건은 json)
{err}"""


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("model")
    ap.add_argument("--csv", type=Path, default=CSV)
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR)
    ap.add_argument("--date", default=date.today().isoformat())
    a = ap.parse_args(argv)
    try:
        load(a.csv)
    except LabelError as e:
        sys.exit(f"[실행 거부] {e}")
    info = ollama.model_info(a.model)
    ollama._post("/api/generate", {"model": a.model, "prompt": "", "keep_alive": "10m"})  # 적재(지연에서 제외)
    try:
        r = run(a.csv, a.model, a.out_dir, a.date, model_info=info)
    finally:
        ollama._post("/api/generate", {"model": a.model, "prompt": "", "keep_alive": 0})
    print("\n".join(r["_paths"]))
    print(render(r).split("## 혼동행렬")[0])


if __name__ == "__main__":
    main()
