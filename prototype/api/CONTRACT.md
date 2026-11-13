# 이음등 웹 ↔ API 계약 (v1, 2026-11-13)

- 서버: FastAPI, `127.0.0.1:8787`, 실행 `.venv/bin/uvicorn prototype.api.server:app --port 8787`
- 웹: Vite dev/preview 모두 `/api` → `http://127.0.0.1:8787` 프록시. 포트 5173·5175는 다른 프로젝트이므로 쓰지 않는다.
- API가 꺼져 있어도 웹은 동작해야 한다. 그때 대기열·상세는 `mock/households.v3.json`, 메모 분석은 녹화 재생(웹 번들에 포함된 `mock/recordings/*.json`)을 쓴다.

## GET /api/health
```json
{ "ok": true, "ollama": true, "model": "qwen3:4b-instruct-2507-q4_K_M", "prompt_version": "r3-...", "mode": "live" }
```
Ollama에 닿지 않으면 `"ollama": false, "mode": "replay"`. 주소(IP)는 응답에 넣지 않는다.

## GET /api/cases
`households.v3.json`과 같은 모양(`{meta, cases}`)이다. `audit` 필드는 빼고 보낸다.

## GET /api/samples
메모 분석 화면의 "예시 불러오기"용 가상 메모 세트. `eval/testset/`은 절대 쓰지 않는다. `data/synthetic/`이나 mock에서 가져온다.
```json
[{ "id": "S1", "title": "서류 부담으로 두 번 미룸", "household_type": "1인가구", "memos": [{ "date": "2026-03-04", "consult_type": "전화", "text": "..." }] }]
```

## POST /api/analyze  (응답: `text/event-stream`)
요청:
```json
{ "household_type": "1인가구", "memos": [{ "date": "2026-03-04", "consult_type": "전화", "text": "..." }], "mode": "auto" }
```
`mode`: `auto`(Ollama가 되면 live, 아니면 replay) | `live` | `replay`. 메모는 1~5건, 각 1,000자 이하.

이벤트는 `event:` 이름과 JSON `data:`로 보낸다.

| event | data | 설명 |
|---|---|---|
| `start` | `{ "run_id", "mode": "live"\|"replay", "model", "steps": [{id,label}] }` | 단계 목록 미리 알림 |
| `step` | `{ "id", "status": "running"\|"done"\|"error"\|"skipped", "ms"?, "detail"?: string, "memo_index"?: number }` | 단계 진행 |
| `f1` | `{ "memo_index", "f1": F1 }` | 메모 1건 해석 완료 (F1은 `src/data.ts`의 F1 타입과 같다) |
| `result` | `{ "f1": F1[], "repeated_barrier", "f2": {...}, "action": {...}, "f3": {...} }` | 최종 결과. 모양은 `Case`의 해당 필드와 같다 |
| `error` | `{ "message" }` | 사용자에게 보여줄 한국어 메시지 |
| `end` | `{ "run_id", "elapsed_ms" }` | 끝 |

단계 id (순서 고정):
1. `validate` 원문 확인
2. `f1` 메모 읽기 (LLM, 메모별로 `memo_index` 붙여 running/done 반복)
3. `quote_check` 인용 원문 대조 (부분 문자열 아니면 버림)
4. `refusal_guard` 거부 표현 가드 (코드 규칙)
5. `cross` 회차 비교 — 같은 장벽 원인 반복 여부
6. `f2` 재검토 점수 (공개 8개 규칙, 코드 계산)
7. `action` 행동 제안 (안전 확인 경로 분리)
8. `f3` 조건 대조 (지금은 mock 매핑. `f3.notice_source: "mock"`)

replay 모드는 녹화된 실행 결과를 같은 이벤트 순서로, 실제 걸린 시간 비율대로(최대 6초 안에) 다시 보낸다. `start.mode`가 `replay`임을 반드시 표시한다.

## 녹화 파일 (서버 구현에서 추가, 2026-11-13)
- `prototype/web/mock/recordings/index.json`: `GET /api/samples`와 같은 배열(오프라인 웹의 "예시 불러오기"용).
- `prototype/web/mock/recordings/<S1..S4>.json`: `{ sample_id, sample, model, model_info, prompt_version, llm_options, recorded_at, elapsed_ms, events: [{ t_ms, event, data }] }`.
  `t_ms`는 실제 실행 시작부터의 경과 시간. `events`는 위 SSE와 같은 이름·모양이며 녹화 당시 `start.mode`는 `live`다.
  재생할 때는 `start`·`end`를 새로 만들고(`mode: "replay"`) 그 사이 이벤트를 `t_ms` 간격 비율대로(합계 최대 6초) 보낸다.
- 서버 replay에서 `start`에는 `sample_id`, `recorded_at`이 더 붙는다. 예시와 메모 원문이 같을 때만 재생하며, 다르면 `error`.
- 메모 원문이 예시와 같으면 live에서도 그 예시 가구의 행정 정보(발굴 이력·종결 후 신호·F3 mock 후보)를 쓴다.
  직접 입력한 메모는 메모 1건 = 상담안내 종결 1회로 보며, 행정 정보가 없어 위기영역·새 신호 항목은 0점, F3 후보는 0개다.
- `step` f1이 `error`이면 그 메모는 AI 형식 검사 실패로 판단보류(담당자 확인)이며 분석은 계속된다.
- `f1` 이벤트의 F1은 인용 원문 대조·거부 가드까지 마친 최종값이다(두 코드 단계는 메모마다 1ms 안에 돌고, `quote_check`·`refusal_guard` 단계는 그 집계와 실제 소요 ms를 알린다).
