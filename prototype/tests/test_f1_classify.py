"""F1 인용 검증·실패 대체 경로 테스트. HTTP(urlopen)는 가짜로 바꾼다 — Ollama 없이 돈다."""
import io
import json
import urllib.error

import pytest

from prototype.api.schemas import check_quotes
from prototype.api.schemas_v2 import F1ResultV2
from prototype.llm import ollama
from prototype.pipeline import f1_baseline, f1_classify, f1_cross
from prototype.pipeline.f1_classify import F1LLMOut, build_result, classify, locate

MEMO = "생계 위기로 발굴. 기초생활 신청을 안내했으나 몸이 아파  서류를 못 떼겠다며 미룸. 문자는 받겠다고 함. 상담안내 종결."


def out(**kw) -> F1LLMOut:
    base = dict(work_status_quote="상담안내 종결", work_status="종결",
                closure_type_quote="몸이 아파  서류를 못 떼겠다며 미룸", closure_type="D1",
                barrier_cause_quote="서류를 못 떼겠다며 미룸", barrier_cause="서류·절차",
                신청_quote="몸이 아파  서류를 못 떼겠다며 미룸", 신청="보류(장벽)",
                문자_quote="문자는 받겠다고 함", 문자="동의", 방문_quote="", 방문="미확인",
                support_network_quote="", support_network="미확인", isolation_signals=[])
    return F1LLMOut(**{**base, **kw})


# ---------- locate ----------
def test_locate_exact():
    s, e = locate(MEMO, "문자는 받겠다고 함")
    assert MEMO[s:e] == "문자는 받겠다고 함"


def test_locate_whitespace_normalised_returns_original_span():
    s, e = locate(MEMO, "몸이 아파 서류를 못 떼겠다며")  # 원문은 공백 2칸
    assert MEMO[s:e] == "몸이 아파  서류를 못 떼겠다며"


def test_locate_strips_wrapping_quotes_and_period():
    s, e = locate(MEMO, "“문자는 받겠다고 함.”")
    assert MEMO[s:e] in ("문자는 받겠다고 함", "문자는 받겠다고 함.")


@pytest.mark.parametrize("q", ["", "   ", "문자는 괜찮다고 함", "서류를 못 떼겠다며 신청 거부"])
def test_locate_rejects_absent_or_empty(q):
    assert locate(MEMO, q) is None


# ---------- build_result ----------
def test_build_result_spans_are_verified():
    res, info = build_result(MEMO, out(), "m")
    check_quotes(MEMO, res.evidence)  # 모든 인용이 원문 구간과 정확히 같다
    assert res.closure_type == "D1" and res.consent.신청 == "보류(장벽)" and res.consent.문자 == "동의"
    assert res.barrier_cause == "서류·절차" and res.quotes("barrier_cause") == ["서류를 못 떼겠다며 미룸"]
    assert not res.needs_check and info["quotes_verified"] == info["quotes_proposed"] == 5


def test_fabricated_quote_drops_field_to_unknown():
    res, info = build_result(MEMO, out(문자_quote="문자 안내는 괜찮다고 함"), "m")
    assert res.consent.문자 == "미확인"
    assert res.needs_check and "consent.문자" in res.needs_check_reason
    assert all(e.field != "consent.문자" for e in res.evidence)
    assert info["dropped"] == ["consent.문자"]


def test_value_without_quote_is_unsupported():
    res, _ = build_result(MEMO, out(support_network="부재", support_network_quote=""), "m")
    assert res.support_network == "미확인" and res.needs_check


def test_dropped_closure_turns_closed_into_pending():
    res, _ = build_result(MEMO, out(closure_type_quote="소득이 기준을 넘음", closure_type="A"), "m")
    assert res.work_status == "판단보류" and res.closure_type is None and res.needs_check


def test_closed_without_closure_type_is_pending():
    res, _ = build_result(MEMO, out(closure_type="없음", closure_type_quote=""), "m")
    assert res.work_status == "판단보류" and "종결 사유" in res.needs_check_reason


