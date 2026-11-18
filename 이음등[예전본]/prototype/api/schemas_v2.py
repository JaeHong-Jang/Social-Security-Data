"""이음등 데이터 계약 v2 (Pydantic v2). v1(schemas.py)은 그대로 두고 v2를 따로 둔다.

v1 대비 바뀐 점 (근거: docs/v3_심사리뷰_개선과제.md 과제 1·4):
- 가구는 회차별 메모 이력 memos[]를 가진다. 메모마다 F1 결과가 붙는다.
- 회차를 가로지르는 F1 발견 repeated_barrier: 서로 다른 메모 2건 이상에서 같은 장벽을 인용한다.
- 관계망(support_network)은 행정값이 아니라 메모 인용에서 온다(F1).
- 신청 의사에 "보류(장벽)"을 추가한다. "서류 떼러 다닐 힘이 없다"는 거부가 아니다.
- F2 항목 키가 R·C·W·M·B·I·N·T로 바뀌고, 행동 제안은 안전 확인과 재안내로 나뉜다.
- F3는 "조건 대조"다. 후보마다 태그 검색으로 찾히는지(found_by_tag_filter)를 표시한다.
- 성별·연령·국적·장애는 Household에 없다. 편향 점검용 AuditAttributes(v1 재사용)에만 있다.

2차 심사 반영 (docs/v4_심사리뷰_2차.md):
- F1에 장벽 원인 barrier_cause를 따로 둔다. D1은 종결 '유형'일 뿐이고, 반복 장벽은 원인이 같을 때만 성립한다.
- 행동 제안 '보류'는 '재확인 예약'으로 바꾼다. 가구는 대기열에 남고 재확인일(due)이 정해진다.
- 메모마다 행정 종결 기록 라벨(closure_label)을 둔다. 타임라인은 F1 해석이 아니라 이 값을 쓴다.
- 출처 표시: 케이스 f1_source(llm/mock), F3 notice_source·tag_filter_source.
"""
from datetime import date, datetime, timedelta
from typing import Literal

from pydantic import Field, model_validator

from prototype.api.schemas import (CLOSURE_LABELS, AuditAttributes, Candidate, ClosureType, CrisisDomain, Discovery,
                                   DiscoveryResult, Evidence, Strict, check_quotes)

ApplyConsent = Literal["동의", "거부", "보류(장벽)", "미확인"]
ContactConsent = Literal["동의", "거부", "미확인"]
SupportNetwork = Literal["있음", "부재", "미확인"]
IsolationSignal = Literal["우편물 적체", "반복 부재", "단전", "단수", "기타"]
# 장벽 원인: 신청을 미루게 한 어려움. 해당없음 = 장벽 없음(기준초과·조사불가·위기 해소 등), 미확인 = 근거 인용 없음
BarrierCause = Literal["서류·절차", "건강", "시간·생계", "기타", "해당없음", "미확인"]
REAL_CAUSES = ("서류·절차", "건강", "시간·생계", "기타")  # 근거 인용(field="barrier_cause")이 필요한 값
RepeatCause = Literal["서류·절차", "건강", "시간·생계"]  # 반복 장벽으로 셀 수 있는 원인('기타'끼리는 같은 원인이라 볼 수 없다)
SignalKind = Literal["단전", "단수", "가스 차단", "공공요금 체납", "건보료 체납", "통신비 체납", "월세 체납",
                     "우편물 적체", "이웃 제보", "기타"]
ConsultType = Literal["방문 상담", "전화 상담", "내방 상담"]
Outreach = Literal["동행 신청 지원(재방문)", "심층상담(재방문)", "재방문", "안부 문자", "문자재안내", "재확인 예약"]


def admin_closure_label(result: DiscoveryResult) -> str:
    """행정 종결 기록 라벨(타임라인용). 예: C → '조사불가 종결', D → '상담안내 종결'."""
    return CLOSURE_LABELS[result] + (" 종결" if result in ("A", "B", "C") else "")


class ConsentV2(Strict):
    """연락 의사 범위. 신청의 '보류(장벽)'은 거부가 아니라 절차 부담으로 미룬 상태다."""
    신청: ApplyConsent
    문자: ContactConsent
    방문: ContactConsent
    전화: ContactConsent = "미확인"  # LLM은 뽑지 않는다. 거부 가드(코드)가 명시적 거부를 찾았을 때만 '거부'


