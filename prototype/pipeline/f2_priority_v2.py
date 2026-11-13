"""F2 재검토 우선순위 v2 — 규칙 코드로만 계산한다. LLM(F1)은 입력값을 메모에서 뽑는 데만 쓴다.

v1(f2_priority.py)과의 차이:
- F1 추출값이 점수에 들어간다(M·B·I). F1 유래 점수는 메모 원문 인용이 있을 때만 준다.
  인용이 없으면 그 부분은 '미확인'·0점이다.
- v1의 F(지원 공백)는 대기열 전원이 상담안내·조사불가 종결이라 사실상 상수였으므로 뺐다.
  v1에서 조사불가(C) 15점 < 상담안내(D) 25점이던 역전도 사라진다. 조사불가는 M(처리 확인 필요)에서
  다루므로, 다른 조건이 같으면 C ≥ D가 된다.
- N(종결 후 새 위기신호)과 T(경과일)를 더했다. T 때문에 '관찰' 가구도 시간이 지나면 다시 올라온다.

가중치 표 — 모두 **가설**이다. 현장 검증 전이며, 민감도·ablation은 eval/results/2026-11-13_f2_*.md.
| 키 | 항목              | 입력 출처            | 최대 | 부여 규칙 |
|----|-------------------|----------------------|-----:|-----------|
| R  | 반복 발굴         | 행정(발굴 이력)      | 10 | 2회 6, 3회 이상 10. 복지부 '반복발굴 알림' 플래그(2026.5 강화방안)로 대체 가능 |
| C  | 현재 위기영역     | 행정                 | 12 | 영역당 3, 최대 4개 |
| W  | 악화              | 행정                 |  8 | 직전 발굴보다 위기영역 수 증가 |
| M  | 처리 확인 필요    | F1 인용              | 15 | 최근 메모가 조사중·판단보류인데 종결 처리, 또는 조사불가(C) 종결. 플래그 → 등급 '주의' 이상 |
| B  | 반복 장벽         | F1 회차 교차 인용    | 15 | 서로 다른 회차 메모 2건 이상에서 같은 장벽 **원인**(종결 유형만 같으면 아님) |
| I  | 고립              | 행정 + F1 인용       | 14 | 1인가구 4(행정) + 관계망 부재 6(인용) + 고립 징후 4(인용: 우편물 적체·반복 부재 등) |
| N  | 종결 후 새 위기신호 | 행정(위기정보 연계) | 14 | 종결 후 새 신호 1건 8, 2건 이상 14 |
| T  | 경과일            | 행정(종결일)         | 12 | 종결 후 30일마다 3 (120일 이상 12) |
합계 100. 등급: 긴급 ≥60, 주의 35~59, 관찰 <35 (가설).

미확인 규칙: unknown=True인 항목은 항상 0점이고 사유 문구에 '미확인'을 쓴다. 일부만 미확인인 항목(I에서
1인가구 점수는 있으나 관계망 인용이 없는 경우)은 unknown=False이고, 사유에 '관계망 미확인(0점)'이라고 적는다.

보호속성(성별·연령·국적·장애)은 입력 HouseholdV2에 필드가 없으므로 점수에 들어갈 수 없다.
score()는 연락 의사(consent)·연락 거부를 읽지 않는다(점수와 분리). 이 둘은 suggest_action만 읽는다.

재확인 주기(가설): 긴급 7일·주의 30일·관찰 60일. 2차 심사 "관찰 주기 60일 이하" 반영(이전 관찰 90일).
"""
from datetime import date, timedelta

from prototype.api.schemas_v2 import (ActionSuggestion, F2ItemV2, F2ResultV2, F1ResultV2, HouseholdV2,
                                      SafetyCheck)

