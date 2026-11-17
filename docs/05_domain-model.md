# 도메인 모델 v0.1

기준: [기초설계](superpowers/specs/2026-11-17-ordinance-impact-design.md). 아래는 구현 계약 초안이며 데이터베이스·API가 이미 존재한다는 뜻이 아니다.

## 1. 용어와 경계

- **법규:** 지자체의 특정 조례라는 식별 대상. 이름이 같아도 관할이 다르면 다른 대상이다.
- **법규 버전:** 특정 개정 시점의 원문. 공포일·시행일·부칙과 함께 보존한다.
- **복지사업:** 제공 기관과 서비스 ID로 식별한 사업. 개인의 수급 자격과 구분한다.
- **안내자료:** 특정 사업을 설명하는 공개 문서. 현재 안내·시기 한정 공고·보관 자료를 구분한다.
- **변경 사건:** 법규의 이전 버전과 개정 버전을 비교하는 단위.
- **영향 검토 건:** 변경 사건과 사업·안내자료를 연결해 적용 여부와 정정 필요성을 검토하는 단위.
- **분석 회차:** 같은 검토 건에서 근거·관계·판단 기준일이 바뀔 때 생성하는 불변 분석 단위.
- **정정 초안:** 특정 안내자료 버전에 대한 문구 제안. 승인된 초안도 외부 게시 상태를 뜻하지 않는다.

## 2. 핵심 엔터티

| 엔터티 | 주요 필드 | 관계·제약 |
|---|---|---|
| LegalInstrument | 내부 ID, 관할 코드, 정식명, 외부 식별자와 이력 | 내부 ID는 제공기관 식별자와 분리. 이름만으로 자동 병합 금지 |
| SourceDocument | ID, 유형, 원문 URL, 제공기관, 관리 책임 역할, 자료 대상 시기 | 법규·사업 설명·HTML 안내·수동 등록 첨부 텍스트 |
| SourceSnapshot | 문서 ID, 원문 바이트 해시, 추출 텍스트 해시, 수집 시각, 저장 위치, 파서 버전 | 수정하지 않는 원문과 추출 텍스트. 실패 응답은 정상 스냅샷으로 저장하지 않음 |
| OrdinanceVersion | 법규 ID, 스냅샷 ID, 외부 ID/MST, 공포·시행 정보, 연혁 관계 | 법규 1:N 버전. 이전 버전 미확보 시 비교 완료 아님 |
| Provision | 버전 ID, 조문 번호·제목·본문, 부칙/별표 구분, 원문 위치 | 조문 번호만으로 버전 간 동일성을 확정하지 않음 |
| WelfareService | 제공기관, servId, 사업명, 관할, 담당 부서, 상세 스냅샷 ID | 제공기관+servId 유일성. 사업 시행 기간 별도 보존 |
| ServiceLegalLink | 사업 ID, 법규 ID, 연결 근거 스냅샷, 상태, 확인자·시각·사유 | CANDIDATE / CONFIRMED / REJECTED. 이름 유사도는 후보 근거만 됨 |
| ServiceGuidanceLink | 사업 ID, 안내자료 ID, 연결 상태·근거·확인자 | 한 자료가 복수 사업을 설명할 수 있음. 비교 대상 문단 범위 보존 |
| AmendmentEvent | 법규 ID, 이전·개정 버전 ID, 발견 시각 | 같은 버전쌍은 중복 사건으로 만들지 않음 |
| ConditionChange | 사건 ID, 조건 유형, 전후 값·단위·경계 연산자, 양쪽 인용 | 변경·이동·표현 변경·미확인 분류. 복합 조건은 원문 보존 |
| ImpactCase | 사건 ID, 사업 ID, 안내자료 ID, 현재 분석 회차 ID | 사건+사업+자료별 검토 단위. 각 문단의 영향 항목은 하위에 둠 |
| AnalysisRevision | 검토 건 ID, 회차, 고정 입력 묶음, 기준일, 추출 결과, 상태, 결정 버전 | 입력·분석 결과 불변. 검토 상태는 감사 사건과 함께 갱신 |
| ApplicabilityAssessment | 분석 회차 ID, 적용 대상·시점·예외, 근거, 확인자, 결론 | APPLIES_NOW / UPCOMING / NOT_APPLICABLE / UNRESOLVED |
| CorrectionDraft | 분석 회차 ID, 초안 버전, 원문 구간·해시, 제안문, 항목별 근거 | 기존 버전 덮어쓰기 금지. 근거 있는 변경 범위만 포함 |
| ReviewDecision | analysis_revision_id, draft_version, 결정, 작성자·시각·사유 | 회차 필수. 초안 버전은 승인·초안 수정 요청 시 필수, 초안 없는 검토 제외 시 null 허용 |
| Verification | 승인 ID, 수정 후 스냅샷 ID, 확인자·시각, 결과·설명 | PENDING/FAILED/VERIFIED. 외부 수정 여부를 사람이 확인, 단순 재수집 성공과 구분 |
| AuditEvent | 사건 ID, actor, 대상·회차, 종류, 전후 상태, 시각, 요청 ID | 추가 전용. 원문 전체·키·토큰을 로그에 복제하지 않음 |