# ---------- F1 (메모 1건) ----------
class F1ResultV2(Strict):
    work_status: Literal["조사중", "종결", "판단보류"]
    closure_type: ClosureType | None
    barrier_cause: BarrierCause = "미확인"  # 서류·절차·건강·시간·생계·기타는 근거 field="barrier_cause" 필수
    consent: ConsentV2
    consent_guard: bool = False  # 거부 가드(코드)가 메모의 명시적 거부 표현으로 연락·신청 값을 '거부'로 올렸다
    support_network: SupportNetwork = "미확인"  # 근거 인용(field="support_network")이 없으면 F2는 미확인으로 본다
    isolation_signals: list[IsolationSignal] = []  # 근거 field="isolation_signals.<값>"
    evidence: list[Evidence]
    needs_check: bool
    needs_check_reason: str | None = None  # needs_check=True면 필수 (화면 표시용 한 문장)
    model: str

    @model_validator(mode="after")
    def _rules(self):
        if self.needs_check and not (self.needs_check_reason or "").strip():
            raise ValueError("needs_check=True면 needs_check_reason이 필요하다")
        if self.work_status == "판단보류" and not self.needs_check:
            raise ValueError("판단보류는 needs_check=True여야 한다")
        if self.work_status == "종결" and self.closure_type is None:
            raise ValueError("종결이면 closure_type이 필요하다")
        if self.work_status != "판단보류" and not self.evidence:
            raise ValueError("판단보류가 아니면 근거 인용이 1개 이상 필요하다")
        if self.consent_guard and "거부" not in self.consent.model_dump().values():
            raise ValueError("consent_guard=True면 거부 값이 하나 이상 있어야 한다")
        if self.barrier_cause in REAL_CAUSES and not self.quotes("barrier_cause"):
            raise ValueError("장벽 원인에는 근거 인용(field=barrier_cause)이 필요하다. 없으면 미확인")
        return self

    def quotes(self, field: str) -> list[str]:
        return [e.quote for e in self.evidence if e.field == field]


class Memo(Strict):
    """종결 1회의 상담 메모와 그 F1 결과. 메모는 가상 데이터다."""
    discovery_date: date  # 대응하는 발굴(discoveries[].date)
    written_at: date
    consult_type: ConsultType
    text: str = Field(min_length=1)
    closure_label: str | None = None  # 행정 종결 기록(발굴 결과 코드에서 옴). 예: '조사불가 종결'. F1 해석과 별개
    f1: F1ResultV2

    @model_validator(mode="after")
    def _quotes(self):
        check_quotes(self.text, self.f1.evidence)
        return self


# ---------- F1 회차 교차 발견 ----------
class MemoQuote(Strict):
    memo_index: int = Field(ge=0)  # household.memos 안의 위치
    quote: str = Field(min_length=1)
    start: int = Field(ge=0)
    end: int

    @model_validator(mode="after")
    def _span(self):
        if self.end - self.start != len(self.quote):
            raise ValueError("end - start가 quote 길이와 다르다")
        return self


class RepeatedBarrier(Strict):
    """서로 다른 회차 메모 2건 이상에서 **같은 장벽 원인**이 인용과 함께 반복됨. 종결 유형(D1 등)만 같은 것은 아니다.
    quotes는 각 메모의 barrier_cause 근거 인용이다. summary는 원인에서 만든 화면 문구."""
    cause: RepeatCause
    summary: str = Field(min_length=1)  # 예: "두 차례 모두 서류·절차 부담으로 신청을 미룸"
    quotes: list[MemoQuote] = Field(min_length=2)
    model: str

    @model_validator(mode="after")
    def _distinct(self):
        if len({q.memo_index for q in self.quotes}) < 2:
            raise ValueError("반복 장벽은 서로 다른 메모 2건 이상의 인용이 필요하다")
        return self


class PostClosureSignal(Strict):
    """종결 이후 들어온 새 위기정보(가상). 화면 타임라인에 날짜+신호로 표시한다.
    출처는 위기정보 연계 또는 통반장 제보 등."""
    date: date
    kind: SignalKind
    domain: CrisisDomain | None
    source: str


