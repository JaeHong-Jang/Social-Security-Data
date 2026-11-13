import inspect
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

from prototype.api.schemas_v2 import F1ResultV2, F2ItemV2, HouseholdV2
from prototype.pipeline import f2_priority_v2 as f2
from prototype.pipeline.f2_priority_v2 import WEIGHTS, score, suggest_action
from prototype.pipeline.f3_match import checks_narrowed, found_by_tag_filter, household_tags

CLOSED = date(2026, 10, 1)


def memo(text="상담안내 종결.", ws="종결", ct="D1", consent=("미확인", "미확인", "미확인"), ev=None,
         net="미확인", iso=(), written=CLOSED, disc=date(2026, 9, 20), why=None, cause="미확인"):
    ev = ev if ev is not None else [("work_status", "상담안내 종결")]
    return {"discovery_date": disc, "written_at": written, "consult_type": "방문 상담", "text": text,
            "f1": {"work_status": ws, "closure_type": ct, "barrier_cause": cause, "consent": dict(zip(["신청", "문자", "방문"], consent)),
                   "support_network": net, "isolation_signals": list(iso),
                   "evidence": [{"field": f, "quote": q, "start": text.index(q), "end": text.index(q) + len(q)}
                                for f, q in ev],
                   "needs_check": ws != "종결", "needs_check_reason": why or ("확인 필요" if ws != "종결" else None),
                   "model": "mock"}}


def hh(memos=None, disc=None, htype="다인가구", days=43, signals=(), barrier=None, **extra):
    memos = memos or [memo()]
    disc = disc or [{"date": m["discovery_date"], "crisis_domains": ["생계"], "result": "D"} for m in memos]
    c = memos[-1]["f1"]["consent"]
    return HouseholdV2(id="H-0001", gu="강북구", dong="가동", household_type=htype, discoveries=disc, memos=memos,
                       repeated_barrier=barrier, post_closure_signals=list(signals), closed_at=memos[-1]["written_at"],
                       days_since_closure=days, consent=c, contact_refused=c["문자"] == "거부" and c["방문"] == "거부",
                       **extra)


def item(h, key):
    return next(i for i in score(h).items if i.key == key)


def two_memos(t0, t1, **kw1):
    return [memo(text=t0, written=date(2026, 3, 1), disc=date(2026, 2, 20)), memo(text=t1, **kw1)]


def with_cause(m, q, cause="서류·절차"):
    """메모 dict에 장벽 원인과 그 근거 인용을 붙인다."""
    t = m["text"]
    m["f1"]["barrier_cause"] = cause
    m["f1"]["evidence"].append({"field": "barrier_cause", "quote": q, "start": t.index(q), "end": t.index(q) + len(q)})
    return m


def barrier(q0, q1, i0=0, i1=1, memos=None, cause="서류·절차"):
    def mq(i, q):
        t = memos[i]["text"]
        return {"memo_index": i, "quote": q, "start": t.index(q), "end": t.index(q) + len(q)}
    for i, q in ((i0, q0), (i1, q1)):
        if memos[i]["f1"]["barrier_cause"] == "미확인":
            with_cause(memos[i], q, cause)
    return {"cause": cause, "summary": "두 차례 모두 서류·절차 부담으로 신청을 미룸", "model": "mock",
            "quotes": [mq(i0, q0), mq(i1, q1)]}


# ---------- 가중치·합계 ----------
def test_weights_total_100_and_items_match():
    assert sum(WEIGHTS.values()) == 100
    r = score(hh())
    assert [i.key for i in r.items] == list(WEIGHTS) and all(i.max == WEIGHTS[i.key] for i in r.items)
    assert r.rule_version == "v2" and r.total == sum(i.points for i in r.items)


def test_unknown_items_are_zero_points():
    with pytest.raises(ValidationError):
        F2ItemV2(key="I", label="고립", source="행정+F1", points=4, max=14, chip="x", reason="미확인.", unknown=True)
    r = score(hh(htype="다인가구"))
    for i in r.items:
        if i.unknown:
            assert i.points == 0 and "미확인" in i.reason


def test_f1_points_need_quote_schema():
    with pytest.raises(ValidationError):
        F2ItemV2(key="M", label="처리 확인 필요", source="F1", points=15, max=15, chip="x", reason="r.")


# ---------- M 처리 확인 필요 ----------
def test_m_investigating_but_closed_flags_and_forces_caution():
    t = "다음 주 서류 받으러 재방문 예정. 상담안내로 종결 처리함."
    h = hh([memo(text=t, ws="조사중", ct=None, ev=[("work_status", "다음 주 서류 받으러 재방문 예정")])])
    r = score(h)
    m = item(h, "M")
    assert (m.points, m.evidence) == (15, ["다음 주 서류 받으러 재방문 예정"])
    assert r.flags == ["처리 확인 필요"] and r.total < 35 and r.level == "주의"