RULE_VERSION = "v2"
WEIGHTS = {"R": 10, "C": 12, "W": 8, "M": 15, "B": 15, "I": 14, "N": 14, "T": 12}
LEVELS = [(60, "긴급"), (35, "주의"), (0, "관찰")]
FLAG_CHECK = "처리 확인 필요"
F1_KEYS = ("M", "B", "I")  # F1 추출값이 들어가는 항목 (ablation 대상)
T_STEPS = (30, 60, 90, 120)  # 경과일 단계 경계
RECHECK_DAYS = {"긴급": 7, "주의": 30, "관찰": 60}  # 가설(현장 검증 전)
D3_WAIT_DAYS = 60  # 일시 해소(D3) 진술 후 안부 문자까지 기다리는 기간 (가설)
LABELS = {"R": "반복 발굴", "C": "현재 위기영역", "W": "악화", "M": "처리 확인 필요", "B": "반복 장벽",
          "I": "고립", "N": "종결 후 새 위기신호", "T": "경과일"}


def _latest_known_network(h: HouseholdV2) -> tuple[str, list[str]]:
    """관계망은 인용이 있는 가장 최근 메모의 값을 쓴다. 인용이 없으면 미확인."""
    for m in reversed(h.memos):
        q = m.f1.quotes("support_network")
        if m.f1.support_network != "미확인" and q:
            return m.f1.support_network, q
    return "미확인", []


def _isolation_quotes(f1: F1ResultV2) -> list[str]:
    return [q for s in f1.isolation_signals for q in f1.quotes(f"isolation_signals.{s}")]


def _t_frac(days: int) -> float:
    return sum(days >= s for s in T_STEPS) / len(T_STEPS)


