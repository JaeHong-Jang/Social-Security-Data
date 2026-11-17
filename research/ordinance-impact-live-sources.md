# 조례 변경 영향 추적: 공개 출처 실연결 조사

확인일: **2026-11-17**. 조사 기록 시각: **2026-11-17 10:24:16 KST**. 아래 HTTP 관측은 이 기록 시각 이전 같은 조사 세션에서 수행했다. 개별 요청의 초 단위 시각은 별도로 저장하지 않았다. **10:27:48 KST**에 자치법규 본문 7개를 다시 GET하여 `input#ordinNm`의 정식명을 확인했다. 모두 HTTP 200이었다.

공식 웹 검색과 인증 없는 공개 HTTPS 요청으로 확인했다. 인증키·토큰·환경파일은 읽지 않았고, 코드와 커밋은 변경하지 않았다. 이 문서는 조회 성공과 응답 구조를 기록하며, 수집기 구현·원문 스냅샷 영속화·담당자의 법률 판단 완료를 뜻하지 않는다.

## 1. 이번에 확인한 범위

| 출처 | 직접 관측 | 연결 범위와 제한 |
|---|---|---|
| 국가법령정보센터 공개 자치법규 웹 | 본문·부칙 7개 버전, 연혁 4개 법규의 HTML GET 200 | 성동구 사업 4건. 개정 전후쌍은 3건, 탈모 지원은 제정본만 존재하는 것으로 관측 |
| 복지로 공개 상세 웹 | 성동구 4개 사업과 중앙사업 1개의 HTML GET 200, 내장 JSON 직접 해석 | 사업명·지원 설명·수정일·근거법령명 확인. 인증 API 응답과 구별 |
| 성동구 누리집 | 공식 검색 결과에서 사업 안내문 확인 | 직접 요청은 청정웹 페이지로 리디렉션되어 본문 미확보. 검색 결과를 신규 HTML 스냅샷으로 표시하지 않음 |
| 국가법령정보센터 공개 상위법 웹 | 청소년복지 지원법 본문·부칙 HTML GET 200 | 중앙사업 WLF00000781 및 성동구 생리용품 조례의 근거 연결 확인 |
| 공공데이터포털 통계 파일 | 정상 다운로드 절차로 CSV GET 200 | 기준년월 2025-12, 2,577행. 현재 인구나 조례 개정 영향 인원으로 해석하지 않음 |
| 국가법령정보 공동활용 DRF | 공식 샘플 인증값으로 HTTPS 응답 수신 | HTTP 200 안에 사용자 검증 실패 JSON. 데이터 API 연결 성공으로 세지 않음 |

기존 [캐시](../data/cache/local_서울특별시.json)는 `fetched_at=2026-11-13 00:14:18`이다. 아래 사업 ID 후보를 고르는 데 사용했으며 캐시 전체의 최신성·완전성을 이번 조사로 검증하지 않았다. 사업명과 근거법령명은 해당 복지로 공개 페이지에서도 별도로 확인했다.

## 2. 국가법령정보 공동활용 API의 문서 계약과 실응답

| 공식 문서 | 확인 내용 |
|---|---|
| [자치법규 목록 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=ordinListGuide) | `target=ordin`, `OC` 필수, HTML/XML/JSON. `nw=1` 현행·`nw=2` 연혁, `display` 최대 100, 페이지·지역·공포일·시행일 필터. 일련번호·자치법규ID·공포/시행일·상세링크 등을 제공한다고 명시 |
| [자치법규 본문 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=ordinInfoGuide) | `target=ordin`, `ID` 또는 `MST`. 조문·부칙·제개정문/이유 항목. 자치법규 별표는 서울시교육청과 본청에 한해 제공한다고 명시 |
| [법령 목록 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsNwListGuide) | 상위 법률 등은 `target=law`. 법령ID와 법령일련번호·공포일·시행일·상세링크 등을 제공한다고 명시 |
| [법령 본문 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsNwInfoGuide) | `ID` 또는 `MST`, 조문·부칙·별표 링크·조문시행일자 등의 항목. 자치법규 API와 필드 계약을 혼합하지 않음 |

문서의 요청 예시는 HTTP이지만 아래 **HTTPS** 요청은 실제 응답했다. `OC=test`는 공식 가이드의 공개 샘플값이며 기관 인증값을 사용하지 않았다.

