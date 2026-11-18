import inspect
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

from prototype.api.schemas import Consent, Decision, Household
from prototype.pipeline import f2_priority
from prototype.pipeline.f2_priority import score, suggest_action


def hh(domains_seq=(["생계"],), results=None, htype="다인가구", net="있음", refused=False, **extra):
    v = "거부" if refused else "동의"
    consent = {"신청": v, "문자": v, "방문": v}
    results = results or ["A"] * len(domains_seq)
    disc = [{"date": date(2026, 1 + i, 1), "crisis_domains": d, "result": r}
            for i, (d, r) in enumerate(zip(domains_seq, results))]
    return Household(id="H-0001", gu="강북구", dong="가동", household_type=htype, support_network=net,
                     discoveries=disc, closed_at=date(2026, 10, 1), days_since_closure=43,
                     consent=consent, contact_refused=refused, **extra)


def pts(h):
    return {i.key: i.points for i in score(h).items}


@pytest.mark.parametrize("n,expected", [(1, 0), (2, 15), (3, 25), (5, 25)])
def test_repeat(n, expected):
    assert pts(hh([["생계"]] * n))["R"] == expected


@pytest.mark.parametrize("k,expected", [(0, 0), (1, 5), (4, 20), (5, 20)])
def test_current_domains_capped(k, expected):
    all5 = ["생계", "주거", "공공요금", "건강", "금융"]
    assert pts(hh([all5[:k]]))["C"] == expected


@pytest.mark.parametrize("seq,expected", [
    ([["생계"]], 0),                       # 직전 없음
    ([["생계"], ["생계", "주거"]], 15),     # 증가
    ([["생계", "주거"], ["생계", "건강"]], 0),  # 같음 (영역이 바뀌어도 수가 같으면 0)
    ([["생계", "주거"], ["생계"]], 0),       # 감소
    ([["생계"], ["생계"], ["생계", "주거"]], 15),  # 직전 1회와만 비교
])
def test_worsening(seq, expected):
    assert pts(hh(seq))["W"] == expected


@pytest.mark.parametrize("result,expected", [("D", 25), ("C", 15), ("A", 0), ("B", 0), ("지원연계", 0)])
def test_support_gap(result, expected):
    assert pts(hh([["생계"]], results=[result]))["F"] == expected


@pytest.mark.parametrize("htype,net,expected,unknown", [
    ("1인가구", "부재", 15, False), ("1인가구", "있음", 5, False), ("1인가구", "미확인", 5, True),
    ("부부가구", "부재", 10, False), ("다인가구", "있음", 0, False),
])
def test_isolation(htype, net, expected, unknown):
    item = next(i for i in score(hh(htype=htype, net=net)).items if i.key == "I")
    assert (item.points, item.unknown) == (expected, unknown)


def test_max_100_and_level():
    h = hh([["생계"], ["생계"], ["생계", "주거", "공공요금", "건강", "금융"]], results=["D", "D", "D"],
           htype="1인가구", net="부재")
    r = score(h)
    assert r.total == 100 and r.level == "긴급"
    assert sum(i.max for i in r.items) == 100


@pytest.mark.parametrize("total,level", [(70, "긴급"), (69, "주의"), (40, "주의"), (39, "관찰"), (0, "관찰")])
def test_level_boundaries(total, level):
    assert next(n for cut, n in f2_priority.LEVELS if total >= cut) == level


def test_boundary_70_via_rules():
    # R15 + C15 + W0 + F25 + I15 = 70 → 긴급
    h = hh([["생계", "주거", "건강"]] * 2, results=["D", "D"], htype="1인가구", net="부재")
    assert score(h).total == 70 and score(h).level == "긴급"


def test_boundary_40_via_rules():
    # R15 + C10 + W15 + F0 + I0 = 40 → 주의
    h = hh([["생계"], ["생계", "주거"]], results=["A", "B"])
    assert score(h).total == 40 and score(h).level == "주의"


def test_every_item_has_reason():
    for i in score(hh()).items:
        assert i.reason.strip().endswith(".")


def test_no_protected_attributes_in_signature():
    assert list(inspect.signature(score).parameters) == ["h"]
    for banned in ["gender", "age", "nationality", "sex", "성별", "연령", "나이", "국적"]:
        assert not any(banned in f for f in Household.model_fields)
    src = Path(f2_priority.__file__).read_text(encoding="utf-8")
    assert "AuditAttributes" not in src and ".contact_refused" not in src


@pytest.mark.parametrize("bad", [{"gender": "여"}, {"age": 72}, {"nationality": "KR"}])
def test_household_rejects_protected_attributes(bad):
    with pytest.raises(ValidationError):
        hh(**bad)


def test_excluded_attributes_declared():
    assert score(hh()).excluded_attributes == ["성별", "연령", "국적", "장애"]


def test_refusal_does_not_change_score():
    kw = dict(domains_seq=[["생계"], ["생계", "주거"]], results=["D", "D"], htype="1인가구", net="부재")
    assert score(hh(refused=False, **kw)) == score(hh(refused=True, **kw))


def test_decision_needs_reason_when_disagreeing():
    base = dict(by="담당자A", at="2026-11-13T10:00:00", ai_suggestion="재방문")
    assert Decision(status="재방문", **base).agrees_with_ai is True
    with pytest.raises(ValidationError):
        Decision(status="보류", **base)
    assert Decision(status="보류", reason="이번 주 입원 중", **base).agrees_with_ai is False


@pytest.mark.parametrize("level,consent,expected", [
    ("관찰", ("거부", "거부", "거부"), "보류"),
    ("긴급", ("미확인", "거부", "거부"), "보류"),
    ("긴급", ("미확인", "동의", "미확인"), "재방문"),
    ("주의", ("미확인", "거부", "동의"), "재방문"),
    ("주의", ("미확인", "미확인", "미확인"), "문자재안내"),
])
def test_suggest_action(level, consent, expected):
    c = Consent(**dict(zip(["신청", "문자", "방문"], consent)))
    assert suggest_action(level, c) == expected


def test_chips_short():
    h = hh([["생계"], ["생계"], ["생계", "주거", "공공요금", "건강", "금융"]], results=["D", "D", "C"],
           htype="1인가구", net="미확인")
    assert all(0 < len(i.chip) <= 14 for i in score(h).items)