def parts(h: HouseholdV2, use_f1: bool = True) -> dict[str, dict]:
    """항목별 비율(0~1)과 화면 문구. 점수 = round(가중치 × 비율). use_f1=False는 ablation용."""
    disc, f1 = h.discoveries, h.memos[-1].f1
    n, cur = len(disc), disc[-1]
    k = len(cur.crisis_domains)
    out = {}

    out["R"] = dict(frac=0 if n == 1 else 0.6 if n == 2 else 1.0, source="행정",
                    chip=f"{n}회째 발굴" if n > 1 else "첫 발굴",
                    reason=f"관찰기간 내 {n}회 발굴되었습니다(정부 반복발굴 알림으로 대체 가능)." if n > 1
                    else "이번이 첫 발굴입니다.")

    out["C"] = dict(frac=min(k, 4) / 4, source="행정", chip=f"위기영역 {k}개",
                    reason=f"현재 위기영역은 {k}개({', '.join(cur.crisis_domains) or '없음'})입니다.")

    if n == 1:
        out["W"] = dict(frac=0, source="행정", chip="직전 발굴 없음", reason="비교할 직전 발굴이 없습니다.")
    else:
        p = len(disc[-2].crisis_domains)
        out["W"] = dict(frac=1.0 if k > p else 0, source="행정", chip=f"위기영역 {p}→{k}개",
                        reason=f"직전 발굴보다 위기영역이 {p}개에서 {k}개로 {'늘었습니다' if k > p else '늘지 않았습니다'}.")

    # M 처리 확인 필요
    m_q = f1.quotes("work_status") if f1.work_status in ("조사중", "판단보류") else []
    c_q = f1.quotes("closure_type") if f1.closure_type == "C" else []
    if not use_f1:
        out["M"] = dict(frac=0, source="F1", chip="F1 미사용", reason="F1 추출값을 쓰지 않는 비교 조건입니다.")
    elif m_q:
        out["M"] = dict(frac=1.0, source="F1", chip=f"메모상 {f1.work_status}", evidence=m_q, flag=True,
                        reason=f"행정상 종결이지만 메모는 '{f1.work_status}' 상태로 읽혀 처리 확인이 필요합니다.")
    elif c_q:
        out["M"] = dict(frac=1.0, source="F1", chip="조사불가 종결", evidence=c_q, flag=True,
                        reason="조사불가로 종결되어 지원 필요 여부가 확인되지 않았습니다.")
    elif f1.work_status in ("조사중", "판단보류") or f1.closure_type == "C":
        out["M"] = dict(frac=0, source="F1", chip="근거 인용 없음", unknown=True,
                        reason="처리 상태를 뒷받침하는 메모 인용이 없어 미확인(0점)입니다.")
    else:
        out["M"] = dict(frac=0, source="F1", chip="종결 처리 일치", reason="메모와 행정상 종결 상태가 일치합니다.")

    # B 반복 장벽
    rb = h.repeated_barrier
    if not use_f1:
        out["B"] = dict(frac=0, source="F1", chip="F1 미사용", reason="F1 추출값을 쓰지 않는 비교 조건입니다.")
    elif rb:
        out["B"] = dict(frac=1.0, source="F1", chip=f"{rb.cause} 반복", evidence=[q.quote for q in rb.quotes],
                        reason=f"회차가 다른 메모 {len({q.memo_index for q in rb.quotes})}건에서 같은 장벽 원인"
                               f"({rb.cause})이 인용과 함께 반복되었습니다: {rb.summary}.")
    elif len(h.memos) < 2:
        out["B"] = dict(frac=0, source="F1", chip="비교 메모 없음", unknown=True,
                        reason="회차 메모가 1건뿐이라 반복 여부를 알 수 없습니다(미확인).")
    else:
        out["B"] = dict(frac=0, source="F1", chip="반복 장벽 없음",
                        reason=f"메모 {len(h.memos)}건에서 원인이 같은 장벽이 인용과 함께 반복되지는 않았습니다.")

    # I 고립
    alone = h.household_type == "1인가구"
    net, net_q = _latest_known_network(h) if use_f1 else ("미확인", [])
    iso_q = _isolation_quotes(f1) if use_f1 else []
    absent = net == "부재"
    pts = 4 * alone + 6 * absent + 4 * bool(iso_q)
    chip = ("1인·" if alone else "") + {"부재": "관계망 없음", "있음": "관계망 있음", "미확인": "관계망 미확인"}[net]
    why = ("1인가구입니다. " if alone else "1인가구가 아닙니다. ") + {
        "부재": "메모에서 도움 관계망 부재가 확인되었습니다.",
        "있음": "메모상 도움 관계망이 있습니다.",
        "미확인": "도움 관계망은 메모 인용이 없어 미확인(0점)입니다."}[net]
    if iso_q:
        why += " 메모에 고립 징후가 있습니다."
    out["I"] = dict(frac=pts / 14, source="행정+F1", chip=chip, reason=why, unknown=pts == 0 and net == "미확인",
                    evidence=(net_q if absent else []) + iso_q)

    sig = h.post_closure_signals
    out["N"] = dict(frac=0 if not sig else 8 / 14 if len(sig) == 1 else 1.0, source="행정",
                    chip=f"종결 후 신호 {len(sig)}건" if sig else "새 신호 없음",
                    reason=("종결 후 새 위기신호: " + ", ".join(f"{s.kind}({s.date:%m.%d}, {s.source})" for s in sig) + ".")
                    if sig else "종결 이후 들어온 새 위기신호가 없습니다.")

    d = h.days_since_closure
    out["T"] = dict(frac=_t_frac(d), source="행정", chip=f"종결 후 {d}일",
                    reason=f"종결 후 {d}일이 지났습니다(30일마다 가점).")
    return out


def _level(total: int) -> str:
    return next(name for cut, name in LEVELS if total >= cut)


def raw_total(h: HouseholdV2, weights: dict[str, float] = WEIGHTS, use_f1: bool = True) -> float:
    """민감도·ablation 스크립트용 합계(반올림 전 가중합)."""
    return sum(weights[k] * p["frac"] for k, p in parts(h, use_f1).items())


