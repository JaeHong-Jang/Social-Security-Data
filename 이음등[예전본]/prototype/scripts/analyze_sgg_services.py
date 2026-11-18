"""B. 기초생활수급 가구 대비 시군구 자체 복지사업 수. 결과: eval/results/2026-11-13_sgg_services.json + PNG.
정의: 사업 수 = 목록(LcgvWelfarelist)에서 sggNm이 해당 시군구인 서비스 수(교육청·'-' 제외).
      분모 = CSV '기초생활보장(맞춤형급여)' 수급가구수 (2025-12). 지표 = 사업 수 / (수급가구수/1000).
"""
import json, re
from pathlib import Path
from collections import defaultdict
import numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "eval/results"
L = json.loads((ROOT / "data/cache/local_list_전국.json").read_text())["items"]
SEOUL = json.loads((ROOT / "data/cache/local_서울특별시.json").read_text())["items"]
CSV = pd.read_csv(ROOT / "data/raw/한국사회보장정보원_복지사업 시군구별 수급권자 현황_20251231.csv", encoding="cp949")
INC_RE = re.compile(r"중위\s*소득|소득\s*(인정액|기준|하위|상위|\s*\d)|\d{2,3}\s*%\s*(이하|미만)|기초생활|기초수급|차상위|저소득|수급자|수급권자|건강보험료")
MERGED = "전남광주통합특별시"  # API는 광주광역시+전라남도를 통합 명칭으로 반환
GU = re.compile(r"^(.+?시)\s*(.+구)$")


def norm_sido(s):
    return MERGED if s in ("광주광역시", "전라남도") else s


def norm_unit(name):  # CSV의 일반구(수원시장안구 등)를 시 단위로 합산. API sggNm은 시 단위.
    m = GU.match(name)
    return m.group(1) if m else name


def valid_sgg(v):
    return bool(v) and v != "-" and not v.endswith("교육청")