- [자치법규 목록 HTTPS 샘플](https://www.law.go.kr/DRF/lawSearch.do?OC=test&target=ordin&type=JSON&query=%EC%84%B1%EB%8F%99%EA%B5%AC&display=3)
- [법령 목록 HTTPS 샘플](https://www.law.go.kr/DRF/lawSearch.do?OC=test&target=law&type=JSON&query=%EC%B2%AD%EC%86%8C%EB%85%84%EB%B3%B5%EC%A7%80%20%EC%A7%80%EC%9B%90%EB%B2%95&display=1)

두 응답 모두 HTTP 200, `application/json;charset=UTF-8`, 215 bytes였으나 `result`는 사용자 정보 검증 실패, `msg`는 서버장비 IP·도메인 등록 안내였다. HTTPS 통신 도달만 확인한 결과다. 실계정 승인·등록 환경·허용량·성공 데이터 스키마는 미검증이다.

[공동활용 이용안내](https://open.law.go.kr/LSO/information/guide.do)는 공동활용 신청과 승인, 출처표시, 트래픽 부하 등에 따른 이용제한을 안내한다. 법령정보의 영리 목적을 포함한 자유 활용도 설명하지만 API 승인 요건을 없앤다는 뜻은 아니다. 법제처 출처를 보존하고 공개 웹 수집과 승인형 API를 구분한다.

## 3. 실제 응답한 공개 웹 경로

### 3.1 자치법규 본문과 연혁

[공개 상세 화면](https://www.law.go.kr/ordinInfoP.do?ordinSeq=1957377)의 HTML에는 `ordinId`, `ordinSeq`, 법규명과 공개 스크립트 경로가 있다. 최초 HTML에는 조문이 없을 수 있다. 화면의 `setOrdinHstList()`와 [공개 ordin.js](https://www.law.go.kr/LSW/assets/js/ordin/ordin.js)에 명시된 화면 로딩 경로로 본문과 연혁을 조회했다.

```text
GET https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq={version}&ordinId={law_id}&gubun=ELIS&chrClsCd=010202
GET https://www.law.go.kr/LSW/ordinHstListR.do?ordinSeq={version}&ordinId={law_id}&gubun=ELIS&chrClsCd=010202
```

인증·쿠키 없이 단순 GET으로 HTTP 200, `text/html;charset=UTF-8`을 받았다. 본문은 법규명·시행/공포 정보·조문·부칙을 담은 HTML이다. 연혁은 `ul#ordinHstList`의 항목과 `ordinViewOrdinHst('버전번호', 'Y/N')` 호출에 버전번호를 담는다. 이 경로는 **공개 웹 화면의 내부 경로**이며 DRF API의 보장된 스키마나 SLA가 아니다. `Y/N`만 법적 유효성 판단으로 쓰지 않고 제목의 날짜·부칙과 함께 확인한다. HTML 속성·스크립트를 제외하는 파서를 써야 하며 단순 정규식 태그 제거만으로 인용문을 확정하지 않는다.

### 3.2 복지로 사업 안내

```text
GET https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId={service_id}&wlfareInfoReldBztpCd=02
```

성동구 네 사업에서 HTTP 200, UTF-8 HTML을 받았다. 중앙사업은 끝의 코드가 `01`이다. HTML 본문이 로딩 화면만 담더라도 head 스크립트의 `cpr.core.Platform.INSTANCE.initParameter(...)`에 실제 공개 사업 데이터가 있다. 자바스크립트 실행이나 `eval` 없이 JSON 디코더로 인자 객체를 읽고 `initValue`의 문자열 JSON을 다시 해석할 수 있다.

| 위치 | 관측된 공개 항목 |
|---|---|
| `initValue.dmWlfareInfo` | `wlfareInfoId`, `wlfareInfoNm`, `addr`, `lastChgPtm`, `wlfareSprtTrgtCn`, `wlfareSprtTrgtSlcrCn`, `wlfareSprtBnftCn`, `aplyMtdDc` 등 |
| `initValue.dsWlfareInfoDtl` | 배열. `wlfareInfoDtlCd=030` 항목의 `wlfareInfoReldNm`에 근거법령명, `wlfareInfoReldCn`에는 관련 내용/링크가 있을 수 있음 |
| 같은 배열의 `040` | 첨부자료명과 파일 관련 항목. 첨부의 별도 수집 성공을 의미하지 않음 |

기존 API 캐시의 `servId`를 공개 웹의 `wlfareInfoId`와 대조했다. 이름만으로 다른 관할의 동명 조례에 연결하지 않는다. 내장 객체에는 안내에 필요 없는 작성/변경 사용자·IP 관련 메타데이터도 섞여 있으므로 전체 객체를 출력하거나 커밋하지 말고 공개 안내 필드만 허용목록으로 추출한다. 관련 링크에 타 기관의 API 인증값이 포함되어 있어도 재사용하지 않는다. 공개 HTML의 이용허락을 데이터포털 API의 “제한 없음”과 동일하다고 확정하지 않았다. 재배포·장기 운영의 허락범위는 별도 확인사항으로 남긴다.

## 4. 성동구 실제 연결 후보

아래 법규의 “후”는 조사 시 공개 연혁 목록의 첫 버전으로 확인한 값이며, 이후 개정이 없다는 영구 보장이 아니다. 복지로 최종수정일은 조례 시행일이 아니다.

### A. 탈모 지원 — 현재 원문만 확인

- 사업: `WLF00005234`, 성동구 청년 등 탈모 치료 지원. [복지로 직접 조회](https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00005234&wlfareInfoReldBztpCd=02), 수정일 `2026-11-10`, 근거법령 정식명 일치.
- 법규 ID `2220991`, 버전 `1706939`. [본문](https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1706939&ordinId=2220991&gubun=ELIS&chrClsCd=010202), [연혁](https://www.law.go.kr/LSW/ordinHstListR.do?ordinSeq=1706939&ordinId=2220991&gubun=ELIS&chrClsCd=010202) 모두 GET 200. 연혁 목록은 2022-05-06 제정 한 건이었다.
- 관측: 조례 제2조는 39세 이하, 제4조는 3개월 이상 주민등록, 제5조는 경구용 치료제 구매 본인부담금 일부 지원을 규정한다. 연간 20만원·80%라는 사업 운영 금액/비율은 조례 조문에 없고 복지로 안내에 존재한다. 세부 운영근거 없이 조례 위반 여부를 확정하지 않는다.
- 구청 후보 안내: [사업 페이지](https://www.sd.go.kr/main/contents.do?key=5353), [2026년 9월 접수 안내](https://sd.go.kr/booking/viewTnOnlineRceptU1.do?key=4871&progrmNo=761&sc3=202609). 공식 검색 결과에 연도·지원대상·금액을 확인했으나 이 조사에서 구청 HTML 직접 수집은 실패했다.
- 판정: 사업–조례–복지로 안내 연결은 확인. **개정 전후쌍 미확보**이므로 개정 영향 평가 사례 수에 포함하지 않는다.

### B. 여성청소년 생리용품 보편지원 — 실제 전후쌍

- 사업: `WLF00004779`. [복지로 직접 조회](https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004779&wlfareInfoReldBztpCd=02), 수정일 `2026-06-19`, 근거명 “서울특별시 성동구 여성청소년 생리용품 지원 조례”.
- 법규 ID `2209946`. [이전 본문: 1614983](https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1614983&ordinId=2209946&gubun=ELIS&chrClsCd=010202), 시행 2022-01-01·공포 2021-07-15. [개정 본문: 1957377](https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1957377&ordinId=2209946&gubun=ELIS&chrClsCd=010202), 공포/시행 2024-07-17. [연혁](https://www.law.go.kr/LSW/ordinHstListR.do?ordinSeq=1957377&ordinId=2209946&gubun=ELIS&chrClsCd=010202)에서 두 버전을 확인하고 양쪽 조문·부칙 GET 200을 받았다.
- 관측: 제2조제2호의 연령 표현에서 “만”이 삭제됐다. 숫자 경계는 양쪽 모두 11~18세다. 이 표현 차이를 연령 산정 방식의 변경이나 안내 오류로 자동 확정하지 않는다. 개정 부칙은 공포한 날 시행이다. 금액은 구청장이 따로 정할 수 있는 운영근거를 함께 확인해야 한다.
- 구청 후보 안내: [사업 페이지](https://www.sd.go.kr/main/contents.do?key=5280), [2026년 4월호 안내](https://www.sd.go.kr/eng/webNewsToolDetail.do?eatitle=2026%EB%85%84+4%EC%9B%94%ED%98%B8&key=5184&subNo=20061). 공식 검색 결과에 11~18세·월 12,000원·연 최대 144,000원 등이 나타났다. 구청 직접 HTML은 미확보다.
- 판정: 실제 전후 조례·근거 연결·현재 복지로 안내를 기술적으로 조회 가능. 연도별 시행계획 첨부와 연령 적용 판단은 추가 검토 대상이다.

### C. 출생축하금 — 실제 전후쌍과 부칙 적용례

- 사업: `WLF00002160`, 출생축하금지원사업(셋째아 이상). [복지로 직접 조회](https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00002160&wlfareInfoReldBztpCd=02), 수정일 `2026-06-19`, 근거법령 정식명 “서울특별시 성동구 출생축하금 지원에 관한 조례” 일치. 양쪽 본문의 `input#ordinNm`도 이 이름이다.
- 법규 ID `2145868`. [이전 본문: 1662661](https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1662661&ordinId=2145868&gubun=ELIS&chrClsCd=010202), 시행 2022-01-01·공포 2021-12-30. [개정 본문: 1852983](https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1852983&ordinId=2145868&gubun=ELIS&chrClsCd=010202), 공포/시행 2023-09-21. [연혁](https://www.law.go.kr/LSW/ordinHstListR.do?ordinSeq=1852983&ordinId=2145868&gubun=ELIS&chrClsCd=010202)에서 인접 버전임을 확인했다. 양쪽 본문 GET 200.
- 관측: 제4조의 셋째 100만원·넷째 이상 150만원이 셋째 300만원·넷째 500만원·다섯째 이상 1,000만원 및 분할 지급으로 바뀐다. 제5조 신청기한은 1년에서 1년 6개월로 바뀐다. 제3조 거주기간과 제9조 지급중단 내용도 달라 별도 비교가 필요하다.
- 적용 근거: 개정 부칙 제2조는 제4조제1항을 2023-01-01 이후 출생 영아부터 적용하되 공포일 현재 구에 주민등록을 두고 거주하는 조건을 명시한다. 제목의 공포번호는 제1643호, 마지막 부칙 표기는 제1636호로 서로 다르게 관측됐다. 이를 원문대로 보존하고 담당 확인 대상으로 남긴다.
- 구청 후보 안내: [2026년 11월호](https://www.sd.go.kr/eng/webNewsToolDetail.do?eatitle=2026%EB%85%84+11%EC%9B%94%ED%98%B8&key=5184&subNo=20128), [2025년 기준 업무통계 설명](https://www.sd.go.kr/statistics/viewTnStatsSquareU.do?key=2473&sa2=4&statsNo=824). 검색 결과 관측이며 직접 HTML 수집 완료로 표시하지 않는다.
- 판정: 실제 전후 조례와 복지로 안내 연결 확인. 부칙 적용례·공포번호 표기·지급연차 검토 전 자동 법률 판단은 보류한다.

### D. 국가유공자위문 — 실제 전후쌍과 시행일 구분

- 사업: `WLF00002445`. [복지로 직접 조회](https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00002445&wlfareInfoReldBztpCd=02), 수정일 `2026-06-30`, 근거명 “서울특별시 성동구 국가보훈대상자 예우 및 지원에 관한 조례”.
- 법규 ID `2141061`. [이전 본문: 1982297](https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1982297&ordinId=2141061&gubun=ELIS&chrClsCd=010202), 공포/시행 2024-11-07. [개정 본문: 2067399](https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=2067399&ordinId=2141061&gubun=ELIS&chrClsCd=010202), 공포 2025-09-18·시행 2026-01-01. [연혁](https://www.law.go.kr/LSW/ordinHstListR.do?ordinSeq=2067399&ordinId=2141061&gubun=ELIS&chrClsCd=010202)에서 인접 버전임을 확인했다. 양쪽 본문 GET 200.
- 관측: 제3조 지원대상 표현이 변경되고, 마지막 부칙에 2026-01-01 시행이 명시된다. 복지로의 보훈예우수당 월 70,000원 등 숫자만 보고 2025년 개정에서 그 금액이 바뀌었다고 추정하지 않는다. 제10조제2항은 예산 범위 지급을 규정하므로 예산/운영자료 확인이 필요하다.
- 구청 후보 안내: [2026년 6월호](https://www.sd.go.kr/eng/webNewsToolDetail.do?eatitle=2026%EB%85%84+6%EC%9B%94%ED%98%B8&key=5184&subNo=20078). 검색 결과에 관련 수당·위문금 안내가 나타났으나 직접 요청은 시간 초과했다.
- 판정: 실제 전후 조례·사업 근거·복지로 안내 연결 확인. 공포일과 시행일의 분리를 검증할 자료다. 실제 안내 오류를 입증한 결과는 아니다.

## 5. 중앙부처 사업과 상위법 공개 원문

[중앙사업 WLF00000781: 여성청소년 생리용품 지원](https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000781&wlfareInfoReldBztpCd=01)은 GET 200, 내장 공개 사업 데이터의 수정일은 `2026-10-27`이었다. 근거 목록 `030`에 “청소년복지 지원법”을 확인했다. 이 사업의 취약계층 9~24세 조건을 성동구 보편지원 사업의 11~18세 조건과 혼합하지 않는다.

성동구 조례 제1조의 공식 링크도 같은 상위법 `lsId=009681`을 가리킨다. [상위법 공개 화면](https://www.law.go.kr/LSW/lsInfoP.do?lsId=009681)의 hidden `lsiSeq=285871`와 화면 로딩 정보를 따라 다음 실제 본문을 받았다.

[청소년복지 지원법 공개 본문](https://www.law.go.kr/LSW/lsInfoR.do?lsiSeq=285871&efYd=20261113&chrClsCd=010202&ancYnChk=0&efGubun=Y)

- 단순 GET, HTTP 200, `text/html;charset=UTF-8`, 190,088 bytes. 본문 SHA-256 `1706b26d2c2941c0c52b4fb9b3027d7448ce50230142d815767dd4f1e12d8f91`.
- 시행 2026-11-13, 법률 제21629호, 공포 2026-05-12로 표시됐다. 제5조의 생리용품 지원 근거와 부칙이 포함된다.
- `efYd`에 임의 조사일 `20261117`을 넣었던 요청은 HTTP 200이지만 454 bytes의 `Error` 페이지였다. 요청 성공은 상태 코드와 함께 실제 법령명·조문·버전 필드로 검증해야 한다. 이 파라미터는 화면에서 확인한 실제 시행일을 쓴다.
- 상위법 공개 본문 역시 DRF 인증 API가 아닌 공개 화면 내부 HTML이며 구조 변경 가능성이 있다. 사업의 모든 요건을 이 한 법률만으로 판정하지 않는다.

## 6. 사회보장 통계 CSV의 실제 다운로드

[한국사회보장정보원_복지사업 시군구별 수급권자 현황](https://www.data.go.kr/data/15062448/fileData.do)은 직접 HTML GET 200으로 확인했다. 페이지가 제시한 파일은 `20251231`, 등록·수정일 `2026-06-26`, 연간 갱신, 이용허락범위 “제한 없음”이다. 데이터 기준일과 수집일을 분리한다.

공개 페이지의 다운로드 버튼 및 [script_fileDetail.js](https://www.data.go.kr/js/biz/datset/script_fileDetail.js), [공통 파일 다운로드 스크립트](https://www.data.go.kr/js/biz/cmm/cmm/script_cmmFunction.js)에 명시된 절차를 그대로 수행했다.

1. `POST https://www.data.go.kr/tcs/dss/selectFileDataDownload.do`에 URL-encoded form `publicDataPk=15062448`, `publicDataDetailPk=uddi:b4960581-6aa1-4317-a2a6-d3f947573f24`, 빈 `atchFileId`, `fileDetailSn=1`, `publicDataTyCode=PR0051`을 전송. JSON `status=true`, `atchFileId=FILE_000000003664131`, `fileDetailSn=1` 관측.
2. `POST https://www.data.go.kr/cmm/cmm/check-limit.json`에 위 파일ID·순번 전송. HTTP 200, `needCaptcha=false`를 확인했다. 캡차나 403이 나오면 다운로드를 중단해야 하며 다른 경로로 우회하지 않는다.
3. [공개 CSV 다운로드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003664131&fileDetailSn=1&dataNm=%ED%95%9C%EA%B5%AD%EC%82%AC%ED%9A%8C%EB%B3%B4%EC%9E%A5%EC%A0%95%EB%B3%B4%EC%9B%90_%EB%B3%B5%EC%A7%80%EC%82%AC%EC%97%85%20%EC%8B%9C%EA%B5%B0%EA%B5%AC%EB%B3%84%20%EC%88%98%EA%B8%89%EA%B6%8C%EC%9E%90%20%ED%98%84%ED%99%A9_20251231)를 GET. HTTP 200, 131,141 bytes, SHA-256 `157ececacb6e3d932fc70f16ed402921f3239fcf83af31988bbded6f16d498e0`.

응답 헤더는 `application/octet-stream; charset=UTF-8`이었지만 UTF-8 디코딩은 실패했고 **CP949**로 정상 해석됐다. CSV는 헤더 제외 2,577행, 컬럼은 `사업명`, `기준년월`, `시도`, `시군구`, `수급권자수`, `수급가구수`였다. 첫 행의 기준년월은 `2025-12`다. 파일 ID·응답 구조의 영구 안정성은 보장하지 않으므로 수집 시 메타데이터부터 다시 조회한다.

수급권자는 급여받을 자격을 가진 대상이며 실제 급여 수급자와 다른 개념이라고 제공기관이 설명한다. 사업·시군구별 집계는 인구 맥락용이며 개별 주민정보, 성동구 탈모 사업 수급자수, 개정의 영향 인원으로 바꾸어 쓰지 않는다. 파일 자체의 이용허락은 [공공데이터포털 이용정책](https://www.data.go.kr/ugs/selectPortalPolicyView.do)과 함께 기록한다.

## 7. 실패·이용조건·남은 검토

| 항목 | 관측/미확인 | 처리 |
|---|---|---|
| 성동구 `contents.do?key=5353`, `key=5280` 직접 GET | 최초 302의 Location이 `http://www.sd.go.kr/clean_web.html`, 기본 리디렉션 처리 시 반복 302 오류 | 청정웹 화면 우회 시도 없음. 실패 상태와 원본 URL 유지. 복지로 공개 안내를 별도 출처로 사용 가능 |
| 성동구 2026년 6월호 웹 도구 직접 열기 | 시간 초과 | 검색 인덱스 관측과 원문 수집을 구분 |
| 구청 저작권 | [성동구 저작권 정책](https://www.sd.go.kr/main/contents.do?key=1826)의 공식 검색 내용에 공공누리 유형·출처표시, 표시가 없는 자료는 사전 협의 안내가 있음 | 개별 자료에 붙은 유형은 직접 원문 미확보로 미확인. 모든 구청 문서·이미지·첨부에 일괄 허락이 있다고 가정하지 않음 |
| 복지로 공개 HTML | 실제 본문 데이터 수신. 개별 HTML의 재배포/상업 활용에 대한 명시적 허락범위는 미확인 | 데이터포털 API 이용허락과 분리. 원본 링크·확인일·공개 필드만 보존하고 외부 재게시의 허락범위는 별도 검토 |
| ELIS | [성동구 자치법규 목록](https://www.elis.go.kr/alrpop/locgovAlrPopup?ctpvCd=11&sggCd=200) 공식 웹에서 법규명·소관부서·제개정일 목록 확인 | 별도 본문 API·첨부 제공·이용조건을 확인했다고 확대하지 않음 |
| 조례 별표·연도별 시행계획 | 일반적인 전국 제공 보장은 없고 본 조사에서 필수 첨부 실수집 미검증 | 금액·연령 산정·서류 요건이 위임돼 있으면 `NEEDS_EVIDENCE` 후보. HTML 본문만으로 모두 판정하지 않음 |
| 안내 오류와 G0 업무 검증 | 실제 원문 전후쌍·사업명·근거명·공개 안내의 기술 연결 3건을 확인 | 오류 존재·법적 적용 확정·효율 개선·승인 완료를 주장하지 않음. 담당자 연결 확인, 스냅샷 영속화, 적용 판단이 남음 |

요청은 정상 공개 화면과 문서에 드러난 경로에 한정했다. 인증 오류·청정웹 리디렉션·캡차에 대한 우회는 수행하지 않았다. 출처의 내용을 프로그램 지시로 실행하지 않았고 안내문·정정안의 외부 게시도 하지 않았다.