def score(h: HouseholdV2) -> F2ResultV2:
    ps = parts(h)
    items = [F2ItemV2(key=k, label=LABELS[k], source=p["source"], points=round(WEIGHTS[k] * p["frac"]),
                      max=WEIGHTS[k], chip=p["chip"], reason=p["reason"], unknown=p.get("unknown", False),
                      evidence=p.get("evidence", []))
             for k, p in ps.items()]
    total = sum(i.points for i in items)
    flags = [FLAG_CHECK] if ps["M"].get("flag") else []
    level = _level(total)
    if flags and level == "관찰":
        level = "주의"
    t_points = next(i.points for i in items if i.key == "T")
    return F2ResultV2(total=total, items=items, level=level, flags=flags,
                      next_check_due=_next_check_due(h, total, t_points, level), rule_version=RULE_VERSION)



def _next_check_due(h: HouseholdV2, total: int, t_points: int, level: str) -> date:
    """최소 재확인일: 등급별 주기와, 경과일(T) 가점으로 등급이 올라가는 첫 날 중 이른 날."""
    today = h.reference_date
    due = today + timedelta(days=RECHECK_DAYS[level])
    cuts = {name: cut for cut, name in LEVELS}
    up = {"관찰": "주의", "주의": "긴급"}.get(level)
    if up:
        for step in T_STEPS:
            day = h.closed_at + timedelta(days=step)
            if day > today and total - t_points + round(WEIGHTS["T"] * _t_frac(step)) >= cuts[up]:
                return min(due, day)
    return due


# ---------- 행동 제안 ----------
SAFETY_SIGNAL_KINDS = {"단전", "단수", "가스 차단", "우편물 적체", "이웃 제보"}
SAFETY_CHANNELS = ("통반장", "명예사회복지공무원")
CAUSE_REASON = {"서류·절차": "서류·절차 부담으로", "건강": "건강 문제로", "시간·생계": "시간·생계 사정으로",
                "기타": "어려움이 있어", "해당없음": "어려움이 있어", "미확인": "어려움이 있어(이유 미확인)"}


def _safety(h: HouseholdV2) -> SafetyCheck | None:
    f1 = h.memos[-1].f1
    triggers = [f"메모: {q}" for q in _isolation_quotes(f1)]
    triggers += [f"{s.kind}({s.date:%Y-%m-%d}, {s.source})" for s in h.post_closure_signals
                 if s.kind in SAFETY_SIGNAL_KINDS]
    if not triggers:
        return None
    # 임대인 경로는 위기 사실이 노출될 수 있어 기본 경로에서 뺀다(2차 심사 ESG 지적)
    return SafetyCheck(channels=list(SAFETY_CHANNELS), triggers=triggers,
                       reason="고립 징후가 있어 주변 경로로 안부를 확인합니다. 본인 연락·재안내와 별개이며 연락 거부와 무관합니다.")