# ---------- 가구 ----------
class HouseholdV2(Strict):
    id: str = Field(pattern=r"^H-\d{4}$")
    gu: str
    dong: str
    household_type: Literal["1인가구", "부부가구", "한부모가구", "조손가구", "다인가구"]
    discoveries: list[Discovery] = Field(min_length=1)  # 오래된 순
    memos: list[Memo] = Field(min_length=1)  # 오래된 순, 마지막이 이번 종결
    repeated_barrier: RepeatedBarrier | None = None
    post_closure_signals: list[PostClosureSignal] = []
    closed_at: date
    days_since_closure: int = Field(ge=0)  # 기준일 - closed_at
    consent: ConsentV2  # 최신 메모 F1과 같아야 한다
    contact_refused: bool  # 문자·방문 모두 거부. 점수와 분리

    @property
    def reference_date(self) -> date:
        return self.closed_at + timedelta(days=self.days_since_closure)

    @model_validator(mode="after")
    def _consistency(self):
        dd = [d.date for d in self.discoveries]
        if dd != sorted(dd):
            raise ValueError("discoveries는 날짜 오름차순이어야 한다")
        if self.closed_at < dd[-1]:
            raise ValueError("closed_at은 마지막 발굴일 이후여야 한다")
        mw = [m.written_at for m in self.memos]
        if mw != sorted(mw):
            raise ValueError("memos는 작성일 오름차순이어야 한다")
        if any(m.discovery_date not in dd for m in self.memos):
            raise ValueError("memo.discovery_date가 발굴 이력에 없다")
        res = {d.date: d.result for d in self.discoveries}
        for m in self.memos:
            if m.closure_label is not None and m.closure_label != admin_closure_label(res[m.discovery_date]):
                raise ValueError(f"closure_label이 발굴 결과 코드와 다르다: {m.closure_label!r}")
        if self.memos[-1].discovery_date != dd[-1] or self.memos[-1].written_at != self.closed_at:
            raise ValueError("마지막 메모는 마지막 발굴의 종결 메모여야 한다")
        if self.consent != self.memos[-1].f1.consent:
            raise ValueError("household.consent는 최신 메모 F1의 consent와 같아야 한다")
        if self.contact_refused != (self.consent.문자 == "거부" and self.consent.방문 == "거부"):
            raise ValueError("contact_refused는 문자·방문 모두 거부일 때만 True")
        if self.repeated_barrier:
            for q in self.repeated_barrier.quotes:
                if q.memo_index >= len(self.memos):
                    raise ValueError("repeated_barrier.memo_index 범위 초과")
                if self.memos[q.memo_index].text[q.start:q.end] != q.quote:
                    raise ValueError(f"원문에 없는 인용: {q.quote!r}")
                if self.memos[q.memo_index].f1.barrier_cause != self.repeated_barrier.cause:
                    raise ValueError("반복 장벽 인용 메모의 barrier_cause가 반복 원인과 다르다")
        for s in self.post_closure_signals:
            if not (self.closed_at < s.date <= self.reference_date):
                raise ValueError("종결 후 신호는 종결일 이후 ~ 기준일 사이여야 한다")
        return self


# ---------- F2 ----------
F2Key = Literal["R", "C", "W", "M", "B", "I", "N", "T"]


class F2ItemV2(Strict):
    key: F2Key
    label: str
    source: Literal["행정", "F1", "행정+F1"]
    points: int = Field(ge=0)
    max: int
    chip: str = Field(max_length=14)
    reason: str
    unknown: bool = False  # 미확인: 판단 근거가 없어 0점. 화면에서 '0점(해당 없음)'과 구분 표시
    evidence: list[str] = []  # F1 유래 점수의 메모 원문 인용

    @model_validator(mode="after")
    def _rules(self):
        if self.points > self.max:
            raise ValueError("points가 max를 넘는다")
        if self.unknown and self.points != 0:
            raise ValueError("unknown 항목은 0점이어야 한다")
        if self.source == "F1" and self.points > 0 and not self.evidence:
            raise ValueError("F1 유래 점수에는 근거 인용이 필요하다")
        return self


