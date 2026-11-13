"""F3 조건 대조 — 규칙 부분(태그 검색 비교, 확인 항목 집계). 후보 선정·조건 추출 LLM 부분은 아직 없다(Ollama 미설치).

태그 검색 기준선(found_by_tag_filter): 담당자가 복지 메타데이터 태그로 사업을 고르는 방식을 단순하게 흉내 낸다.
- 가구 태그: 현재 위기영역 → 관심주제, 가구형태 → 대상특성, 1인가구 → 보호·돌봄, 위기가구 공통 → 안전·위기.
- 생애주기 태그(lifeNmArray)는 연령 기반이라 쓰지 않는다(연령은 입력에 없다).
- '저소득' 대상특성은 종결 시점에 소득이 확인되지 않으므로 쓰지 않는다.
- 사업의 관심주제 또는 대상특성 태그가 가구 태그와 하나라도 겹치면 '태그 검색으로 찾힘'.
매핑은 가설이며, 태그 품질 진단(과제 2)의 기준선으로 쓴다.
"""
from prototype.api.schemas_v2 import ChecksNarrowed, HouseholdV2

DOMAIN_THEMES = {"생계": "생활지원", "주거": "주거", "공공요금": "생활지원", "건강": "신체건강", "금융": "서민금융"}
TYPE_TARGETS = {"한부모가구": "한부모·조손", "조손가구": "한부모·조손"}


def household_tags(h: HouseholdV2) -> dict[str, list[str]]:
    themes = {"안전·위기"} | {DOMAIN_THEMES[d] for d in h.discoveries[-1].crisis_domains}
    if h.household_type == "1인가구":
        themes.add("보호·돌봄")
    targets = {TYPE_TARGETS[h.household_type]} if h.household_type in TYPE_TARGETS else set()
    return {"themes": sorted(themes), "targets": sorted(targets)}


def _split(v: str | None) -> set[str]:
    return {x.strip() for x in (v or "").split(",") if x.strip()}


def found_by_tag_filter(tags: dict[str, list[str]], service: dict) -> bool:
    """service: 캐시 items[] 원소(목록 API 필드 intrsThemaNmArray·trgterIndvdlNmArray 사용)."""
    return bool(set(tags["themes"]) & _split(service.get("intrsThemaNmArray"))
                or set(tags["targets"]) & _split(service.get("trgterIndvdlNmArray")))


def checks_narrowed(candidates: list[dict]) -> ChecksNarrowed:
    st = [c["status"] for cand in candidates for c in cand["checks"]]
    n = {k: st.count(k) for k in ("충족", "미충족", "확인필요")}
    summary = f"확인 필요 {n['확인필요']}개" + (f" (조건 {len(st)}개 중 {n['충족']}개 충족)" if st else " (후보 없음)")
    return ChecksNarrowed(total=len(st), summary=summary, **n)