def suggest_action(h: HouseholdV2, f2: F2ResultV2, n_candidates: int | None = None) -> ActionSuggestion:
    """Decision.ai_suggestion 규칙(점수와 별개, LLM 아님).

    안전 확인: 메모 고립 징후(인용) 또는 종결 후 단전·단수·우편물 적체 등 → 통반장·명예사회복지공무원.
      (임대인은 위기 사실 노출 우려로 기본 경로에서 뺐다.)
    재안내(동의 범위 안에서만, '미확인'은 막지 않음):
      1) 문자·방문 모두 거부 → 재확인 예약(본인 연락 없이 재확인일에 다시 봄. 대기열에 남음. 안전 확인은 유지)
      2) 처리 확인 필요 플래그 → 재방문(조사 마무리). 방문 거부면 문자재안내
      3) 장벽(반복 장벽 원인이 있으면 신청 대기(D1)와 같이 다룬다. 없으면 최근 종결 유형)
         D1 → 동행 신청 지원(재방문). 사유 문구는 장벽 원인에서 만든다.
              신청 '거부'면 신청 권유 없이 정보만(문자재안내). 방문 거부면 문자재안내
         D2 → 심층상담(재방문). 방문 거부면 문자재안내
         D3 → 종결 후 새 신호가 없으면 기간 후 안부 문자, 있으면 재방문
      4) 조건 대조 후보 0개 + 관찰 + 새 신호 없음 → 재확인 예약(재확인일 = f2.next_check_due, 대기열에 남음)
      5) 그 외: 긴급 → 재방문, 나머지 → 문자재안내 (가능한 경로로)
    """
    c = h.consent
    sms_ok, visit_ok = c.문자 != "거부", c.방문 != "거부"
    today = h.reference_date
    note = f"신청 {c.신청} · 문자 {c.문자} · 방문 {c.방문}"
    safety = _safety(h)

    def act(outreach, reason, due=today):
        return ActionSuggestion(outreach=outreach, outreach_reason=reason, due=due, safety_check=safety,
                                consent_note=note)

    def visit_or_sms(visit_kind, reason):
        if visit_ok:
            return act(visit_kind, reason)
        return act("문자재안내", reason + " 방문은 거부해 문자로 안내합니다.")

    due = f2.next_check_due
    if not sms_ok and not visit_ok:
        return act("재확인 예약", f"문자·방문 모두 거부해 본인 연락 없이 재확인일({due})에 다시 봅니다. "
                                 "대기열에 남겨 두며 안전 확인은 별도입니다.", due)
    if FLAG_CHECK in f2.flags:
        return visit_or_sms("재방문", "행정상 종결이지만 메모상 조사가 끝나지 않아 조사를 마무리합니다.")
    rb = h.repeated_barrier
    code = "D1" if rb else h.memos[-1].f1.closure_type
    if code == "D1":
        if c.신청 == "거부":
            if sms_ok:
                return act("문자재안내", "본인이 신청을 거부해 신청 권유 없이 정보만 안내합니다.")
            return act("재방문", "본인이 신청을 거부하고 문자도 거부해 방문 때 정보만 안내합니다.")
        why = (f"{rb.summary}. " if rb else
               f"{CAUSE_REASON[h.memos[-1].f1.barrier_cause]} 신청을 미뤘습니다. ")
        return visit_or_sms("동행 신청 지원(재방문)", why + "서류 확인과 신청을 함께 돕습니다.")
    if code == "D2":
        return visit_or_sms("심층상담(재방문)", "원하는 도움이 분명하지 않아 욕구를 다시 함께 살핍니다.")
    if code == "D3":
        if h.post_closure_signals:
            return visit_or_sms("재방문", "위기가 풀렸다고 했지만 종결 후 새 위기신호가 들어왔습니다.")
        due = max(today, h.closed_at + timedelta(days=D3_WAIT_DAYS))
        if sms_ok:
            return act("안부 문자", f"위기가 일시적으로 풀렸다고 해 {D3_WAIT_DAYS}일 뒤 안부 문자로 확인합니다.", due)
        return act("재방문", f"위기가 일시적으로 풀렸다고 했고 문자는 거부해 {D3_WAIT_DAYS}일 뒤 방문으로 확인합니다.", due)
    if n_candidates == 0 and f2.level == "관찰" and not h.post_closure_signals:
        return act("재확인 예약", f"조건이 맞는 후보 사업이 없고 새 위기신호도 없어 재확인일({due})에 다시 봅니다. "
                                 "대기열에 남겨 둡니다.", due)
    if f2.level == "긴급":
        return visit_or_sms("재방문", "우선순위 '긴급'이라 직접 만나 확인합니다.")
    if sms_ok:
        return act("문자재안내", "조건 대조 결과를 문자로 다시 안내합니다.")
    return act("재방문", "문자는 거부해 방문으로 다시 안내합니다.")
