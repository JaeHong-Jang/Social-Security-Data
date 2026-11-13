"""households.v3.json: F1이 실제 LLM 출력이고 손으로 고치지 않았음을 확인한다(Ollama 없이 돈다)."""
from pathlib import Path

from prototype.api.schemas_v2 import CaseFileV2, F1ResultV2
from prototype.pipeline import f1_classify, f1_cross
from prototype.pipeline.f1_classify import F1LLMOut, build_result
from prototype.pipeline.f2_priority_v2 import score, suggest_action

ROOT = Path(__file__).resolve().parents[2]
DATA = CaseFileV2.model_validate_json((ROOT / "prototype/web/mock/households.v3.json").read_text(encoding="utf-8"))
META = DATA.meta


def test_meta_records_model_prompt_latency():
    assert META["f1_source"] == "llm" and META["f1_model"] == META["f1_model_info"]["model"]
    assert META["f1_model_info"]["digest"] and META["f1_model_info"]["ollama_version"]
    assert META["f1_prompt_version"] == f1_classify.PROMPT_VERSION  # 프롬프트가 바뀌면 v3를 다시 만들어야 한다
    assert META["f1_latency"]["n_memos"] == sum(len(c.household.memos) for c in DATA.cases)
    assert all(r["latency_s"] is not None for r in META["f1_runs"])


def test_f1_is_unedited_model_output():
    runs = {(r["household_id"], r["memo_index"]): r for r in META["f1_runs"]}
    for c in DATA.cases:
        assert c.f1_source == "llm"
        for i, m in enumerate(c.household.memos):
            assert m.f1.model == META["f1_model"]
            r = runs[(c.household.id, i)]
            if r["llm_ok"]:
                again, _ = build_result(m.text, F1LLMOut.model_validate(r["raw"]), META["f1_model"])
                again, moved = f1_classify.refusal_guard(m.text, again)  # 거부 가드는 코드 규칙이라 재현된다
                assert again == m.f1 and moved == r["consent_guard"], (c.household.id, i)
            else:
                assert m.f1.work_status == "판단보류" and m.f1.needs_check


def test_cross_f2_action_recomputed_from_real_f1():
    for c in DATA.cases:
        h = c.household
        assert h.repeated_barrier == f1_cross.repeated_barrier([m.f1 for m in h.memos])
        assert c.f2 == score(h)
        assert c.action == suggest_action(h, c.f2, n_candidates=len(c.f3.candidates))


def test_sources_and_round2_fixes():
    cs = {c.household.id: c for c in DATA.cases}
    assert all(m.closure_label == "조사불가 종결" for m in cs["H-0233"].household.memos)
    for c in DATA.cases:
        assert c.f3.tag_filter_source == "mock-mapping"
        assert c.f3.notice_source == ("mock" if c.f3.notice_draft else None)
        if c.action.safety_check:
            assert c.action.safety_check.channels == ["통반장", "명예사회복지공무원"]
        rb = c.household.repeated_barrier
        if rb:  # 반복 장벽 인용 메모는 모두 같은 원인
            assert {c.household.memos[q.memo_index].f1.barrier_cause for q in rb.quotes} == {rb.cause}
    assert isinstance(cs["H-0412"].household.memos[0].f1, F1ResultV2)


def test_h0233_refusal_kept_by_code_guard():
    c = next(c for c in DATA.cases if c.household.id == "H-0233")
    assert c.household.contact_refused and c.household.memos[-1].f1.consent_guard
    assert c.action.outreach == "재확인 예약" and c.action.safety_check