def test_investigating_without_quote_is_pending():
    res, _ = build_result(MEMO, out(work_status="조사중", work_status_quote="다음 주 재방문 예정"), "m")
    assert res.work_status == "판단보류" and res.needs_check


def test_isolation_signal_needs_quote():
    res, _ = build_result(MEMO, out(isolation_signals=[{"quote": "우편물이 쌓여 있음", "value": "우편물 적체"}]), "m")
    assert res.isolation_signals == [] and res.needs_check


# ---------- HTTP 가짜 + 재시도·실패 대체 ----------
class FakeHTTP:
    def __init__(self, contents):
        self.contents, self.calls = list(contents), []

    def __call__(self, req, timeout=None):
        self.calls.append(json.loads(req.data))
        c = self.contents.pop(0)
        if isinstance(c, Exception):
            raise c
        return io.BytesIO(json.dumps({"message": {"content": c}}).encode())


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("OLLAMA_HOST", "127.0.0.1:1")

    def install(*contents):
        f = FakeHTTP(contents)
        monkeypatch.setattr(ollama.urllib.request, "urlopen", f)
        return f
    return install


def test_classify_ok_sends_schema_and_deterministic_options(fake):
    f = fake(out().model_dump_json())
    res, info = classify(MEMO, "m")
    assert res.closure_type == "D1" and info["attempts"] == 1 and info["llm_ok"]
    body = f.calls[0]
    assert body["format"]["properties"]["closure_type"]["enum"] and body["options"]["temperature"] == 0
    assert body["options"]["seed"] == ollama.SEED


def test_retry_after_invalid_json_then_success(fake):
    f = fake("{not json", out().model_dump_json())
    res, info = classify(MEMO, "m")
    assert info["attempts"] == 2 and res.work_status == "종결"
    assert "형식 검사에 실패" in f.calls[1]["messages"][-1]["content"]  # 오류를 되돌려 준다


def test_all_attempts_invalid_falls_back_to_pending(fake):
    bad = json.dumps({"work_status": "끝남"})
    fake(bad, bad, bad)
    res, info = classify(MEMO, "m")
    assert res.work_status == "판단보류" and res.needs_check and res.evidence == []
    assert info["attempts"] == 3 and not info["llm_ok"]


def test_http_error_falls_back_to_pending(fake):
    fake(urllib.error.URLError("connection refused"))
    res, info = classify(MEMO, "m")
    assert res.work_status == "판단보류" and "AI 분류 실패" in res.needs_check_reason and not info["llm_ok"]


# ---------- 장벽 원인 · 동의 귀속 ----------
def test_barrier_cause_without_verified_quote_is_unknown():
    res, info = build_result(MEMO, out(barrier_cause_quote="서류 떼기가 귀찮다고 함"), "m")
    assert res.barrier_cause == "미확인" and "barrier_cause" in info["dropped"] and res.needs_check
    res, _ = build_result(MEMO, out(barrier_cause="건강", barrier_cause_quote=""), "m")
    assert res.barrier_cause == "미확인"


def test_barrier_cause_none_needs_no_quote():
    res, _ = build_result(MEMO, out(barrier_cause="해당없음", barrier_cause_quote=""), "m")
    assert res.barrier_cause == "해당없음" and not res.needs_check


def test_schema_rejects_cause_without_quote():
    with pytest.raises(ValueError):
        F1ResultV2(work_status="판단보류", closure_type=None, barrier_cause="건강",
                   consent={"신청": "미확인", "문자": "미확인", "방문": "미확인"}, evidence=[], needs_check=True,
                   needs_check_reason="r", model="m")


@pytest.mark.parametrize("q,expected", [
    ("다음 주 서류 받으러 재방문 예정", True), ("재방문 예정", True), ("서류 목록을 문자로 보냄", True),
    ("다시 방문하기로 함", True), ("다음 달에 한 번 더 들러달라고 함", False), ("방문해도 괜찮다고 함", False),
    ("본인 동의하에 재방문하기로 함", False), ("문자 안내는 괜찮다고 함", False)])
