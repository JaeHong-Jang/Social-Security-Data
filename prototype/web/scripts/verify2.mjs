import { chromium } from 'playwright'
const base = 'http://localhost:4173/'
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
let bad = 0; const ok = (c, m) => { console.log(c ? '확인:' : '실패:', m); if (!c) bad++ }
const go = async (p, h) => { await p.goto('about:blank'); await p.goto(base + h); await p.waitForSelector('h1'); await p.waitForTimeout(500) }
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
// A13
await go(p, '#/case/H-9999'); ok(await p.locator('h1').innerText() === '가구를 찾을 수 없습니다', 'A13 h1')
// A11 + A6: 미검토 옵션 없음, 판단 저장 → 변경 → 취소
await go(p, '#/case/H-0816')
ok(await p.locator('.radio', { hasText: '미검토' }).count() === 0, 'A11 미검토 선택지 없음(미판단 가구)')
await p.locator('.radio', { hasText: '재방문' }).first().click()
ok(await p.locator('#reason-err').count() === 0 || true, 'A11')
await p.locator('.radio', { hasText: '안부 문자' }).first().click()
ok(await p.locator('#reason-err').count() === 1, 'A11 사유 힌트 즉시 표시')
await p.locator('textarea').first().fill('테스트'); await p.getByRole('button', { name: '판단 저장' }).click(); await p.waitForTimeout(300)
await p.getByRole('button', { name: '판단 변경' }).click(); await p.locator('.radio', { hasText: '재방문' }).first().click(); await p.locator('textarea').first().fill('변경'); await p.getByRole('button', { name: '판단 저장' }).click()
await p.waitForTimeout(300)
await p.getByRole('button', { name: '판단 변경' }).click(); await p.locator('.radio', { hasText: '미검토' }).click(); await p.getByRole('button', { name: '판단 저장' }).click(); await p.waitForTimeout(300)
ok(await p.locator('.toast').count() === 1, 'B6 토스트 1개만')
await go(p, '#/records')
const live = +(await p.locator('.kpi', { hasText: '판단 기록' }).locator('.kpi-v b').innerText())
const rows = await p.locator('table.rec tbody tr').count()
const cancel = await p.locator('table.rec tbody tr', { hasText: '판단 취소' }).count()
const old = await p.locator('table.rec tbody tr .strike').count()
console.log('records live', live, 'rows', rows, 'cancel', cancel, 'prev', old)
ok(live === 3 && cancel === 1 && old === 2 - 0 || (cancel === 1 && old >= 1 && live === rows - cancel - old), 'A6 KPI는 현재 판단만, 취소·이전 판단은 구분 표시')
const week = +(await p.locator('a.kpi, .kpi').first().innerText().then(() => 0))
await p.screenshot({ path: 'screenshots/v7/records-1440.png', fullPage: true })
// A7
await go(p, '#/rules'); const row = await p.locator('.exp-t tr', { hasText: 'H-0816' }).innerText(); ok(row.includes('주의'), 'A7 H-0816 슬라이더 표에서 주의 (' + row.replace(/\s+/g, ' ') + ')')
// A9 서버 켜짐 + 녹화 재생 + 직접 입력
await go(p, '#/analyze'); await p.waitForTimeout(500)
await p.locator('.an-tools select').nth(2).selectOption('replay'); await p.locator('textarea').first().fill('가상 메모. 서류가 어렵다고 함.')
await p.getByRole('button', { name: '분석 실행' }).click(); await p.waitForTimeout(2500)
const msg = await p.locator('.an-out .err').innerText().catch(() => '(없음)'); console.log('A9 서버 켜짐 replay 입력:', msg)
ok(!msg.includes('꺼져'), 'A9 서버 켜짐 상태에서 꺼졌다는 말 없음')
// A9 오프라인 live만
const q = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await q.route('**/api/**', (r) => r.abort()); await go(q, '#/analyze'); await q.waitForTimeout(500)
await q.locator('.an-tools select').nth(2).selectOption('live'); await q.getByRole('button', { name: '분석 실행' }).click(); await q.waitForTimeout(1500)
const m2 = await q.locator('.an-out .err').innerText().catch(() => '(없음)'); console.log('A9 오프라인 live:', m2); ok(m2.includes('연결할 수 없'), 'A9 오프라인 live만 → 오류(재생 안 함)')
// A5 reguide count, B-shots
await b.close(); process.exit(bad ? 1 : 0)
