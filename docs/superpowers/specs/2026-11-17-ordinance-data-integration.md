# 실제 공공데이터 연결 설계

사용자 지시: 이 주제에서 활용할 수 있는 데이터를 실제로 연결한다. 기존 기초설계의 수집·출처 보존 경계를 구현하며 추가 승인 질문 없이 진행한다.

## 범위와 접근

복지사업(지자체·중앙부처), 조례·관련 법령, 공개 사업 안내문, 이미 확보한 사회보장 통계를 연결한다. 주제와 무관한 개인정보·위기가구 자료는 수집하지 않는다. 전국 사업 목록과 확보된 상세를 구분하고, 자료가 없는 지역의 상세까지 확보한 것으로 세지 않는다.

선택: 기존 캐시를 출처·원래 수집일과 함께 수입하고, 공식 API/공개 웹의 실제 수집 성공분을 불변 스냅샷으로 추가한다. 인증 미설정·제공 제한·네트워크 실패는 출처 상태에 남긴다. 가상 데이터로 실패를 대체하거나 캐시 수입 시각을 원래 수집 시각으로 바꾸지 않는다. 기존 가상 승인 시연은 별도로 유지한다.

대안으로 캐시만 사용하면 재수집을 검증할 수 없고, 실시간 API만 사용하면 인증·출처 장애 때 확보 자료를 열 수 없다. 파일 스냅샷과 원자적 catalog JSON을 사용하는 단일 사용자 수집 단계로 시작한다. 실제 업무 승인·AI 분석·외부 게시 API는 이 작업에 포함하지 않는다.

## 파일과 공통 계약

- `prototype/ordinance_impact/api/store.py`: 원문 해시·관측 메타데이터·추출문 보존. URL 인증정보는 저장하지 않는다.
- `api/normalizers.py`: 실제 기존/API 자료를 공통 서비스·통계 형태로 변환한다.
- `api/server.py`: 루프백 읽기 전용 HTTP API. 디스크 자료가 없으면 빈 상태를 반환한다.
- `api/collect.py`: 기존 자료 수입, 제한된 공식 출처 수집, 실패 기록, 원자적 catalog 교체.
- `sources.json`: 공식 출처 및 사업 연결 후보 URL. 확정된 법적 적용 관계로 취급하지 않는다.
- `web/src/PublicData.tsx`, `publicData.ts`, `public-data.css`: 실제 출처·사업·법규·안내문·통계 탐색 화면.
- `data/ordinance_impact/`: 로컬 catalog 및 불변 원문. 원문 재배포·비밀정보 커밋 방지를 위해 git 제외.

catalog JSON: `schemaVersion: 1`, `generatedAt`(ISO8601), `sources`, `services`, `documents`, `statistics`.

source: `id,name,provider,kind,homepageUrl,status,fetchedAt,lastAttemptAt,recordCount,totalCount,message,snapshotIds`. status는 `live|cache|partial|blocked|unconfigured`. 원래 관측시각을 모르면 fetchedAt=null, 설명에 기록한다.

service: `id,kind(local|central),name,region,department,summary,target,criteria,application,legalBases:[{name,content,code}],homepageUrl,sourceUrl,fetchedAt,sourceId,snapshotId,detailStatus(collected|missing|error)`.

추가 보존 필드는 `support,attachments:[{name,url}],relatedLinks:[{name,url}],modifiedAt,serviceStartDate,serviceEndDate,provenance`다. `99991231`은 실제 종료일로 표시하지 않는다. 같은 사업의 여러 상세는 최신 관측 한 스냅샷 전체를 선택하고 provenance만 합친다. 삭제된 근거·첨부·빈 필드를 과거 상세에서 복구하지 않는다.

document: `id,kind(ordinance|law|guidance),title,jurisdiction,sourceUrl,fetchedAt,snapshotId,text,relatedServiceIds,relationStatus(candidate),historyStatus(current-only|paired|missing),version:{promulgatedDate,effectiveDate,ordinSeq}`. 연혁쌍은 같은 법규임을 실제 확인한 경우에만 paired. 수집한 원문과 연결 후보는 업무 검토 완료가 아니다.

실제 연혁쌍은 `legalInstrumentId,pairedDocumentIds,versionRole(before|after),historySnapshotId`로 연결한다. 제목 유사성만으로 쌍을 만들지 않는다. 상위법 version에는 `lsId,lsiSeq`도 보존한다. 복지로 문서는 `representation=public-field-projection`으로 공개 필드만 JSON 보존하고 원 HTML은 버린다. 수신 HTML의 `responseSha256`과 보존 JSON의 스냅샷 해시를 구분한다.

statistic: `id,title,provider,sourceUrl,fetchedAt,snapshotId,recordCount,columns,previewRows,purpose,scope`. 통계는 지역·사업 분포 참고이며 특정 안내 오류의 증거가 아니다.

## 읽기 전용 API

접두사 `/api/ordinance-impact`:

- `GET /health`: 실행 상태와 데이터 유무.
- `GET /catalog`: services 제외 catalog + `summary:{services,localServices,centralServices,detailedServices,legalBases,documents,statistics}`.
- `GET /services?query=&kind=all&region=&legalOnly=false&page=1&pageSize=40`: `{items,total,page,pageSize}`. 검색은 이름·지역·근거법령 포함, 페이지 크기는 최대100.
- `GET /services/{id}`: 실제 공통 service와 `documents`(관련 후보 원문).
- `GET /documents/{id}`: 실제 보존 문서.
- `GET /snapshots/{id}`: 고정 원문 메타데이터·추출문. 임의 파일 경로는 허용하지 않는다.

브라우저는 5175의 `/api`를 8788로 proxy한다. API는 `127.0.0.1:8788`에서 구동한다. 데이터 서버 불가 시 오류와 재시도를 표시하고 가상 자료를 섞지 않는다. `/data`를 기본 진입점으로 바꾸고 기존 `/impacts`는 가상 검토 시연으로 명시한다.

전용 법령 인증 API는 구현 범위에서 제외하고 접근 가능한 공식 공개 웹으로 법규 원문·연혁을 수집한다. 복지 API 최신 목록 수집 어댑터는 인증키 설정 시 실행하며 실제 인증 성공은 미검증이다. 현재 키가 없어 기존 캐시와 공개 웹·통계 실수집을 사용한다. API 상세 전건 수집·첨부 OCR·전국 조례 감시는 구현하지 않는다.

## 검증

키 누락·XML 오류·부족한 상세·중복 ID·법규 ID로 오인하면 안 되는 상세코드·원문 해시/시각·실패 응답·페이지 경계·API 미연결 화면을 검사한다. 실제 수집 결과의 출처별 성공/실패와 실제/캐시/가상 구분을 다시 검토한다. 기존 가상 승인 검사는 계속 통과해야 한다.