SourceDocument와 SourceSnapshot은 일반 원문 보존 계층이고 OrdinanceVersion은 법규에 필요한 날짜·연혁 정보를 추가한다. 법규 관계와 사업 설명의 연결 근거를 모두 스냅샷에 고정한다. 그래프 DB 없이 관계 테이블로 표현한다.

## 3. 관계도

~~~mermaid
erDiagram
    LegalInstrument ||--o{ OrdinanceVersion : has
    SourceDocument ||--o{ SourceSnapshot : captures
    SourceSnapshot ||--o| OrdinanceVersion : represents
    OrdinanceVersion ||--o{ Provision : contains
    LegalInstrument ||--o{ ServiceLegalLink : linked
    WelfareService ||--o{ ServiceLegalLink : confirmed_by
    WelfareService ||--o{ ServiceGuidanceLink : describes
    SourceDocument ||--o{ ServiceGuidanceLink : linked
    AmendmentEvent ||--o{ ConditionChange : includes
    AmendmentEvent ||--o{ ImpactCase : triggers
    WelfareService ||--o{ ImpactCase : affects
    SourceDocument ||--o{ ImpactCase : reviewed
    ImpactCase ||--|{ AnalysisRevision : retains
    AnalysisRevision ||--o| ApplicabilityAssessment : assesses
    AnalysisRevision ||--o{ CorrectionDraft : proposes
    AnalysisRevision ||--o{ ReviewDecision : decided
    CorrectionDraft o|--o{ ReviewDecision : reviewed
    ReviewDecision ||--o{ Verification : verifies
~~~

AmendmentEvent는 동일 법규의 이전·개정 버전 외래키 두 개를 갖는다. 그림에서 생략한 고정 입력에는 두 버전, 사업·안내 스냅샷, 연결 관계의 확인 버전이 포함된다.

## 4. 분석 회차 상태와 전이

화면 목록의 “우선 검토/시행 예정/근거 확인”은 분류다. 아래 업무 상태와 독립적으로 표시한다.

| 시작 → 결과 | 실행자 | 필수 검증 | 감사 사건 | 실패 시 |
|---|---|---|---|---|
| 생성 → NEEDS_EVIDENCE 또는 READY | 분석 작업 | 입력 버전·결손 목록·인용 검사 | AnalysisRevisionCreated | 수집·분석 실패를 변경 없음으로 처리하지 않음 |
| NEEDS_EVIDENCE → 새 회차 | 담당자+분석 작업 | 추가 근거·연결·적용 판단 기록 | EvidenceAdded, AnalysisRevisionCreated | 부족하면 새 회차도 NEEDS_EVIDENCE |
| READY → PROPOSED | 분석 작업/검토자 | 현재 회차, 초안 스키마·인용·단위 검사 | CorrectionDraftProposed | READY 유지, 실패 이유 표시 |
| PROPOSED → PROPOSED | 검토자 | 새 초안 버전, 원문 대응·인용 재검사 | CorrectionDraftRevised | 기존 유효 초안 보존 |
| PROPOSED → READY | 검토자 | 수정 요청 사유 필수 | CorrectionChangesRequested | 검증 실패 시 전이 없음 |
| PROPOSED → APPROVED | 검토자 | 아래 승인 불변식 모두 충족 | CorrectionDraftApproved | 부족한 근거는 새 회차 NEEDS_EVIDENCE; 오래된 요청은 충돌 응답 |
| READY/PROPOSED → DISMISSED | 검토자 | 미적용/실질 변화 없음 등 사유·근거 필수 | ImpactDismissed | 불확실한 건을 단순 제외할 수 없음 |
| APPROVED → VERIFIED | 검토자 | 후속 안내 스냅샷, 승인 범위 반영 확인, 다른 근거 불변·현재 회차 확인 | CorrectionVerified | 미반영/일부 반영이면 APPROVED 유지, 실패 확인 이력 추가 |
| 모든 상태 → 새 회차 | 수집 작업/검토자 | 입력·연결·적용 시점 변경 감지, 아래 수정 확인 예외 제외 | AnalysisRevisionCreated | 이전 회차와 결정은 이력으로 보존 |

- READY는 비교 근거가 갖춰졌다는 뜻이다. “현재 오류 확정”을 뜻하지 않는다.
- UPCOMING은 시행 예정 계획용 초안을 만들 수 있으나 **MVP 승인·수정 확인은 차단**한다. 시행 기준일 도달 후 근거를 재확인한 새 회차에서 승인한다.
- NOT_APPLICABLE과 실질 변화 없는 건은 근거를 남겨 DISMISSED로 종료한다.
- 자동 작업은 승인·검토 제외·수정 확인을 결정하지 않는다.
- **수정 확인 예외:** APPROVED 이후 안내자료가 바뀌면 우선 기존 승인에 대한 후속 확인 증거로 보존한다.
  승인 입력 스냅샷을 덮어쓰거나 변경된 안내문으로 승인을 승계하지 않는다.
  법규·사업 근거·연결·적용 판단이 그대로이고, 담당자가 승인 범위의 예상 수정만 확인하면 기존 회차를 VERIFIED로 종료한다.
  미반영·일부 반영은 APPROVED에 실패 이력만 추가한다. 승인 범위 밖의 실질 변경이나 다른 근거 변경은 새 회차로 재검토한다.
  자동 스캔이 발견한 변경도 동일하게 분류하며, 확인 전에는 해당 승인에 대한 다른 변경 결정을 차단한다.
- 스캔 자체의 실행 상태는 QUEUED/RUNNING/SUCCEEDED/DEGRADED/FAILED로 분리한다.
  완료 건수·실패 건수·미검사 자료를 표시한다. 전체 검사 완료 없이 전체 이상 없음 결론을 내리지 않는다.

## 5. 승인 불변식

APPROVED 전이는 모두 만족해야 한다.

1. 검토 건의 **현재 분석 회차**와 요청의 회차·결정 버전이 일치한다.
2. 조례–사업, 사업–안내자료 연결이 확인되었고 근거 버전이 고정되어 있다.
3. 이전·개정 법규, 사업·안내자료의 정상 스냅샷이 있다. 필수 부칙·참조 자료 누락이 없다.
4. 적용 판단이 APPLIES_NOW이고 검토자가 시점·대상·예외와 근거를 확인했다.
5. 모든 변경 값·단위·경계·날짜가 근거 인용과 일치한다. AI 확신도만으로 통과하지 않는다.
6. 승인할 초안 버전이 최신이며, 안내자료의 원문 구간 해시가 비교 당시와 일치한다.
7. 검토자·결정 사유·기준일이 기록된다. 충돌하는 다른 승인 초안이 같은 구간에 있으면 먼저 병합 검토한다.

최신성은 “등록한 출처를 마지막으로 확인한 시점”까지의 주장이다. 외부 사이트가 이후에 바뀌지 않았다는 보장은 하지 않는다. 승인 시 구성 가능한 재확인 유효 기간을 검사하며, MVP 초기값은 **24시간**으로 둔다. 초과·확인 실패이면 재수집 전 승인할 수 없다. 이 기간은 기관 정책 확정 전 가정이다.

수정 확인 시에도 같은 유효 기간 안에서 다른 근거가 변하지 않았는지 확인하고, 현재 회차·승인 버전이 일치하는지 검사한다. 후속 안내 스냅샷은 Verification에 연결하며 승인 입력으로 대체하지 않는다.

## 6. 인용·버전 불변식

- 인용 참조: snapshot_id, text_sha256, start, end, quote.
- start/end는 저장된 추출 텍스트의 **Unicode 코드 포인트 기준 반열린 구간 [start,end)** 이다.
  quote는 해당 구간과 정확히 일치해야 한다. 브라우저 UTF-16 위치를 그대로 저장하지 않는다.
- 비교용 공백·단위 정규화 결과는 별도로 둔다. 원문과 인용 좌표를 덮어쓰지 않는다.
- 원문 바이트·추출 텍스트·파서 버전·추출 실패를 구분한다. 사람이 보정한 텍스트도 새 스냅샷이다.
- 외부 ID의 개정·개칭 시 안정성은 아직 미검증이다. 내부 ID와 제공기관 식별자 이력을 관리한다.
  임시 식별자는 사람이 관계를 확인하기 전 자동 병합하지 않는다.
- 같은 원문 재수집은 출처 관측 이력만 추가한다. 새 내용·파서 결과·적용 기준의 변화는 새 분석 회차를 만든다.
  단, APPROVED 회차의 안내 수정 결과는 위 수정 확인 예외에 따라 별도 증거로 처리한다.
- 실패한 작업·오래된 비동기 결과는 현재 회차의 승인·분석 결과를 덮어쓸 수 없다.

## 7. 권한과 책임

| 역할 | 허용 | 금지 |
|---|---|---|
| 수집 담당/작업 | 허용 출처 조회, 스냅샷·후보·작업 결과 생성 | 연결 확정·승인·외부 게시 |
| 분석 작업 | 고정 입력 해석, 조건·연결 후보·초안 제안 | 원문 수정, 담당자 결정 대행 |
| 업무 검토자 | 연결·적용 판단 확인, 초안 수정·승인·제외·수정 확인 | 감사 이력 삭제, 원문 변경 |
| 관리자 | 출처 허용 목록·모델·재확인 정책 설정 | 과거 결정·원문 조작 |

로컬 시연은 역할 선택을 모사할 수 있으나 인증된 사용자로 간주하지 않는다. “시연 역할”과 수행자를 화면·이력에 표시한다. 기관 도입에는 인증·권한 검사를 별도로 구현해야 한다. 자동 승인을 허용하는 관리 옵션은 만들지 않는다.

## 8. 이름 붙인 사건과 미확정 항목

감사 사건은 완료된 사실을 나타내는 과거형 이름을 쓴다: SourceSnapshotCaptured, AmendmentDetected, ServiceLegalLinkConfirmed, GuidanceLinkConfirmed, ApplicabilityConfirmed, EvidenceAdded, AnalysisRevisionCreated, CorrectionDraftProposed, CorrectionDraftRevised, CorrectionChangesRequested, CorrectionDraftApproved, ImpactDismissed, VerificationFailed, CorrectionVerified, SourceFetchFailed.

| 미확정 | 확인 책임 | 해결 전 처리 |
|---|---|---|
| 법규 연혁 ID 연결 규칙 | 데이터/수집 담당 | 임시 키와 사람 확인 |
| 참조 조문·별표의 자동 추적 범위 | 업무 검토/수집 담당 | 필요한 근거 없으면 NEEDS_EVIDENCE |
| 기관별 승인자·보존 기간 | 도입 기관 담당 | 로컬 시연, 실제 개인정보 제외 |
| 동일 구간 여러 개정의 초안 병합 UX | 제품/업무 검토 담당 | 충돌 표시 후 수동 통합, 중복 승인 차단 |
