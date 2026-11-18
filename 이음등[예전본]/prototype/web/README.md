# 이음등 웹 대시보드 (1단계)

React + Vite + TypeScript. 토큰은 `design/tokens.css`를 그대로 import한다. 데이터는 `mock/households.json`(가상 데이터, `src/data.ts`에서만 읽음).

```
npm install
npm run dev        # 개발 서버
npm run build      # tsc + vite build
npx vite preview --port 4173 &
PW_CHROMIUM=<chrome 경로> npm run shoot   # 스크린샷 + 콘솔 에러·가로 스크롤 검사 -> screenshots/
```

화면: `#/` 대기열, `#/case/:id` 가구 상세, `#/case/:id/reguide` 맞춤 재안내.
담당자 판단·해석 확정·안내문 편집은 메모리 + localStorage(`ieumdeung-demo-v1`)에만 저장된다.
API 연동 시 `src/data.ts`의 `load()`만 `fetch`로 바꾼다.
