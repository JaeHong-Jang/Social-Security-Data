"""F2 재검토 우선순위 — 규칙 코드만으로 계산한다 (기획 §6.4, 초기 가설 규칙).

score()의 입력은 Household 하나뿐이다. 성별·연령·국적은 Household에 없으므로 받을 수 없다.
score()는 연락 의사(consent)·연락 거부를 읽지 않는다(점수와 분리).

rule_version "v1" 등급 기준: 긴급 ≥70, 주의 40~69, 관찰 <40.
"""
from prototype.api.schemas import Consent, F2Item, F2Result, Household

RULE_VERSION = "v1"
LEVELS = [(70, "긴급"), (40, "주의"), (0, "관찰")]


def score(h: Household) -> F2Result:
    disc = h.discoveries
    n = len(disc)
    cur = disc[-1]
    items = []

    r = 0 if n == 1 else 15 if n == 2 else 25
    items.append(F2Item(key="R", label="반복 발굴", points=r, max=25,
                        chip=f"{n}회째 발굴" if n > 1 else "첫 발굴",
                        reason=f"관찰기간 내 {n}회 발굴되었습니다." if n > 1 else "이번이 첫 발굴입니다."))

    k = len(cur.crisis_domains)
    items.append(F2Item(key="C", label="현재 위기영역", points=min(k * 5, 20), max=20, chip=f"위기영역 {k}개",
                        reason=f"현재 활성 위기영역은 {k}개({', '.join(cur.crisis_domains) or '없음'})입니다."))

    if n == 1:
        w, chip, why = 0, "직전 발굴 없음", "비교할 직전 발굴이 없습니다."
    else:
        p = len(disc[-2].crisis_domains)
        w = 15 if k > p else 0
        chip = f"위기영역 {p}→{k}개"
        why = f"직전 발굴보다 위기영역이 {p}개에서 {k}개로 {'늘었습니다' if k > p else '늘지 않았습니다'}."
    items.append(F2Item(key="W", label="악화", points=w, max=15, chip=chip, reason=why))

    f = {"D": 25, "C": 15}.get(cur.result, 0)
    gap = {"D": ("상담안내만 받고 종결", "상담안내만 받고 종결되어 지원이 이어지지 않았습니다."),
           "C": ("조사불가로 종결", "조사불가로 종결되어 지원 여부가 확인되지 않았습니다.")}
    chip, why = gap.get(cur.result, ("공백 가점 없음", f"직전 종결 사유({cur.result})는 지원 공백 가점 대상이 아닙니다."))
    items.append(F2Item(key="F", label="지원 공백", points=f, max=25, chip=chip, reason=why))

    alone = h.household_type == "1인가구"
    net = h.support_network
    i = (5 if alone else 0) + (10 if net == "부재" else 0)
    chip = ("1인가구·" if alone else "") + {"부재": "관계망 없음", "있음": "관계망 있음", "미확인": "관계망 미확인"}[net]
    why = ("1인가구이고 " if alone else "1인가구가 아니며 ") + {
        "부재": "도움 관계망 부재가 확인되었습니다.",
        "있음": "도움 관계망이 있습니다.",
        "미확인": "도움 관계망은 미확인입니다(0점, 확인 필요)."}[net]
    items.append(F2Item(key="I", label="확인된 고립", points=i, max=15, chip=chip, reason=why, unknown=net == "미확인"))

    total = sum(x.points for x in items)
    level = next(name for cut, name in LEVELS if total >= cut)
    return F2Result(total=total, items=items, level=level, rule_version=RULE_VERSION)


def suggest_action(level: str, consent: Consent) -> str:
    """Decision.ai_suggestion 규칙(점수와 별개, LLM 아님).
    1) 문자·방문 모두 거부 → 보류(연락 경로 보류)  2) 긴급 → 재방문
    3) 문자 거부 → 재방문  4) 그 외 → 문자재안내
    """
    if consent.문자 == "거부" and consent.방문 == "거부":
        return "보류"
    if level == "긴급" or consent.문자 == "거부":
        return "재방문"
    return "문자재안내"