def test_staff_plan_detector(q, expected):
    assert f1_classify.staff_plan(q) is expected


def test_staff_plan_visit_is_not_resident_consent():
    memo = "소득 자료 보완을 요청했고 다음 주 서류 받으러 재방문 예정. 상담안내로 종결 처리함."
    o = out(work_status="조사중", work_status_quote="다음 주 서류 받으러 재방문 예정", closure_type="없음",
            closure_type_quote="", barrier_cause="해당없음", barrier_cause_quote="", 신청="미확인", 신청_quote="",
            문자="미확인", 문자_quote="", 방문="동의", 방문_quote="재방문 예정")
    res, info = build_result(memo, o, "m")
    assert res.consent.방문 == "미확인" and info["staff_plan_guard"] == ["방문"]
    assert res.needs_check and "담당자 계획" in res.needs_check_reason
    assert all(e.field != "consent.방문" for e in res.evidence)


# ---------- 회차 교차 · 기준선 ----------
M2 = "다시 발굴. 이번에도 서류 준비가 어렵다며 신청을 미룸. 상담안내 종결."
M3 = "다시 발굴. 허리가 아파 주민센터에 갈 수 없다며 신청을 미룸. 상담안내 종결."


def second(memo, cause, q):
    return build_result(memo, out(closure_type_quote=q, 신청_quote=q, barrier_cause=cause, barrier_cause_quote=q,
                                  문자="미확인", 문자_quote=""), "m")[0]


def test_repeated_barrier_needs_same_cause_with_quotes():
    a, _ = build_result(MEMO, out(), "m")
    b = second(M2, "서류·절차", "서류 준비가 어렵다며 신청을 미룸")
    rb = f1_cross.repeated_barrier([a, b])
    assert rb.cause == "서류·절차" and [q.memo_index for q in rb.quotes] == [0, 1]
    assert rb.summary == "두 차례 모두 서류·절차 부담으로 신청을 미룸"
    assert M2[rb.quotes[1].start:rb.quotes[1].end] == rb.quotes[1].quote
    assert f1_cross.repeated_barrier([a]) is None


def test_same_d1_code_different_cause_is_not_repeated():
    a, _ = build_result(MEMO, out(), "m")
    c = second(M3, "건강", "허리가 아파 주민센터에 갈 수 없다며 신청을 미룸")
    assert a.closure_type == c.closure_type == "D1"
    assert f1_cross.repeated_barrier([a, c]) is None


def test_cause_without_quote_not_counted_and_other_not_counted():
    a, _ = build_result(MEMO, out(), "m")
    b, _ = build_result(M2, out(barrier_cause_quote="없는 구절"), "m")  # 인용 실패 → 미확인
    assert b.barrier_cause == "미확인" and f1_cross.repeated_barrier([a, b]) is None
    x = second(MEMO, "기타", "서류를 못 떼겠다며 미룸")
    y = second(M2, "기타", "서류 준비가 어렵다며 신청을 미룸")
    assert f1_cross.repeated_barrier([x, y]) is None  # '기타'끼리는 같은 원인으로 보지 않는다


def test_summary_partial():
    assert f1_cross.summary("건강", 2, 3) == "3차례 중 두 차례 건강 문제로 신청을 미룸"


def test_baseline_quotes_are_verbatim():
    res = f1_baseline.classify(MEMO)
    check_quotes(MEMO, res.evidence)
    assert res.work_status == "종결" and res.closure_type == "D1" and res.consent.문자 == "동의"
    assert res.barrier_cause == "서류·절차" and res.quotes("barrier_cause")


