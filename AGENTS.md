# AGENTS.md

이 브랜치의 주제는 **조례 개정에 따른 복지정보 변경 영향 추적 및 안내 오류 예방 AI**다. 이음등과 독립된 실제 공공자료 수집·탐색 API/화면과 별도의 가상 검토 시연이 있다. AI 분석·실제 업무 승인·외부 게시는 미연동이다.

- 먼저 `CLAUDE.md`와 `docs/superpowers/specs/2026-11-17-ordinance-impact-design.md`를 읽는다.
- 상태·권한은 `docs/05_domain-model.md`, 실행 경계는 `docs/07_architecture.md`, 화면은 `DESIGN.md`를 따른다.
- 실제 자료 연결은 `docs/superpowers/specs/2026-11-17-ordinance-data-integration.md`, 실행·수집 범위는 `prototype/ordinance_impact/README.md`를 따른다. `/data`의 실제 자료와 `/impacts`의 가상 시연을 섞지 않는다.
- 기존 이음등 자산은 참고 자료로 보존한다. 새 코드는 `prototype/ordinance_impact/`에 격리한다.
- 출처, 확인일, 실제 관측, 설계 가정, 가상 예시를 구분한다. 성능·오류 사례·수상작 내용을 지어내지 않는다.
- 실제 개인정보를 사용하지 않고 키·토큰·환경파일 내용을 출력하거나 커밋하지 않는다.
- 근거 원문과 버전을 보존한다. 조례–사업 연결과 적용 시점이 불확실하면 검토를 보류한다.
- AI는 변경 후보·영향 후보·정정 초안을 제안한다. 승인과 외부 게시를 자동 실행하지 않는다.
- 문서만 변경하면 링크·상호 일관성·`git diff --check`를 검증한다. 구현 시에는 해당 동작 테스트와 타입·빌드 검사를 추가한다.
- 커밋은 변경 이유를 제목에 쓰고 필요한 Lore 트레일러를 남긴다.
