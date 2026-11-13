"""이음등 API·웹 공통 데이터 계약 (Pydantic v2). 기획 근거: docs/기획구상안.md §6.3~6.5, §7.

- 점수(F2)에 쓰는 입력은 Household에만 있다. 성별·연령은 AuditAttributes에 따로 두며 F2는 이를 참조하지 않는다.
- 연락 거부(contact_refused)는 점수와 별개로 관리한다.
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

CrisisDomain = Literal["생계", "주거", "공공요금", "건강", "금융"]
# 공식 발굴 결과 코드(국감 공개 범주 A~D). F1은 D를 D1~D3로 세분한다.
DiscoveryResult = Literal["A", "B", "C", "D", "지원연계"]
ClosureType = Literal["A", "B", "C", "D1", "D2", "D3"]
CLOSURE_LABELS = {
    "A": "기준초과", "B": "지원제외", "C": "조사불가", "D": "상담안내 종결",
    "D1": "정보만 받고 신청 대기", "D2": "욕구 불명확", "D3": "일시 위기 해소 진술", "지원연계": "지원연계",
}
ConsentValue = Literal["동의", "거부", "미확인"]
Action = Literal["재방문", "문자재안내", "보류"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- 가구 ----------
class Consent(Strict):
    """연락 의사 범위. 가구 단위 값은 최신 메모의 F1 결과에서 가져온다."""
    신청: ConsentValue
    문자: ConsentValue
    방문: ConsentValue


class Discovery(Strict):
    date: date
    crisis_domains: list[CrisisDomain]
    result: DiscoveryResult


class Household(Strict):
    id: str = Field(pattern=r"^H-\d{4}$")  # 가명 ID
    gu: str  # 자치구
    dong: str
    household_type: Literal["1인가구", "부부가구", "한부모가구", "조손가구", "다인가구"]
    support_network: Literal["있음", "부재", "미확인"]  # 도움 관계망 (F2 I 항목 입력)
    discoveries: list[Discovery] = Field(min_length=1)  # 오래된 순
    closed_at: date
    days_since_closure: int = Field(ge=0)
    consent: Consent  # 최신 메모 F1 결과와 같아야 한다 (HouseholdCase에서 검사)
    contact_refused: bool  # 문자·방문 모두 거부일 때 True. 점수와 분리, True면 연락 경로 보류

    @model_validator(mode="after")
    def _order(self):
        dates = [d.date for d in self.discoveries]
        if dates != sorted(dates):
            raise ValueError("discoveries는 날짜 오름차순이어야 한다")
        if self.closed_at < dates[-1]:
            raise ValueError("closed_at은 마지막 발굴일 이후여야 한다")
        return self


class AuditAttributes(Strict):
    """편향 점검 전용. F2 점수 계산에서 절대 참조하지 않는다."""
    household_id: str = Field(pattern=r"^H-\d{4}$")
    gender: Literal["남", "여", "미상"]
    age_band: Literal["20대", "30대", "40대", "50대", "60대", "70대", "80대 이상", "미상"]


class MemoRecord(Strict):
    text: str = Field(min_length=1)
    written_at: date


# ---------- F1 종결 기록 읽기 ----------
class Evidence(Strict):
    field: str  # 예: work_status, closure_type, consent.문자
    quote: str = Field(min_length=1)
    start: int = Field(ge=0)
    end: int

    @model_validator(mode="after")
    def _span(self):
        if self.end - self.start != len(self.quote):
            raise ValueError("end - start가 quote 길이와 다르다")
        return self


def check_quotes(memo: str, evidence: list[Evidence]) -> None:
    """근거 인용이 메모 원문의 해당 구간과 정확히 같은지 검사한다. 다르면 ValueError."""
    for e in evidence:
        if memo[e.start:e.end] != e.quote:
            raise ValueError(f"원문에 없는 인용: {e.quote!r}")


class F1Result(Strict):
    work_status: Literal["조사중", "종결", "판단보류"]
    closure_type: ClosureType | None
    consent: Consent
    evidence: list[Evidence]
    needs_check: bool
    model: str  # 모델명:버전, 손으로 쓴 예시는 "mock"

    @field_validator("evidence")
    @classmethod
    def _quotes(cls, v, info: ValidationInfo):
        memo = (info.context or {}).get("memo")
        if memo is not None:
            check_quotes(memo, v)
        return v

    @model_validator(mode="after")
    def _rules(self):
        if self.work_status == "판단보류" and not self.needs_check:
            raise ValueError("판단보류는 needs_check=True여야 한다")
        if self.work_status == "종결" and self.closure_type is None:
            raise ValueError("종결이면 closure_type이 필요하다")
        if self.work_status != "판단보류" and not self.evidence:
            raise ValueError("판단보류가 아니면 근거 인용이 1개 이상 필요하다")
        return self


# ---------- F2 재검토 우선순위 ----------
class F2Item(Strict):
    key: Literal["R", "C", "W", "F", "I"]
    label: str
    points: int = Field(ge=0)
    max: int
    chip: str = Field(max_length=14)  # 목록 화면용 짧은 칩 문구
    reason: str  # 한 문장 근거
    unknown: bool = False  # 미확인 ≠ 0점: 화면에서 구분 표시

    @model_validator(mode="after")
    def _cap(self):
        if self.points > self.max:
            raise ValueError("points가 max를 넘는다")
        return self


class F2Result(Strict):
    total: int = Field(ge=0, le=100)
    items: list[F2Item]
    level: Literal["긴급", "주의", "관찰"]
    excluded_attributes: list[str] = ["성별", "연령", "국적", "장애"]
    rule_version: str

    @model_validator(mode="after")
    def _sum(self):
        if self.total != sum(i.points for i in self.items):
            raise ValueError("total이 항목 점수 합과 다르다")
        return self


# ---------- F3 맞춤 재안내 ----------
class Check(Strict):
    condition: str
    status: Literal["충족", "미충족", "확인필요"]
    evidence: str


class Candidate(Strict):
    serv_id: str
    name: str
    org: str
    source: Literal["중앙", "지자체"]
    criteria_quote: str = Field(min_length=1)  # 정보원 API 지원대상·선정기준 원문 그대로
    checks: list[Check]
    apply_method: str
    contact: str
    fetched_at: datetime


class F3Result(Strict):
    candidates: list[Candidate] = Field(max_length=3)  # 0개 허용
    notice_draft: str | None  # AI 생성 안내문 초안. 후보 0개면 None
    model: str


# ---------- F4 검토·결과 기록 ----------
class Decision(Strict):
    status: Literal["미검토"] | Action
    by: str | None = None
    at: datetime | None = None
    reason: str | None = None
    ai_suggestion: Action  # 시스템 제안. 규칙: pipeline.f2_priority.suggest_action (LLM 아님)
    agrees_with_ai: bool | None = None  # 검증 시 자동 계산

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


# ---------- 화면 단위 묶음 ----------
class HouseholdCase(Strict):
    household: Household
    memo: MemoRecord
    f1: F1Result
    f2: F2Result
    f3: F3Result
    decision: Decision

    @model_validator(mode="after")
    def _consistency(self):
        check_quotes(self.memo.text, self.f1.evidence)
        c = self.household.consent
        if c != self.f1.consent:
            raise ValueError("household.consent는 최신 메모 F1의 consent와 같아야 한다")
        if self.household.contact_refused != (c.문자 == "거부" and c.방문 == "거부"):
            raise ValueError("contact_refused는 문자·방문 모두 거부일 때만 True")
        return self


class CaseFile(Strict):
    """households.json 전체. audit은 cases와 분리된 최상위 목록이다."""
    meta: dict
    cases: list[HouseholdCase]
    audit: list[AuditAttributes]