class F2ResultV2(Strict):
    total: int = Field(ge=0, le=100)
    items: list[F2ItemV2]
    level: Literal["긴급", "주의", "관찰"]
    flags: list[str] = []  # 예: "처리 확인 필요" → 등급 '주의' 이상 강제
    next_check_due: date  # 최소 재확인일
    excluded_attributes: list[str] = ["성별", "연령", "국적", "장애"]
    rule_version: str

    @model_validator(mode="after")
    def _sum(self):
        if self.total != sum(i.points for i in self.items):
            raise ValueError("total이 항목 점수 합과 다르다")
        if "처리 확인 필요" in self.flags and self.level == "관찰":
            raise ValueError("처리 확인 필요 플래그가 있으면 등급은 주의 이상이다")
        return self


# ---------- 행동 제안 (규칙, LLM 아님) ----------
class SafetyCheck(Strict):
    """안전 확인: 본인 연락이 아니라 주변 경로로 안부를 확인한다. 연락 거부와 무관하게 켜진다."""
    channels: list[str] = Field(min_length=1)
    triggers: list[str] = Field(min_length=1)
    reason: str


class ActionSuggestion(Strict):
    outreach: Outreach
    outreach_reason: str = Field(min_length=1)  # 재확인 예약도 반드시 사유가 있다
    due: date | None = None
    safety_check: SafetyCheck | None = None
    consent_note: str


class DecisionV2(Strict):
    status: Literal["미검토"] | Outreach
    by: str | None = None
    at: datetime | None = None
    reason: str | None = None
    ai_suggestion: Outreach
    agrees_with_ai: bool | None = None

    @model_validator(mode="after")
    def _rules(self):
        if self.status == "미검토":
            self.agrees_with_ai = None
            return self
        if not (self.by and self.at):
            raise ValueError("결정에는 by와 at이 필요하다")
        self.agrees_with_ai = self.status == self.ai_suggestion
        if not self.agrees_with_ai and not (self.reason or "").strip():
            raise ValueError("AI 제안과 다른 결정에는 reason이 필요하다")
        return self


# ---------- F3 조건 대조 ----------
class CandidateV2(Candidate):
    found_by_tag_filter: bool  # False면 화면에 "태그 검색으로는 안 나온 사업" 배지


class ChecksNarrowed(Strict):
    total: int = Field(ge=0)
    충족: int = Field(ge=0)
    미충족: int = Field(ge=0)
    확인필요: int = Field(ge=0)
    summary: str

    @model_validator(mode="after")
    def _sum(self):
        if self.total != self.충족 + self.미충족 + self.확인필요:
            raise ValueError("checks_narrowed 합이 맞지 않는다")
        return self


class F3ResultV2(Strict):
    concept: Literal["조건 대조"] = "조건 대조"
    candidates: list[CandidateV2] = Field(max_length=3)  # 0개 허용
    checks_narrowed: ChecksNarrowed
    tag_filter: dict[str, list[str]]  # 태그 검색에 쓴 가구 태그 (themes, targets)
    tag_filter_source: Literal["mock-mapping"] = "mock-mapping"  # 태그 매핑(f3_match)은 가설 규칙이다
    notice_draft: str | None
    notice_source: Literal["mock", "llm"] | None = "mock"  # 안내문 초안 출처. 지금은 손으로 쓴 mock
    model: str


# ---------- 화면 단위 ----------
class HouseholdCaseV2(Strict):
    f1_source: Literal["llm", "mock"] = "mock"  # 메모 F1·반복 장벽이 실제 모델 출력(llm)인지 손 라벨(mock)인지
    household: HouseholdV2
    f2: F2ResultV2
    action: ActionSuggestion
    f3: F3ResultV2
    decision: DecisionV2

    @model_validator(mode="after")
    def _consistency(self):
        if self.decision.ai_suggestion != self.action.outreach:
            raise ValueError("decision.ai_suggestion은 action.outreach와 같아야 한다")
        if self.action.outreach == "재확인 예약" and self.action.due != self.f2.next_check_due:
            raise ValueError("재확인 예약의 due는 f2.next_check_due여야 한다")
        models = {m.f1.model for m in self.household.memos}
        if self.f1_source == "llm" and "mock" in models:
            raise ValueError("f1_source=llm인데 mock F1이 섞여 있다")
        if self.f1_source == "mock" and models != {"mock"}:
            raise ValueError("f1_source=mock인데 모델 F1이 있다")
        return self


class CaseFileV2(Strict):
    meta: dict
    cases: list[HouseholdCaseV2]
    audit: list[AuditAttributes]