def main():
    base = CSV[CSV.사업명 == "기초생활보장(맞춤형급여)"].copy()
    base["sido"] = base.시도.map(norm_sido)
    base["unit"] = base.시군구.map(norm_unit)
    hh = base.groupby(["sido", "unit"], as_index=False).agg(수급가구수=("수급가구수", "sum"), 수급권자수=("수급권자수", "sum"), csv_rows=("시군구", list))
    cnt, low = defaultdict(int), defaultdict(int)
    nosgg = defaultdict(int)
    for it in L:
        if not valid_sgg(it.get("sggNm")):
            nosgg[it["ctpvNm"]] += 1
            continue
        k = (it["ctpvNm"], it["sggNm"])
        cnt[k] += 1
        if "저소득" in it.get("trgterIndvdlNmArray", ""):
            low[k] += 1
    # 서울 상세 기반 소득조건 본문 포함 사업 수 (구 자체)
    inc_txt = defaultdict(int)
    for it in SEOUL:
        if valid_sgg(it.get("sggNm")):
            d = it["detail"]
            if INC_RE.search(" ".join(d.get(k, "") for k in ("servDgst", "sprtTrgtCn", "slctCritCn"))):
                inc_txt[it["sggNm"]] += 1
    hh["services"] = [cnt.get((r.sido, r.unit), 0) for r in hh.itertuples()]
    hh["low_income_tag"] = [low.get((r.sido, r.unit), 0) for r in hh.itertuples()]
    hh["per_1000"] = (hh.services / (hh.수급가구수 / 1000)).round(2)
    matched = set(zip(hh.sido, hh.unit))
    unmatched_api = sorted(((k, v) for k, v in cnt.items() if k not in matched), key=lambda x: -x[1])
    out = {"generated": "2026-11-13", "denominator": "기초생활보장(맞춤형급여) 수급가구수, 2025-12", "metric": "자체 사업 수 / (수급가구수/1000)",
           "units_national": len(hh), "units_with_zero_services": int((hh.services == 0).sum()),
           "units_with_le3_services": int((hh.services <= 3).sum()),
           "api_sgg_services_matched": int(sum(v for k, v in cnt.items() if k in matched)),
           "api_sgg_services_unmatched": int(sum(v for k, v in cnt.items() if k not in matched)),
           "api_services_without_valid_sgg": dict(nosgg),
           "unmatched_api_units": [{"sido": k[0], "sgg": k[1], "n": v} for k, v in unmatched_api],
           "csv_units_without_api_match": [f"{r.sido} {r.unit}" for r in hh.itertuples() if r.services == 0]}
    # 서울
    sv = hh[hh.sido == "서울특별시"].copy()
    sv["income_text_services_seoul_detail"] = sv.unit.map(lambda u: inc_txt.get(u, 0))
    q1 = float(np.percentile(sv.services, 25))
    sv["risk_high"] = sv.services <= q1
    sv["rank_per_1000_desc"] = sv.per_1000.rank(ascending=False, method="min").astype(int)
    sv["rank_services_desc"] = sv.services.rank(ascending=False, method="min").astype(int)
    sv = sv.sort_values("per_1000", ascending=False)
    out["seoul"] = {"q1_services": q1, "risk_rule": "구 자체 사업 수가 서울 25개 구 하위 사분위(<=Q1)인 구",
                    "total_gu_services": int(sv.services.sum()), "seoul_services_without_gu": nosgg["서울특별시"],
                    "rows": json.loads(sv.drop(columns="csv_rows").rename(columns={"unit": "gu"}).to_json(orient="records", force_ascii=False))}
    nat = hh[hh.services >= 0].copy()
    q1n = float(np.percentile(nat.services, 25))
    out["national_q1_services"] = q1n
    out["national_lowest_per_1000"] = json.loads(nat.sort_values("per_1000").head(15).drop(columns="csv_rows").to_json(orient="records", force_ascii=False))
    out["national_by_sido"] = {s: {"units": int(len(g)), "median_services": float(g.services.median()), "median_per_1000": float(g.per_1000.median()), "zero": int((g.services == 0).sum())} for s, g in hh.groupby("sido")}
    RES.mkdir(parents=True, exist_ok=True)
    (RES / "2026-11-13_sgg_services.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    hh.drop(columns="csv_rows").to_csv(RES / "2026-11-13_sgg_services_national.csv", index=False, encoding="utf-8-sig")
    plot(sv)
    print({k: v for k, v in out.items() if k not in ("seoul", "national_lowest_per_1000", "national_by_sido", "csv_units_without_api_match", "unmatched_api_units")})
    print(sv[["unit", "수급가구수", "services", "per_1000", "low_income_tag", "income_text_services_seoul_detail", "risk_high"]].to_string())
    print(out["unmatched_api_units"]); print(out["csv_units_without_api_match"])


def plot(sv):
    for fp in Path.home().glob(".local/share/fonts/*KR*.ttf"):
        font_manager.fontManager.addfont(str(fp))
    for f in font_manager.fontManager.ttflist:
        if "Noto Sans KR" in f.name:
            plt.rcParams["font.family"] = f.name; break
    fig, ax = plt.subplots(figsize=(9, 6.5))
    d = sv.sort_values("per_1000")
    ax.barh(d.unit, d.per_1000, color=["#b5483a" if r else "#8aa4b5" for r in d.risk_high])
    for y, (v, n) in enumerate(zip(d.per_1000, d.services)):
        ax.text(v + .15, y, f"{v:.1f} ({n}건)", va="center", fontsize=8)
    ax.set_xlabel("기초생활 수급 1,000가구당 구 자체 복지사업 수 (괄호 안은 사업 수)")
    ax.set_title("서울 25개 구: 수급가구 대비 자체 복지사업 수 (붉은색 = 사업 수 하위 25%)", fontsize=11)
    ax.set_xlim(0, d.per_1000.max() * 1.2)
    fig.tight_layout(); fig.savefig(RES / "2026-11-13_sgg_services_seoul.png", dpi=150)


if __name__ == "__main__":
    main()
