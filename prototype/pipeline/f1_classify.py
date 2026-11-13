"""F1 메모 읽기: 상담 메모 1건 → F1ResultV2.

LLM은 값과 인용 구절만 낸다. 인용 위치(start/end)는 코드가 원문에서 직접 찾는다.
- 원문에 없는 인용은 버린다. 근거가 버려진 항목은 미확인(종결 사유면 None)이 되고 needs_check=True.
- 종결인데 종결 사유 근거가 없으면 업무상태를 판단보류로 내린다(스키마: 종결이면 사유 필수).
- LLM 호출·형식 검사가 끝내 실패하면 판단보류 + needs_check.
- 장벽 원인(barrier_cause)도 원문 인용이 있어야 한다. 인용이 버려지면 미확인.
- 연락 동의 귀속 검사: 문자·방문 '동의'의 인용이 담당자의 계획·행동("재방문 예정", "문자 발송함")으로만
  보이고 본인의 말 표지가 없으면 동의를 버리고 미확인으로 둔다(staff_plan).

거부는 코드가 지킨다 (refusal_guard):
  명시적 거부를 놓치는 것이 가장 비싼 오류다(싫다고 한 사람에게 연락하게 된다). 그래서 LLM 뒤에 코드 규칙이
  메모 원문에서 경로별 명시적 거부 표현(REFUSAL: 방문·문자·전화·신청)을 찾고, 찾으면 그 경로를 '거부'로 올린다.
  근거 인용은 일치한 표현이 든 원문 구(句) 그대로이며 consent_guard=True로 표시한다. 가드는 '거부' 쪽으로만 움직이고
  '거부'를 다른 값으로 바꾸지 않는다. 일반 표현만 쓰며(특정 메모 문장 맞춤 아님), 부정·인용 문맥 때문에 생길 수 있는
  거짓 거부는 연락을 덜 하는 쪽이라 감수한다. 담당자는 화면에서 인용을 보고 확인한다.
"""
import hashlib
import re
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from prototype.api.schemas import Evidence
from prototype.api.schemas_v2 import (ApplyConsent, BarrierCause, ContactConsent, F1ResultV2, IsolationSignal,
                                      SupportNetwork)
from prototype.llm.ollama import generate_structured

PROMPT_FILE = "prototype/prompts/f1_memo.md"
PROMPT = (Path(__file__).resolve().parents[1] / "prompts" / "f1_memo.md").read_text(encoding="utf-8")
PROMPT_VERSION = "r3-" + hashlib.sha256(PROMPT.encode()).hexdigest()[:10]  # r3: 장벽 원인·동의 귀속 추가
# 담당자 계획·행동 표지(문장 끝)와 본인 말 표지. 동의 인용이 앞에 해당하고 뒤가 없으면 동의로 보지 않는다.
_STAFF_PLAN = re.compile(r"(예정|하기로 함|하기로 했음|하기로 하였음|발송함|발송했음|보냄|보내 드림|안내함|남기고 옴)[.\s]*$")
_RESIDENT_SAYS = re.compile(r"(다고|라고|달라|하심|하셨|원함|원하|요청|좋겠|괜찮|받겠|싫|동의)")
_STRIP = " \t\n\"'“”‘’「」『』"


class IsoOut(BaseModel):
    quote: str
    value: IsolationSignal


class F1LLMOut(BaseModel):
    """LLM 출력 계약. 각 항목은 근거 구절을 먼저 쓰고 값을 쓴다."""
    work_status_quote: str
    work_status: Literal["조사중", "종결", "판단보류"]
    closure_type_quote: str
    closure_type: Literal["A", "B", "C", "D1", "D2", "D3", "없음"]
    barrier_cause_quote: str
    barrier_cause: BarrierCause
    신청_quote: str
    신청: ApplyConsent
    문자_quote: str
    문자: ContactConsent
    방문_quote: str
    방문: ContactConsent
    support_network_quote: str
    support_network: SupportNetwork
    isolation_signals: list[IsoOut]


def locate(memo: str, quote: str) -> tuple[int, int] | None:
    """인용의 원문 위치. 정확 일치 → 공백 정규화 일치 순. 없으면 None."""
    q = quote.strip(_STRIP).rstrip(".。")
    if not q:
        return None
    i = memo.find(q)
    if i >= 0:
        return i, i + len(q)
    # 공백 정규화: 연속 공백을 한 칸으로 줄인 원문에서 찾고 원래 위치로 되돌린다
    chars, idx = [], []
    for j, ch in enumerate(memo):
        if ch.isspace():
            if chars and chars[-1] == " ":
                continue
            ch = " "
        chars.append(ch)
        idx.append(j)
    k = "".join(chars).find(re.sub(r"\s+", " ", q))
    if k < 0:
        return None
    nq = len(re.sub(r"\s+", " ", q))
    return idx[k], idx[k + nq - 1] + 1


