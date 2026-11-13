"""A. 전국 지자체 복지서비스 목록 메타데이터 품질 진단 (시도별). 결과: eval/results/2026-11-13_metadata_quality.json + PNG.
입력: data/cache/local_list_전국.json (목록), data/cache/local_서울특별시.json (서울 상세 397건)
"""
import json, re, sys
from pathlib import Path
from collections import defaultdict
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = Path(__file__).resolve().parents[2]
SRC = json.loads((ROOT / "data/cache/local_list_전국.json").read_text())
SEOUL = json.loads((ROOT / "data/cache/local_서울특별시.json").read_text())["items"]
RES = ROOT / "eval/results"

# 금융 관련어(명시 목록). 서비스명+요약에 하나도 없으면 '서민금융' 태그 불일치 후보.
FIN = ["대출", "융자", "금융", "신용", "채무", "부채", "이자", "이차보전", "보증", "햇살론", "저축", "적금", "통장",
       "자산형성", "연체", "파산", "회생", "학자금", "창업자금", "자금", "상환", "대부", "근로자 생활안정", "생활안정자금"]
FIN_RE = re.compile("|".join(map(re.escape, FIN)))
# 연령/소득 조건 정규식 (본문 텍스트 기반 추정)
AGE_RE = re.compile(r"(만\s*)?\d{1,3}\s*세\s*(이상|이하|미만|초과|까지)|\d{1,3}\s*[~\-～]\s*\d{1,3}\s*세|\d{1,3}\s*세\s*[~\-～]|(19|20)\d{2}\s*[.년]\s*\d{1,2}\s*[.월]\s*\d{1,2}\s*[.일]?\s*(이후|이전|생)")
INC_RE = re.compile(r"중위\s*소득|소득\s*(인정액|기준|하위|상위|\s*\d)|\d{2,3}\s*%\s*(이하|미만)|기초생활|기초수급|차상위|저소득|수급자|수급권자|건강보험료")
PLACEHOLDER = lambda v: (v or "").strip()


def tags(s):
    return [t.strip() for t in (s or "").split(",") if t.strip()]


def feats(it, text):
    th, lf, tg = tags(it.get("intrsThemaNmArray")), tags(it.get("lifeNmArray")), tags(it.get("trgterIndvdlNmArray"))
    nm_sum = (it.get("servNm", "") + " " + it.get("servDgst", ""))
    return dict(
        fin_tag="서민금융" in th, theme_empty=not th, life_empty=not lf, target_empty=not tg,
        fin_nomatch=("서민금융" in th) and not FIN_RE.search(nm_sum),
        age_txt=bool(AGE_RE.search(text)), age_txt_notag=bool(AGE_RE.search(text)) and not lf,
        inc_txt=bool(INC_RE.search(text)), inc_txt_notag=bool(INC_RE.search(text)) and not any("저소득" in t for t in tg),
    )


def agg(rows):
    n = len(rows)
    s = defaultdict(int)
    for r in rows:
        for k, v in r.items():
            s[k] += v
    pct = lambda a, b: round(100 * a / b, 1) if b else None
    return dict(n=n, fin_tag=s["fin_tag"], fin_tag_pct=pct(s["fin_tag"], n),
                fin_tag_pct_of_tagged=pct(s["fin_tag"], n - s["theme_empty"]),
                theme_empty=s["theme_empty"], theme_empty_pct=pct(s["theme_empty"], n),
                life_empty=s["life_empty"], life_empty_pct=pct(s["life_empty"], n),
                target_empty=s["target_empty"], target_empty_pct=pct(s["target_empty"], n),
                fin_nomatch=s["fin_nomatch"], fin_nomatch_pct_of_fintag=pct(s["fin_nomatch"], s["fin_tag"]), fin_nomatch_pct_of_all=pct(s["fin_nomatch"], n),
                age_txt=s["age_txt"], age_txt_notag=s["age_txt_notag"], age_txt_notag_pct=pct(s["age_txt_notag"], n),
                inc_txt=s["inc_txt"], inc_txt_notag=s["inc_txt_notag"], inc_txt_notag_pct=pct(s["inc_txt_notag"], n))


