"""F2 v2 ablation: F1 유래 항목(M 처리 확인 필요, B 반복 장벽, I의 메모 인용 부분)을 넣고 뺐을 때 순위·등급 비교.
입력은 가상 16가구 v3(F1 = 실제 LLM 출력)뿐이다(설계 시연). 결과: eval/results/2026-11-13_f2_ablation.{json,md}
사용: .venv/bin/python prototype/scripts/f2_ablation.py
"""
from f2_eval_common import LABEL, jaccard, kendall_tau_b, load, rank, save

from prototype.pipeline import f2_priority_v2 as f2

KS = (5, 10)


def level(total, flagged):
    lv = next(name for cut, name in f2.LEVELS if total >= cut)
    return "주의" if flagged and lv == "관찰" else lv


def main():
    hs = load()
    with_f1 = {h.id: f2.raw_total(h) for h in hs}
    without = {h.id: f2.raw_total(h, use_f1=False) for h in hs}
    rw, rn = rank(with_f1), rank(without)
    flagged = {h.id: bool(f2.parts(h)["M"].get("flag")) for h in hs}
    per = []
    for h in hs:
        lw, ln = level(round(with_f1[h.id]), flagged[h.id]), level(round(without[h.id]), False)
        per.append({"id": h.id, "total_with_f1": round(with_f1[h.id]), "total_without_f1": round(without[h.id]),
                    "rank_with_f1": rw.index(h.id) + 1, "rank_without_f1": rn.index(h.id) + 1,
                    "level_with_f1": lw, "level_without_f1": ln})
    per.sort(key=lambda x: x["rank_with_f1"])
    topk = {}
    for k in KS:
        a, b = set(rw[:k]), set(rn[:k])
        topk[f"top{k}"] = {"changed": len(a - b), "entered_with_f1": sorted(a - b), "left_with_f1": sorted(b - a),
                           "jaccard": jaccard(a, b)}
    level_changed = [x["id"] for x in per if x["level_with_f1"] != x["level_without_f1"]]
    payload = {"label": LABEL, "rule_version": f2.RULE_VERSION, "f1_items": list(f2.F1_KEYS),
               "n_households": len(hs), "kendall_tau_b": kendall_tau_b(with_f1, without),
               "topk": topk, "level_changed": level_changed, "households": per,
               "note": "v3(실제 F1) 기준 재계산(이전 판은 v2 손 라벨). without_f1 = M·B 0점, I는 1인가구(행정) 점수만, '처리 확인 필요' 플래그 없음."}
    md = ["# F2 v2 ablation: F1(메모 읽기) 유무 (2026-11-13)", "", f"> **{LABEL}**", "",
          "- F1 유래 항목: M 처리 확인 필요, B 반복 장벽, I 고립의 메모 인용 부분(관계망 부재·고립 징후)",
          "- 뺀 조건: M·B 0점, I는 1인가구(행정) 점수만, '처리 확인 필요' 등급 하한 없음",
          "- 순위는 점수 내림차순(동점 ID순). 등급은 점수 구간 + 플래그 하한으로 따로 계산", "",
          "## 요약", ""]
    for k in KS:
        t = topk[f"top{k}"]
        md.append(f"- 상위 {k} 중 {t['changed']}가구가 바뀜 (Jaccard {t['jaccard']}). "
                  f"F1로 들어온 가구: {', '.join(t['entered_with_f1']) or '-'} / 밀려난 가구: {', '.join(t['left_with_f1']) or '-'}")
    md += [f"- 등급이 바뀐 가구 {len(level_changed)}개: {', '.join(level_changed) or '-'}",
           f"- 전체 순위 Kendall tau-b {payload['kendall_tau_b']}", "",
           "## 가구별", "", "| 가구 | 점수(F1 포함) | 점수(F1 제외) | 순위 포함 | 순위 제외 | 등급 포함 | 등급 제외 |",
           "|---|---:|---:|---:|---:|---|---|"]
    for x in per:
        md.append(f"| {x['id']} | {x['total_with_f1']} | {x['total_without_f1']} | {x['rank_with_f1']} | "
                  f"{x['rank_without_f1']} | {x['level_with_f1']} | {x['level_without_f1']} |")
    md += ["", "주의: v3(F1 = 실제 LLM 출력, 손 수정 없음) 기준 재계산, 이전 판(v2 손 라벨)을 덮어씀. 가상 16가구는 F1 효과를 보여주도록 손으로 만든 가구다. 이 수치는 실제 효과 크기가 아니며 "
           "제안서에는 \"설계 시연\"으로만 쓴다."]
    save("2026-11-13_f2_ablation", payload, "\n".join(md) + "\n")
    print(payload["kendall_tau_b"], {k: v["changed"] for k, v in topk.items()}, level_changed)


if __name__ == "__main__":
    main()