# 경로별 명시적 거부 표현(일반 패턴). 위에서부터 처음 일치한 것을 근거로 쓴다.
_P = r"\S{0,2}\s*"  # 조사(도·는·를·로·은·을) 자리
REFUSAL = {
    "방문": [r"(찾아\s*오지|오지|방문하지|들르지|오시지)\s*(말|마)",
             r"방문" + _P + r"(거절|거부|사절|싫|원하지\s*않)",
             r"(집|댁)" + _P + r"(찾아\s*)?(오는|방문하는)\s*(건|것)" + _P + r"(싫|원하지\s*않)"],
    "문자": [r"문자" + _P + r"(보내지|하지|주지)\s*(말|마)", r"문자" + _P + r"(거절|거부|사절|싫|받지\s*않|안\s*받)"],
    "전화": [r"전화" + _P + r"(하지|걸지|주지)\s*(말|마)", r"전화" + _P + r"(거절|거부|사절|싫|받지\s*않|안\s*받)"],
    "신청": [r"신청" + _P + r"(안\s*하겠|안\s*할\s*(것|거|생각)|하지\s*않겠|안\s*한다고|하고\s*싶지\s*않|거부|거절)",
             r"신청" + _P + r"(할\s*|하실\s*)?생각" + _P + r"없",
             r"(필요\s*없다|됐다)" + _P + r"(며|고|면서)?\s*(거절|거부)"],
}


def _clause(memo: str, s: int, e: int) -> tuple[int, int]:
    """일치 구간을 그것이 든 구(문장부호 . , ! ? 줄바꿈 사이)로 넓힌다. 앞뒤 공백은 뺀다."""
    while s > 0 and memo[s - 1] not in ".,!?\n":
        s -= 1
    while e < len(memo) and memo[e] not in ".,!?\n":
        e += 1
    while memo[s].isspace():
        s += 1
    return s, e


def refusal_guard(memo: str, res: F1ResultV2) -> tuple[F1ResultV2, list[str]]:
    """거부는 코드가 지킨다: 명시적 거부 표현이 있으면 그 경로를 '거부'로 올린다(거부에서 내리지는 않는다).
    → (결과, 올린 경로 목록)."""
    hits = {}
    for ch, pats in REFUSAL.items():
        m = next((m for p in pats if (m := re.search(p, memo))), None)
        if m and getattr(res.consent, ch) != "거부":
            hits[ch] = _clause(memo, *m.span())
    if not hits:
        return res, []
    d = res.model_dump()
    d["consent"] |= {ch: "거부" for ch in hits}
    d["evidence"] = [e for e in d["evidence"] if e["field"] not in {f"consent.{ch}" for ch in hits}] + [
        {"field": f"consent.{ch}", "quote": memo[s:e], "start": s, "end": e} for ch, (s, e) in hits.items()]
    d["consent_guard"] = True
    return F1ResultV2.model_validate(d), list(hits)


def staff_plan(quote: str) -> bool:
    """인용이 담당자의 계획·행동만 적은 구절인가(본인 말 표지 없음). 예: '다음 주 서류 받으러 재방문 예정'."""
    q = quote.strip(_STRIP)
    return bool(_STAFF_PLAN.search(q)) and not _RESIDENT_SAYS.search(q)


