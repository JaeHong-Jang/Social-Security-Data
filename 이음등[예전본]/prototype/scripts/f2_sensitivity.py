"""F2 v2 가중치 민감도: 항목 가중치를 하나씩 ±5 바꿔 상위 5·10 겹침(Jaccard)과 전체 순위 Kendall tau-b를 본다.
입력은 가상 16가구 v3(F1 = 실제 LLM 출력)뿐이다(설계 시연). 결과: eval/results/2026-11-13_f2_sensitivity.{json,md}
사용: .venv/bin/python prototype/scripts/f2_sensitivity.py
"""
from f2_eval_common import LABEL, jaccard, kendall_tau_b, load, rank, save

from prototype.pipeline import f2_priority_v2 as f2

DELTA = 5
KS = (5, 10)


def main():
    hs = load()
    base = {h.id: f2.raw_total(h) for h in hs}
    base_rank = rank(base)
    rows = []
    for key in f2.WEIGHTS:
        for d in (-DELTA, DELTA):
            w = dict(f2.WEIGHTS, **{key: max(0, f2.WEIGHTS[key] + d)})
            s = {h.id: f2.raw_total(h, w) for h in hs}
            r = rank(s)
            rows.append({"key": key, "label": f2.LABELS[key], "delta": d, "weight": w[key],
                         **{f"top{k}_jaccard": jaccard(base_rank[:k], r[:k]) for k in KS},
                         **{f"top{k}_changed": sorted(set(base_rank[:k]) ^ set(r[:k])) for k in KS},
                         "kendall_tau_b": kendall_tau_b(base, s)})
    summary = {f"min_top{k}_jaccard": min(x[f"top{k}_jaccard"] for x in rows) for k in KS}
    summary["min_kendall_tau_b"] = min(x["kendall_tau_b"] for x in rows)
    summary["mean_kendall_tau_b"] = round(sum(x["kendall_tau_b"] for x in rows) / len(rows), 3)
    summary["top5_unchanged_runs"] = f"{sum(x['top5_jaccard'] == 1.0 for x in rows)}/{len(rows)}"
    payload = {"label": LABEL, "rule_version": f2.RULE_VERSION, "weights": f2.WEIGHTS, "delta": DELTA,
               "n_households": len(hs), "baseline_rank": base_rank, "baseline_total": base,
               "summary": summary, "runs": rows,
               "note": "v3(실제 F1) 기준 재계산(이전 판은 v2 손 라벨). 가중치는 가설이다. 이 표는 가상 16가구 위에서 순위가 가중치 하나에 얼마나 기대는지 보여주는 설계 점검일 뿐이다."}
    md = [f"# F2 v2 가중치 민감도 (2026-11-13)", "", f"> **{LABEL}**", "",
          f"- 규칙: rule_version {f2.RULE_VERSION}, 가중치(가설) {f2.WEIGHTS}",
          f"- 방법: 항목 가중치 1개씩 ±{DELTA} (다른 항목 고정, 합계는 100에서 벗어남), 반올림 전 가중합으로 순위",
          f"- 지표: 상위 5·10 Jaccard, 전체 16가구 Kendall tau-b (동점은 ID순)", "",
          "## 요약", "",
          f"- 상위 5 Jaccard 최소 {summary['min_top5_jaccard']}, 상위 5 그대로인 실행 {summary['top5_unchanged_runs']}",
          f"- 상위 10 Jaccard 최소 {summary['min_top10_jaccard']}",
          f"- Kendall tau-b 최소 {summary['min_kendall_tau_b']}, 평균 {summary['mean_kendall_tau_b']}", "",
          "## 실행별", "", "| 항목 | Δ | 가중치 | top5 J | top10 J | tau-b | top5 변동 가구 |", "|---|---:|---:|---:|---:|---:|---|"]
    for x in rows:
        md.append(f"| {x['key']} {x['label']} | {x['delta']:+d} | {x['weight']} | {x['top5_jaccard']} | "
                  f"{x['top10_jaccard']} | {x['kendall_tau_b']} | {', '.join(x['top5_changed']) or '-'} |")
    md += ["", f"기준 순위: {' > '.join(base_rank)}", "",
           "주의: v3(F1 = 실제 LLM 출력) 기준 재계산, 이전 판(v2 손 라벨)을 덮어씀. 가상 16가구에서 나온 수치라 제안서에는 \"설계 시연\"으로만 쓴다."]
    save("2026-11-13_f2_sensitivity", payload, "\n".join(md) + "\n")
    print(summary)


if __name__ == "__main__":
    main()
