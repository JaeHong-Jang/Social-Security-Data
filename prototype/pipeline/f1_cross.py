"""F1 회차 교차: 반복 장벽(repeated_barrier). 추가 LLM 호출 없이 회차별 F1 결과에 규칙을 적용한다.

규칙(v2, 2차 심사 반영): 서로 다른 메모 2건 이상에서 **장벽 원인(barrier_cause)이 같고**, 각 메모에 그 원인의
근거 인용이 있으면 반복 장벽이다. 종결 유형(D1 등)만 같은 것은 반복 장벽이 아니다.
- 셀 수 있는 원인: 서류·절차 / 건강 / 시간·생계. '기타'끼리는 같은 원인이라 볼 수 없어 세지 않는다.
- 여러 원인이 해당하면 메모 수가 많은 쪽, 같으면 서류·절차 → 건강 → 시간·생계 순.
- 화면 문구(summary)는 원인에서 만든다. 예: "두 차례 모두 서류·절차 부담으로 신청을 미룸".
"""
from prototype.api.schemas_v2 import F1ResultV2, MemoQuote, RepeatedBarrier

RULE = "rule:f1_cross_v2"
CAUSES = ("서류·절차", "건강", "시간·생계")
PHRASE = {"서류·절차": "서류·절차 부담으로", "건강": "건강 문제로", "시간·생계": "시간·생계 사정으로"}
COUNT = {2: "두", 3: "세", 4: "네", 5: "다섯"}


def summary(cause: str, hits: int, total: int) -> str:
    n = COUNT.get(hits, str(hits))
    head = f"{n} 차례 모두" if hits == total else f"{total}차례 중 {n} 차례"
    return f"{head} {PHRASE[cause]} 신청을 미룸"


def repeated_barrier(f1s: list[F1ResultV2]) -> RepeatedBarrier | None:
    """f1s: 가구 메모 순서대로의 F1 결과. 인용 위치는 각 F1 evidence(field=barrier_cause)의 start/end를 쓴다."""
    hits: dict[str, list[MemoQuote]] = {}
    for i, f in enumerate(f1s):
        ev = next((e for e in f.evidence if e.field == "barrier_cause"), None)
        if f.barrier_cause in CAUSES and ev:
            hits.setdefault(f.barrier_cause, []).append(
                MemoQuote(memo_index=i, quote=ev.quote, start=ev.start, end=ev.end))
    best = sorted((k for k in hits if len(hits[k]) >= 2), key=lambda k: (-len(hits[k]), CAUSES.index(k)))
    if not best:
        return None
    k = best[0]
    models = sorted({f1s[q.memo_index].model for q in hits[k]})
    return RepeatedBarrier(cause=k, summary=summary(k, len(hits[k]), len(f1s)), quotes=hits[k],
                           model=f"{RULE}(" + ",".join(models) + ")")