@pytest.mark.parametrize("memo,cause", [
    ("기초생활 안내함. 무릎이 아파 다니기 어렵다며 신청을 미룸. 상담안내 종결.", "건강"),
    ("긴급복지 안내함. 일하느라 평일엔 못 온다며 나중에 하겠다고 함. 상담안내 종결.", "시간·생계"),
    ("소득 기준 초과 확인. 기준초과로 종결.", "해당없음")])
def test_baseline_cause(memo, cause):
    assert f1_baseline.classify(memo).barrier_cause == cause


# ---------- 거부 가드: 거부는 코드가 지킨다 ----------
@pytest.mark.parametrize("memo,ch", [
    ("세 번 방문함. 다시는 찾아오지 말라고 함. 조사불가로 종결.", "방문"),
    ("집으로 오는 것은 원하지 않는다고 함. 상담안내 종결.", "방문"),
    ("방문은 거절함. 상담안내 종결.", "방문"),
    ("앞으로 문자도 보내지 말라고 함. 상담안내 종결.", "문자"),
    ("문자는 받지 않겠다고 함. 상담안내 종결.", "문자"),
    ("전화하지 말라며 끊음. 상담안내 종결.", "전화"),
    ("긴급지원 안내했으나 신청은 안 하겠다고 함. 상담안내 종결.", "신청"),
    ("지원 신청은 생각이 없다고 함. 상담안내 종결.", "신청"),
    ("필요 없다며 거절함. 상담안내 종결.", "신청")])
def test_refusal_guard_raises_to_refuse(memo, ch):
    res, moved = f1_classify.refusal_guard(memo, f1_classify.fallback("m", "r"))
    assert moved == [ch] and getattr(res.consent, ch) == "거부" and res.consent_guard
    ev = [e for e in res.evidence if e.field == f"consent.{ch}"]
    assert len(ev) == 1 and memo[ev[0].start:ev[0].end] == ev[0].quote


@pytest.mark.parametrize("memo", [
    MEMO, "문자 안내는 괜찮다고 함. 상담안내 종결.", "다시 방문하는 건 괜찮다고 함. 상담안내 종결.",
    "문자로만 달라고 함. 상담안내 종결.", "아직 신청 안 했다고 함. 상담안내 종결."])
def test_refusal_guard_leaves_non_refusals(memo):
    base = f1_classify.fallback("m", "r")
    res, moved = f1_classify.refusal_guard(memo, base)
    assert moved == [] and res == base


def test_refusal_guard_overrides_llm_consent_but_never_lowers_refusal():
    memo = "문자는 괜찮다고 했다가 문자도 보내지 말라고 함. 상담안내 종결."
    a, _ = build_result(memo, out(closure_type="D2", closure_type_quote="상담안내 종결", barrier_cause="해당없음",
                                  barrier_cause_quote="", 신청="미확인", 신청_quote="", 문자="동의",
                                  문자_quote="문자는 괜찮다고 했다가"), "m")
    assert a.consent.문자 == "동의"
    g, moved = f1_classify.refusal_guard(memo, a)
    assert g.consent.문자 == "거부" and moved == ["문자"]
    assert [e.quote for e in g.evidence if e.field == "consent.문자"] == ["문자는 괜찮다고 했다가 문자도 보내지 말라고 함"]
    b, _ = build_result(MEMO, out(문자="거부", 문자_quote="문자는 받겠다고 함"), "m")
    assert f1_classify.refusal_guard(MEMO, b)[0].consent.문자 == "거부"  # 거부에서 내리지 않는다


def test_classify_applies_guard_and_keeps_unguarded(fake):
    memo = "찾아오지 말라고 함. 상담안내 종결."
    fake(out(work_status_quote="상담안내 종결", closure_type="D2", closure_type_quote="상담안내 종결",
             barrier_cause="해당없음", barrier_cause_quote="", 신청="미확인", 신청_quote="", 문자="미확인",
             문자_quote="").model_dump_json())
    res, info = classify(memo, "m")
    assert res.consent.방문 == "거부" and info["consent_guard"] == ["방문"]
    assert info["unguarded"].consent.방문 == "미확인"