def test_m_without_quote_is_unknown_zero_no_flag():
    t = "상담 중단. 종결 처리."
    h = hh([memo(text=t, ws="판단보류", ct=None, ev=[])])
    m = item(h, "M")
    assert (m.points, m.unknown) == (0, True) and score(h).flags == []


def test_c_closure_not_below_d():
    tc, td = "세 차례 방문. 조사불가로 종결.", "세 차례 방문. 상담안내 종결."
    hc = hh([memo(text=tc, ct="C", ev=[("closure_type", "조사불가로 종결")])])
    hd = hh([memo(text=td, ct="D1", ev=[("closure_type", "상담안내 종결")])])
    assert score(hc).total >= score(hd).total
    assert item(hc, "M").points == 15 and item(hd, "M").points == 0


# ---------- B 반복 장벽 ----------
def test_b_repeated_barrier_scores_with_quotes():
    ms = two_memos("서류가 너무 많다며 미룸. 상담안내 종결.", "서류 떼러 다닐 힘이 없다고 함. 상담안내 종결.")
    h = hh(ms, barrier=barrier("서류가 너무 많다며 미룸", "서류 떼러 다닐 힘이 없다고 함", memos=ms))
    b = item(h, "B")
    assert b.points == 15 and len(b.evidence) == 2 and b.chip == "서류·절차 반복"


def test_barrier_cause_must_match_memo_f1():
    ms = two_memos("서류가 너무 많다며 미룸. 상담안내 종결.", "허리가 아파 못 간다고 함. 상담안내 종결.")
    with_cause(ms[1], "허리가 아파 못 간다고 함", "건강")
    b = barrier("서류가 너무 많다며 미룸", "허리가 아파 못 간다고 함", memos=ms)  # 메모1은 건강 → 불일치
    with pytest.raises(ValidationError):
        hh(ms, barrier=b)


def test_closure_label_must_match_discovery_result():
    m = memo()
    m["closure_label"] = "상담안내 종결"
    assert hh([m]).memos[0].closure_label == "상담안내 종결"
    m["closure_label"] = "조사불가 종결"
    with pytest.raises(ValidationError):
        hh([m])


def test_b_single_memo_unknown_vs_two_memos_none():
    assert (item(hh(), "B").points, item(hh(), "B").unknown) == (0, True)
    h2 = hh(two_memos("상담안내 종결. 가", "상담안내 종결. 나"))
    assert (item(h2, "B").points, item(h2, "B").unknown) == (0, False)


def test_barrier_needs_two_distinct_memos():
    ms = two_memos("서류가 너무 많다며 미룸. 상담안내 종결.", "상담안내 종결. 나")
    with pytest.raises(ValidationError):
        hh(ms, barrier=barrier("서류가 너무 많다며 미룸", "상담안내 종결", i0=0, i1=0, memos=ms))


def test_barrier_fabricated_quote_rejected():
    ms = two_memos("서류가 너무 많다며 미룸. 상담안내 종결.", "상담안내 종결. 나")
    b = barrier("서류가 너무 많다며 미룸", "상담안내 종결", memos=ms)
    b["quotes"][1]["quote"] = "없는문장없는문장"[: len(b["quotes"][1]["quote"])].ljust(len(b["quotes"][1]["quote"]), "x")
    with pytest.raises(ValidationError):
        hh(ms, barrier=b)


# ---------- I 고립 ----------
@pytest.mark.parametrize("htype,net,quoted,iso,expected,unknown", [
    ("1인가구", "부재", True, False, 10, False),
    ("1인가구", "부재", False, False, 4, False),   # 인용 없는 부재 → 관계망 부분 0점
    ("1인가구", "미확인", False, True, 8, False),
    ("다인가구", "미확인", False, False, 0, True),
    ("다인가구", "있음", True, False, 0, False),
])
def test_isolation(htype, net, quoted, iso, expected, unknown):
    t = "가족과 연락이 끊겼다고 함. 집 앞에 우편물이 쌓여 있음. 상담안내 종결."
    ev = [("work_status", "상담안내 종결")]
    if quoted:
        ev.append(("support_network", "가족과 연락이 끊겼다고 함"))
    if iso:
        ev.append(("isolation_signals.우편물 적체", "집 앞에 우편물이 쌓여 있음"))
    h = hh([memo(text=t, ev=ev, net=net, iso=["우편물 적체"] if iso else [])], htype=htype)
    i = item(h, "I")
    assert (i.points, i.unknown) == (expected, unknown)


