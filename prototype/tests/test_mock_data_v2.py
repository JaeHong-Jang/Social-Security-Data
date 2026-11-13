import json
from pathlib import Path

from prototype.api.schemas_v2 import CaseFileV2
from prototype.pipeline.f2_priority_v2 import score, suggest_action
from prototype.pipeline.f3_match import found_by_tag_filter, household_tags

ROOT = Path(__file__).resolve().parents[2]
DATA = CaseFileV2.model_validate_json((ROOT / "prototype/web/mock/households.v2.json").read_text(encoding="utf-8"))
CACHE = {it["servId"]: it for it in
         json.loads((ROOT / "data/cache/local_서울특별시.json").read_text(encoding="utf-8"))["items"]}


def test_sixteen_households_reference_date():
    assert len(DATA.cases) == 16 and DATA.meta["reference_date"] == "2026-11-13"
    for c in DATA.cases:
        assert all(m.written_at.year == 2026 for m in c.household.memos)
        assert str(c.household.reference_date) == "2026-11-13"


def test_f2_and_action_recomputed_by_code():
    for c in DATA.cases:
        assert c.f2 == score(c.household)
        assert c.action == suggest_action(c.household, c.f2, n_candidates=len(c.f3.candidates))


def test_f3_quotes_and_tag_flag_from_cache():
    for c in DATA.cases:
        tags = household_tags(c.household)
        assert c.f3.tag_filter == tags and len(c.f3.candidates) <= 3
        for cand in c.f3.candidates:
            d = CACHE[cand.serv_id]["detail"]
            assert cand.name == d["servNm"]
            assert cand.criteria_quote in d.get("sprtTrgtCn", "") + "\n" + d.get("slctCritCn", "")
            assert cand.found_by_tag_filter == found_by_tag_filter(tags, CACHE[cand.serv_id])


def test_required_scenarios_present():
    cs = {c.household.id: c for c in DATA.cases}
    rb = [c for c in DATA.cases if c.household.repeated_barrier and c.household.repeated_barrier.cause == "서류·절차"]
    assert rb and all(len({q.memo_index for q in c.household.repeated_barrier.quotes}) >= 2 for c in rb)
    assert sum(len(c.household.memos) >= 2 for c in DATA.cases) >= 5
    assert any(c.household.memos[-1].f1.work_status == "조사중" and "처리 확인 필요" in c.f2.flags for c in DATA.cases)
    assert any(c.household.contact_refused and c.action.safety_check and c.action.outreach == "재확인 예약"
               for c in DATA.cases)
    assert any(c.action.outreach == "안부 문자" for c in DATA.cases)
    assert any(not c.f3.candidates for c in DATA.cases)
    assert any(not x.found_by_tag_filter for c in DATA.cases for x in c.f3.candidates)
    # T 때문에 다시 올라온 가구: T를 빼면 관찰, 넣으면 주의 이상
    assert any(c.f2.level != "관찰" and not c.f2.flags and
               c.f2.total - next(i.points for i in c.f2.items if i.key == "T") < 35 for c in DATA.cases)
    assert cs["H-0412"].household.consent.신청 == "보류(장벽)"


def test_round2_fixes():
    cs = {c.household.id: c for c in DATA.cases}
    assert cs["H-0816"].household.consent.방문 == "미확인"  # '재방문 예정'은 담당자 계획
    assert all(m.closure_label == "조사불가 종결" for m in cs["H-0233"].household.memos)
    assert cs["H-0587"].household.repeated_barrier is None  # D2가 같아도 장벽 원인이 아니면 반복 장벽 아님
    for c in DATA.cases:
        assert c.f1_source == "mock" and c.f3.tag_filter_source == "mock-mapping"
        assert c.f3.notice_source == ("mock" if c.f3.notice_draft else None)
        assert all(m.closure_label for m in c.household.memos)
        if c.action.safety_check:
            assert "임대인" not in c.action.safety_check.channels
        if c.action.outreach == "재확인 예약":
            assert c.action.due == c.f2.next_check_due


def test_no_protected_attributes_in_cases():
    blob = json.dumps([c.model_dump(mode="json") for c in DATA.cases], ensure_ascii=False)
    assert "gender" not in blob and "age_band" not in blob
    assert {a.household_id for a in DATA.audit} == {c.household.id for c in DATA.cases}