def main():
    assert SRC["complete"], "목록 수집이 완료되지 않았다"
    items = SRC["items"]
    ids = [i["servId"] for i in items]
    assert len(ids) == len(set(ids)), "servId 중복"
    by = defaultdict(list)
    for it in items:
        by[it["ctpvNm"]].append(feats(it, it.get("servDgst", "")))
    out = {"generated": "2026-11-13", "source": "LcgvWelfarelist 목록 (servDgst=요약 기준)",
           "fetched_at": SRC.get("saved_at"), "total": len(items), "totals_api": SRC["totals"],
           "finance_words": FIN, "age_regex": AGE_RE.pattern, "income_regex": INC_RE.pattern}
    out["by_sido"] = {k: agg(v) for k, v in sorted(by.items(), key=lambda kv: -len(kv[1]))}
    out["national"] = agg([r for v in by.values() for r in v])
    # 서울 상세 vs 목록 (같은 397건)
    out["seoul_list_based"] = out["by_sido"]["서울특별시"]
    rows = [feats(it, " ".join([it["detail"].get(k, "") for k in ("servDgst", "sprtTrgtCn", "slctCritCn")])) for it in SEOUL]
    out["seoul_detail_based"] = agg(rows)
    out["seoul_detail_based"]["note"] = "텍스트=요약+지원대상+선정기준. 본 정규식 결과는 기획서 §5.2의 149/116과 정의가 달라 값이 다를 수 있다."
    # 불일치 예시 (전국 '서민금융' 태그인데 금융어 없음), 시도별 최대 2건 + 전국 상위 15건
    ex = []
    for it in items:
        if "서민금융" in tags(it.get("intrsThemaNmArray")) and not FIN_RE.search(it["servNm"] + " " + it.get("servDgst", "")):
            ex.append({"ctpvNm": it["ctpvNm"], "sggNm": it.get("sggNm", ""), "servNm": it["servNm"], "servDgst": it.get("servDgst", "")[:80], "tags": it.get("intrsThemaNmArray")})
    seen, exs = set(), []
    for e in [e for e in ex if e["ctpvNm"] == "서울특별시"][:5] + ex[::max(1, len(ex)//15)][:15]:
        if e["servNm"] not in seen:
            seen.add(e["servNm"]); exs.append(e)
    out["fin_mismatch_examples"] = exs
    # 태그 어휘
    from collections import Counter
    out["theme_vocab"] = Counter(t for it in items for t in tags(it.get("intrsThemaNmArray"))).most_common()
    out["life_vocab"] = Counter(t for it in items for t in tags(it.get("lifeNmArray"))).most_common()
    out["target_vocab"] = Counter(t for it in items for t in tags(it.get("trgterIndvdlNmArray"))).most_common()
    RES.mkdir(parents=True, exist_ok=True)
    (RES / "2026-11-13_metadata_quality.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    plot(out)
    for k, v in out["by_sido"].items():
        print(k, v["n"], v["fin_tag_pct"], v["life_empty_pct"], v["target_empty_pct"], v["fin_nomatch_pct_of_fintag"], v["age_txt_notag_pct"], v["inc_txt_notag_pct"])
    print("전국", out["national"]); print("서울상세", out["seoul_detail_based"])


def plot(out):
    for fp in Path.home().glob(".local/share/fonts/*KR*.ttf"):
        font_manager.fontManager.addfont(str(fp))
    for f in font_manager.fontManager.ttflist:
        if any(k in f.name for k in ("Malgun", "NanumGothic", "Noto Sans CJK KR", "Noto Sans KR", "AppleGothic")):
            plt.rcParams["font.family"] = f.name; break
    plt.rcParams["axes.unicode_minus"] = False
    names = [k for k in out["by_sido"]]
    names.sort(key=lambda k: out["by_sido"][k]["fin_tag_pct"])
    fig, ax = plt.subplots(figsize=(9, 6))
    for lab, key, c in (("서민금융 태그 비율", "fin_tag_pct", "#b5483a"), ("생애주기 칸 비어 있음", "life_empty_pct", "#3b6e8f")):
        ax.plot([out["by_sido"][k][key] for k in names], names, "o", label=lab, color=c)
    ax.set_xlabel("해당 시도 서비스 중 비율 (%)"); ax.grid(axis="x", alpha=.3); ax.legend(loc="lower right")
    ax.set_title("시도별 복지서비스 목록 메타데이터 품질 (전국 %d건, 2026-11-13 조회)" % out["total"], fontsize=11)
    fig.tight_layout(); fig.savefig(RES / "2026-11-13_metadata_quality_by_sido.png", dpi=150)


if __name__ == "__main__":
    main()