def test_network_from_earlier_memo_quote():
    ms = two_memos("연락하는 사람 없음. 상담안내 종결.", "상담안내 종결. 나")
    ms[0]["f1"]["support_network"] = "부재"
    ms[0]["f1"]["evidence"].append({"field": "support_network", "quote": "연락하는 사람 없음", "start": 0, "end": 10})
    assert item(hh(ms, htype="1인가구"), "I").points == 10


# ---------- N·T ----------
@pytest.mark.parametrize("n,expected", [(0, 0), (1, 8), (2, 14), (3, 14)])
def test_new_signals(n, expected):
    sig = [{"date": date(2026, 10, 2 + i), "kind": "단전", "domain": "공공요금", "source": "위기정보 연계(가상)"}
           for i in range(n)]
    assert item(hh(signals=sig), "N").points == expected


def test_signal_must_be_after_closure():
    with pytest.raises(ValidationError):
        hh(signals=[{"date": date(2026, 9, 1), "kind": "단전", "domain": None, "source": "x"}])


@pytest.mark.parametrize("days,expected", [(0, 0), (29, 0), (30, 3), (60, 6), (90, 9), (120, 12), (400, 12)])
def test_elapsed_days(days, expected):
    assert item(hh(days=days), "T").points == expected


def test_next_check_due_when_t_lifts_level():
    # C3 + I(1인 4 + 부재 6) + R6 + W8 = 27, T3 → 30 관찰. 90일째 T9 → 36 주의 → 재확인일 = 종결+90일
    t = "연락하는 사람 없음. 상담안내 종결."
    ms = [memo(text="상담안내 종결. 가", written=date(2026, 3, 1), disc=date(2026, 2, 20)),
          memo(text=t, ev=[("work_status", "상담안내 종결"), ("support_network", "연락하는 사람 없음")], net="부재")]
    disc = [{"date": date(2026, 2, 20), "crisis_domains": [], "result": "D"},
            {"date": date(2026, 9, 20), "crisis_domains": ["생계"], "result": "D"}]
    r = score(hh(ms, disc=disc, htype="1인가구", days=45))
    assert (r.total, r.level) == (30, "관찰")
    assert r.next_check_due == date(2026, 12, 30)


def test_next_check_due_default_interval():
    # 관찰 주기 60일(가설)
    assert score(hh(days=10)).next_check_due == date(2026, 10, 11) + __import__("datetime").timedelta(days=60)


# ---------- 보호속성·연락 거부 분리 ----------
def test_no_protected_attributes():
    assert list(inspect.signature(score).parameters) == ["h"]
    for banned in ["gender", "age", "nationality", "sex", "disab", "성별", "연령", "나이", "국적", "장애"]:
        assert not any(banned in f for f in HouseholdV2.model_fields)
    src = Path(f2.__file__).read_text(encoding="utf-8")
    assert "AuditAttributes" not in src
    assert score(hh()).excluded_attributes == ["성별", "연령", "국적", "장애"]


@pytest.mark.parametrize("bad", [{"gender": "여"}, {"age": 72}, {"nationality": "KR"}, {"disability": True}])
def test_household_rejects_protected(bad):
    with pytest.raises(ValidationError):
        hh(**bad)


def test_consent_does_not_change_score():
    t = "찾아오지 말라고 함. 상담안내 종결."
    a = hh([memo(text=t, consent=("미확인", "거부", "거부"))])
    b = hh([memo(text=t, consent=("동의", "동의", "동의"))])
    assert a.contact_refused and not b.contact_refused
    assert score(a) == score(b)


# ---------- F1 v2 스키마 ----------
def test_apply_consent_hold_distinct_from_refuse():
    c = hh([memo(consent=("보류(장벽)", "동의", "미확인"))]).consent
    assert c.신청 == "보류(장벽)" != "거부"
    with pytest.raises(ValidationError):
        hh([memo(consent=("미확인", "보류(장벽)", "미확인"))])  # 문자·방문에는 보류(장벽) 없음


def test_needs_check_requires_reason():
    with pytest.raises(ValidationError):
        F1ResultV2(work_status="판단보류", closure_type=None, consent={"신청": "미확인", "문자": "미확인", "방문": "미확인"},
                   evidence=[], needs_check=True, model="mock")


# ---------- 행동 제안 ----------
def act(h, n=None):
    return suggest_action(h, score(h), n_candidates=n)


def test_refused_with_isolation_holds_outreach_but_safety_check():
    t = "찾아오지 말라고 함. 집 앞에 우편물이 쌓여 있음. 조사불가로 종결."
    h = hh([memo(text=t, ct="C", consent=("미확인", "거부", "거부"), iso=["우편물 적체"],
                 ev=[("closure_type", "조사불가로 종결"), ("isolation_signals.우편물 적체", "집 앞에 우편물이 쌓여 있음")])])
    a = act(h)
    assert a.outreach == "재확인 예약" and a.outreach_reason and a.due == score(h).next_check_due
    assert a.safety_check and a.safety_check.channels == ["통반장", "명예사회복지공무원"]