def build_result(memo: str, out: F1LLMOut, model: str) -> tuple[F1ResultV2, dict]:
    """LLM 출력 + 원문 → 검증된 F1ResultV2. info에 제안·검증된 인용 수와 버린 항목을 담는다."""
    ev: list[Evidence] = []
    dropped: list[str] = []
    info = {"quotes_proposed": 0, "quotes_verified": 0}

    def support(field: str, value: str, quote: str, empty: str) -> bool:
        """값이 '미확인/없음'이 아니면 원문 인용이 있어야 한다. 있으면 Evidence 추가."""
        if value == empty:
            return True
        if quote.strip(_STRIP):
            info["quotes_proposed"] += 1
        span = locate(memo, quote)
        if span is None:
            dropped.append(field)
            return False
        info["quotes_verified"] += 1
        ev.append(Evidence(field=field, quote=memo[span[0]:span[1]], start=span[0], end=span[1]))
        return True

    ws = out.work_status
    if ws == "조사중" and not support("work_status", ws, out.work_status_quote, ""):
        ws = "판단보류"
    elif ws == "종결" and out.work_status_quote.strip(_STRIP):
        support("work_status", ws, out.work_status_quote, "")  # 종결은 종결 사유 인용으로도 뒷받침된다

    ct = None if out.closure_type == "없음" else out.closure_type
    if ct and not support("closure_type", ct, out.closure_type_quote, ""):
        ct = None
    no_closure = ws == "종결" and ct is None
    if no_closure:
        ws = "판단보류"

    cause = out.barrier_cause
    if cause in ("해당없음", "미확인"):
        pass
    elif not support("barrier_cause", cause, out.barrier_cause_quote, ""):
        cause = "미확인"

    consent, staff = {}, []
    for k in ("신청", "문자", "방문"):
        v, q = getattr(out, k), getattr(out, f"{k}_quote")
        if k != "신청" and v == "동의" and staff_plan(q):
            staff.append(k)
            v = "미확인"
        consent[k] = v if support(f"consent.{k}", v, q, "미확인") else "미확인"
    net = out.support_network
    if not support("support_network", net, out.support_network_quote, "미확인"):
        net = "미확인"
    iso = []
    for s in out.isolation_signals:
        if s.value not in iso and support(f"isolation_signals.{s.value}", s.value, s.quote, ""):
            iso.append(s.value)

    reasons = []
    if out.work_status == "판단보류":
        reasons.append("모델이 메모만으로 업무상태를 판단하지 못했습니다")
    if no_closure:
        reasons.append("종결로 읽었으나 근거가 있는 종결 사유가 없어 판단보류로 둡니다")
    if dropped:
        reasons.append("근거 인용을 원문에서 찾지 못해 미확인 처리: " + ", ".join(dict.fromkeys(dropped)))
    if staff:
        reasons.append("담당자 계획으로 보이는 구절이라 본인 동의로 보지 않음: " + ", ".join(staff))
    info["dropped"] = list(dict.fromkeys(dropped))
    info["staff_plan_guard"] = staff
    res = F1ResultV2(work_status=ws, closure_type=ct, barrier_cause=cause, consent=consent, support_network=net,
                     isolation_signals=iso, evidence=ev, needs_check=bool(reasons) or ws == "판단보류",
                     needs_check_reason=" / ".join(reasons) or None, model=model)
    return res, info


def fallback(model: str, reason: str) -> F1ResultV2:
    return F1ResultV2(work_status="판단보류", closure_type=None, barrier_cause="미확인",
                      consent={"신청": "미확인", "문자": "미확인", "방문": "미확인"},
                      evidence=[], needs_check=True, needs_check_reason=reason, model=model)


def extract(memo: str, model: str) -> tuple[F1LLMOut | None, dict, Exception | None]:
    """LLM 단계만(느린 부분). 예외를 내지 않는다. → (LLM 출력 또는 None, meta, 오류 또는 None)."""
    try:
        out, meta = generate_structured(model, PROMPT, f"메모: {memo}", F1LLMOut)
        return out, meta, None
    except Exception as e:  # 연결·시간초과·형식 검사 실패 모두 판단보류로
        return None, getattr(e, "meta", {"model": model, "latency_s": None, "attempts": 0}), e


def finalize(memo: str, model: str, out: F1LLMOut | None, meta: dict, err: Exception | None) -> tuple[F1ResultV2, dict]:
    """코드 단계: 인용 원문 대조(build_result) → 거부 가드. info에 각 단계 소요(ms)도 담는다."""
    t0 = time.perf_counter()
    if out is None:
        res = fallback(model, f"AI 분류 실패({type(err).__name__}) — 담당자가 직접 확인해 주세요")
        info = {"llm_ok": False, "error": str(err)[:300], "quotes_proposed": 0, "quotes_verified": 0,
                "dropped": [], "staff_plan_guard": []}
    else:
        res, info = build_result(memo, out, model)
        info |= {"llm_ok": True, "raw": out.model_dump()}
    t1 = time.perf_counter()
    guarded, moved = refusal_guard(memo, res)
    t2 = time.perf_counter()
    # unguarded: 가드 전 결과(평가에서 가드 유무 비교용, JSON에 쓰지 않는다)
    return guarded, {**meta, **info, "consent_guard": moved, "unguarded": res,
                     "quote_check_ms": round((t1 - t0) * 1000, 2), "guard_ms": round((t2 - t1) * 1000, 2)}


def classify(memo: str, model: str) -> tuple[F1ResultV2, dict]:
    """메모 1건 분류. 실패해도 예외를 내지 않고 판단보류를 돌려준다. info: 지연·시도·인용 통계."""
    return finalize(memo, model, *extract(memo, model))