def test_safety_channels_never_landlord():
    t = "월세 체납. 집 앞에 우편물이 쌓여 있음. 상담안내 종결."
    disc = [{"date": date(2026, 9, 20), "crisis_domains": ["주거", "생계"], "result": "D"}]
    h = hh([memo(text=t, iso=["우편물 적체"], ev=[("work_status", "상담안내 종결"),
                                              ("isolation_signals.우편물 적체", "집 앞에 우편물이 쌓여 있음")])], disc=disc)
    assert "임대인" not in act(h).safety_check.channels


def test_safety_check_independent_of_consent():
    sig = [{"date": date(2026, 10, 20), "kind": "단수", "domain": "공공요금", "source": "위기정보 연계(가상)"}]
    a = act(hh(signals=sig))
    assert a.safety_check and a.outreach != "재확인 예약"
    assert act(hh()).safety_check is None


@pytest.mark.parametrize("ct,consent,expected", [
    ("D1", ("보류(장벽)", "미확인", "미확인"), "동행 신청 지원(재방문)"),
    ("D1", ("보류(장벽)", "동의", "거부"), "문자재안내"),
    ("D1", ("거부", "동의", "미확인"), "문자재안내"),       # 신청 거부 → 신청 권유 없이 정보만
    ("D2", ("미확인", "미확인", "동의"), "심층상담(재방문)"),
    ("D2", ("미확인", "동의", "거부"), "문자재안내"),
    ("D3", ("미확인", "동의", "미확인"), "안부 문자"),
    ("A", ("미확인", "미확인", "미확인"), "문자재안내"),
])
def test_d_subtype_mapping(ct, consent, expected):
    assert act(hh([memo(ct=ct, consent=consent)])).outreach == expected


def test_d3_wait_and_new_signal():
    a = act(hh([memo(ct="D3", consent=("미확인", "동의", "미확인"))], days=10))
    assert a.outreach == "안부 문자" and a.due == date(2026, 11, 30)
    sig = [{"date": date(2026, 10, 5), "kind": "건보료 체납", "domain": "금융", "source": "위기정보 연계(가상)"}]
    assert act(hh([memo(ct="D3")], signals=sig)).outreach == "재방문"


def test_repeated_barrier_overrides_latest_closure_type():
    ms = two_memos("서류가 너무 많다며 미룸. 상담안내 종결.", "당분간 괜찮다고 함. 상담안내 종결.", ct="D3")
    h = hh(ms, barrier=barrier("서류가 너무 많다며 미룸", "당분간 괜찮다고 함", memos=ms))
    a = act(h)
    assert a.outreach == "동행 신청 지원(재방문)" and a.outreach_reason.startswith("두 차례 모두 서류·절차 부담")


def test_flag_leads_to_revisit():
    t = "다음 주 재방문 예정. 종결 처리함."
    assert act(hh([memo(text=t, ws="조사중", ct=None, ev=[("work_status", "다음 주 재방문 예정")])])).outreach == "재방문"


def test_hold_only_with_reason_zero_candidates():
    h = hh([memo(ct="A")], days=10)
    a = act(h, n=0)
    assert a.outreach == "재확인 예약" and "후보" in a.outreach_reason and "대기열" in a.outreach_reason
    assert a.due == score(h).next_check_due
    assert act(hh([memo(ct="A")], days=10), n=1).outreach == "문자재안내"


# ---------- F3 태그 비교 ----------
def test_tag_filter():
    h = hh(htype="한부모가구")
    tags = household_tags(h)
    assert tags == {"themes": ["생활지원", "안전·위기"], "targets": ["한부모·조손"]}
    assert found_by_tag_filter(tags, {"intrsThemaNmArray": "서민금융, 안전·위기"})
    assert found_by_tag_filter(tags, {"trgterIndvdlNmArray": "장애인, 한부모·조손"})
    assert not found_by_tag_filter(tags, {"intrsThemaNmArray": "서민금융", "trgterIndvdlNmArray": "저소득"})
    assert not found_by_tag_filter(tags, {})


def test_checks_narrowed():
    c = checks_narrowed([{"checks": [{"status": "충족"}, {"status": "확인필요"}]}, {"checks": [{"status": "확인필요"}]}])
    assert (c.total, c.충족, c.확인필요, c.summary) == (3, 1, 2, "확인 필요 2개 (조건 3개 중 1개 충족)")
    assert checks_narrowed([]).summary == "확인 필요 0개 (후보 없음)"
