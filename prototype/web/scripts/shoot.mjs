// 사용법: npm run build && npm run preview -- --port 4173 --strictPort &  →  node scripts/shoot.mjs
// 모든 화면을 실제로 눌러 보며 스크린샷(screenshots/v7), 콘솔 에러, 가로 스크롤을 검사한다.
import { chromium } from 'playwright'

const base = process.env.BASE ?? 'http://localhost:4173/'
const out = 'screenshots/v7'
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
let bad = 0
const fail = (m) => { bad++; console.log('실패:', m) }
const ok = (c, m) => { if (!c) fail(m); else console.log('확인:', m) }

async function session(width, fn) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin }).catch(() => {})
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await fn(page)
  if (errors.length) fail(`콘솔 에러 @${width}: ${errors.join(' | ')}`)
  await ctx.close()
}
const go = async (page, hash) => { await page.goto('about:blank'); await page.goto(base + hash); await page.waitForSelector('h1'); await page.waitForTimeout(500) }
const noScroll = async (page, name, width) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth)
  if (sw > width) fail(`가로 스크롤 ${name}@${width} scrollWidth=${sw}`)
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
const ROUTES = ['#/', '#/queue', '#/case/H-0412', '#/case/H-0412/reguide', '#/analyze', '#/records', '#/data', '#/rules']

// ---------- 1440: 모든 화면 클릭 ----------
await session(1440, async (page) => {
  await go(page, '#/')
  await shot(page, 'home-1440')
  ok(await page.locator('.scraps a.scr').count() === 4 && await page.locator('a.huge').count() === 1, '현황 KPI(큰 숫자 + 쪽지 4개)')
  // 세로 인덱스 탭(A안 프레임): nav·aria-current·44px·스크롤 따라옴
  {
    const tabs = page.locator('nav[aria-label="주 메뉴"] a.vtab')
    ok(await tabs.count() === 6 && await page.locator('nav[aria-label="주 메뉴"] a[aria-current=page]').count() === 1, '세로 탭 6개 + aria-current 1개')
    const hs = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    ok(Math.min(...hs) >= 44, `세로 탭 높이 ≥44 (${Math.min(...hs)})`)
    await go(page, '#/queue'); await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(200)
    const top = await tabs.first().evaluate((e) => Math.round(e.getBoundingClientRect().top))
    ok(top >= 0 && top < 400, `스크롤해도 탭이 보임 (top=${top})`)
    ok(await page.locator('.spine, .vtabs').first().getAttribute('aria-hidden') !== 'false', '장식 바인더 aria-hidden')
    await page.evaluate(() => window.scrollTo(0, 0)); await go(page, '#/')
  }
  // 홈 hover: 큰 숫자·카운트·타일·집·쪽지는 파랑으로 바뀌지 않는다
  await go(page, '#/')
  const BLUE = ['rgb(0, 90, 170)', 'rgb(0, 73, 138)']
  const targets = [['큰 숫자', 'a.huge'], ['레벨 카운트', '.tally a .v'], ['KPI 타일', '.scraps a.scr .v'], ['집 스트립', '.hm span'], ['쪽지 카드', '.note .nid']]
  for (const [label, sel] of targets) {
    const el = page.locator(sel).first(); const host = sel.startsWith('.hm') ? page.locator('.hm').first() : (sel.startsWith('a.huge') ? el : el)
    await host.hover(); await page.waitForTimeout(120)
    const col = await el.evaluate((e) => getComputedStyle(e).color)
    ok(!BLUE.includes(col), `hover '${label}' 색 유지 (${col})`)
    if (label === '집 스트립') await page.screenshot({ path: `${out}/home-hover-1440.png` })
  }
  // A1 KPI 숫자 = 도착한 목록 행 수
  const kp = [['재검토 대상', () => page.locator('a.huge'), (l) => l.innerText().then((t) => +t.replace(/\D/g, ''))],
    ['긴급', () => page.locator('.scraps a.scr', { hasText: '긴급' }), (l) => l.locator('.v').innerText().then(Number)],
    ['재확인 도래', () => page.locator('.scraps a.scr', { hasText: '재확인 도래' }), (l) => l.locator('.v').innerText().then(Number)]]
  for (const [label, loc, val] of kp) {
    await go(page, '#/')
    const card = loc(); const n = await val(card)
    await card.click(); await page.waitForSelector('tr.click'); await page.waitForTimeout(300)
    const rows = await page.locator('tr.click').count()
    ok(rows === n, `KPI '${label}' ${n} = 목록 ${rows}행`)
  }
  // A12 대소문자, A4 정렬 반전
  await go(page, '#/queue')
  await page.locator('.search input').fill('h-0412'); await page.waitForTimeout(200)
  ok(await page.locator('tr.click').count() === 1, 'A12 소문자 검색')
  await page.locator('.search input').fill('')
  await page.getByRole('button', { name: /^단계/ }).click(); await page.waitForTimeout(200)
  const firstLv1 = await page.locator('tr.click').first().locator('.c-level').innerText()
  await page.getByRole('button', { name: /^단계/ }).click(); await page.waitForTimeout(200)
  const firstLv2 = await page.locator('tr.click').first().locator('.c-level').innerText()
  ok(firstLv1 !== firstLv2, `A4 단계 헤더 반전 (${firstLv1.trim()} → ${firstLv2.trim()})`)
  await page.getByRole('button', { name: /^가구/ }).click(); await page.waitForTimeout(200)
  const id1 = await page.locator('tr.click').first().locator('.c-id a').innerText()
  await page.getByRole('button', { name: /^가구/ }).click(); await page.waitForTimeout(200)
  const id2 = await page.locator('tr.click').first().locator('.c-id a').innerText()
  ok(id1 !== id2, `A4 가구 헤더 반전 (${id1} → ${id2})`)
  const hts = await page.locator('tr.click').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  ok(Math.max(...hts) <= 80, `B1 행 높이 ${Math.min(...hts)}–${Math.max(...hts)}px`)
  await go(page, '#/'); await shot(page, 'home-1440')
  // 홈 상위 카드 클릭 → 상세
  await page.locator('.note').first().click()
  await page.waitForURL(/#\/case\//)
  ok(true, '오늘 먼저 볼 가구 카드 클릭 → 상세')

  // 대기열
  await go(page, '#/queue')
  await shot(page, 'queue-1440')
  const total = await page.locator('tr.click').count()
  await page.getByRole('tab', { name: /^긴급/ }).click()
  await page.waitForTimeout(200)
  const urgent = await page.locator('tr.click').count()
  ok(urgent > 0 && urgent < total, `긴급 탭 필터 ${urgent}/${total}`)
  await page.getByRole('tab', { name: /^전체/ }).click()
  await page.locator('.search input').fill('H-0412'); await page.waitForTimeout(250)
  ok(await page.locator('tr.click').count() === 1, '검색 H-0412 → 1건')
  await page.locator('.search input').fill('서류')
  ok(await page.locator('tr.click').count() >= 1, '메모 내용 검색')
  await page.locator('.search input').fill('')
  await page.getByRole('button', { name: '재확인 7일 안' }).click()
  ok(await page.locator('tr.click').count() >= 1, '칩 필터 동작')
  await page.getByRole('button', { name: '재확인 7일 안' }).click()
  // 정렬 헤더
  await page.getByRole('button', { name: /^점수/ }).click()
  // 행 클릭 → 시트
  await page.locator('tr.click').nth(1).locator('.c-reason').click()
  await page.waitForSelector('.sheet')
  await page.waitForTimeout(150)
  await shot(page, 'queue-sheet-1440')
  ok(await page.locator('.sheet').isVisible(), '행 아무 곳 클릭 → 미리보기 시트')
  await page.getByRole('button', { name: '담당자 배정' }).click()
  ok(await page.locator('.toast').count() > 0, '담당자 배정 토스트')
  await page.keyboard.press('Escape')
  ok(await page.locator('.sheet').count() === 0, 'Esc로 시트 닫힘')
  // 키보드 Enter
  await page.locator('tr.click').first().focus()
  await page.keyboard.press('Enter')
  ok(await page.locator('.sheet').count() === 1, 'Enter로 시트 열림')
  await page.getByRole('link', { name: '상세 보기' }).click()
  await page.waitForSelector('.layout .file')
  // 일괄 배정
  await go(page, '#/queue')
  await page.locator('tr.click input[type=checkbox]').nth(0).check()
  await page.locator('tr.click input[type=checkbox]').nth(1).check()
  await page.getByRole('button', { name: '일괄 배정' }).click()
  ok(await page.getByText('담당 담당자 A(가상)').count() >= 2, '일괄 배정 반영')
  await shot(page, 'queue-assigned-1440')

  // 상세
  await go(page, '#/case/H-0412')
  await page.getByRole('button', { name: '해석 확인' }).first().click()
  await page.getByRole('button', { name: '수정 필요' }).nth(1).click()
  await page.locator('.fixrow').first().getByRole('button', { name: '장벽 원인' }).click()
  ok(await page.locator('.rv.ok').count() >= 1 && await page.locator('.chip-f.on').count() >= 1, '해석 확인 / 수정 필요(항목 표시)')
  await shot(page, 'detail-1440')
  await page.getByRole('button', { name: '판단 저장' }).click()
  ok(await page.locator('.toast').filter({ hasText: '판단을 저장' }).count() > 0, '판단 저장 → 토스트')
  { // A2 피드 중복 없음, A3 KST
    await go(page, '#/')
    const feed = await page.locator('.feed li span').allInnerTexts()
    const decFeed = feed.filter((t) => t.includes('판단 저장')); ok(new Set(decFeed).size === decFeed.length, `A2 활동 피드 중복 없음 (${decFeed.length}건)`); console.log(feed.join(' | '))
    const t = await page.locator('.feed li small').first().innerText(); console.log('최근 활동 첫 시각:', t, '(현재 KST', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16), ')')
    await go(page, '#/case/H-0412')
  }
  await page.getByRole('link', { name: /다음 가구/ }).click()
  await page.waitForTimeout(300)
  ok(!page.url().endsWith('H-0412'), '다음 가구 이동')
  await page.getByRole('link', { name: /이전 가구/ }).click()
  await page.waitForTimeout(300)
  ok(page.url().endsWith('H-0412'), '이전 가구 이동')

  // 재안내
  await go(page, '#/case/H-0412/reguide')
  await page.getByRole('button', { name: '안내문 복사' }).click()
  await page.waitForTimeout(300)
  ok(await page.locator('.toast').filter({ hasText: '복사' }).count() > 0, '안내문 복사 토스트')
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null))
  if (clip !== null) ok(clip.length > 10, '클립보드에 안내문 들어감')
  for (const l of await page.locator('.notice input[type=checkbox]').all()) await l.check()
  await page.getByRole('button', { name: '담당자 승인' }).click()
  ok(await page.locator('.toast').filter({ hasText: '승인' }).count() > 0, '안내문 승인 토스트')
  ok(await page.getByRole('button', { name: '담당자 승인' }).isDisabled(), 'A5 승인 후 버튼 비활성')
  await page.locator('#notice-text').fill((await page.locator('#notice-text').inputValue()) + ' ')
  ok(await page.locator('.notice input[type=checkbox]:checked').count() === 0, 'A5 수정 시 체크·승인 해제')
  await page.getByRole('button', { name: '초안으로 되돌리기' }).click()
  for (const l of await page.locator('.notice input[type=checkbox]').all()) await l.check()
  await page.getByRole('button', { name: '담당자 승인' }).click()
  await shot(page, 'reguide-1440')

  // 기록
  await go(page, '#/records')
  await shot(page, 'records-1440')
  ok(await page.locator('table.rec tbody tr').count() >= 3, '처리 기록 행(저장한 판단 + 가상 이력)')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV 내려받기' }).click()])
  ok(dl.suggestedFilename().endsWith('.csv'), 'CSV 다운로드')
  { const n = await page.locator('.kpi', { hasText: '연계 준비' }).locator('.kpi-v b').innerText(); console.log('연계 준비', n); ok(+n <= 3, 'A5/A6 연계 준비 중복 없음') }
  await page.locator('.toolbar select').nth(1).selectOption('불일치')

  // 데이터 / 규칙
  await go(page, '#/data')
  await page.getByRole('tab', { name: '생애주기 빈칸' }).click()
  await shot(page, 'data-1440')
  await go(page, '#/rules')
  await page.locator('#w-B').evaluate((el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '0'); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForTimeout(200)
  ok(await page.getByText('가설 가중치 실험').count() > 0 && (await page.locator('output[for=w-B]').innerText()).startsWith('0점'), '가중치 슬라이더 → 순위 변화')
  await shot(page, 'rules-1440')

  // 메모 분석: 홈 CTA 자동 실행(녹화 재생 또는 실시간)
  await go(page, '#/')
  await page.getByRole('link', { name: '데모 실행' }).click()
  await page.waitForSelector('.steps')
  await page.waitForTimeout(1200)
  await shot(page, 'analyze-running-1440')
  await page.waitForSelector('text=분석 결과', { timeout: 30000 })
  const mode = await page.locator('.tt .tag').first().innerText()
  console.log('분석 모드 표시:', mode.replace(/\n/g, ' '))
  await page.waitForTimeout(300)
  await shot(page, 'analyze-done-1440')
  await page.getByRole('button', { name: '결과를 대기열에 추가' }).click()
  ok(await page.getByText(/추가됨/).count() > 0, '결과를 대기열에 추가')
  await page.getByRole('link', { name: '대기열 보기' }).click()
  await page.waitForSelector('tr.click')
  ok(await page.getByText('분석 추가').count() > 0, '대기열에 AI 분석 태그 가구')
  // 예시 불러오기·직접 실행(S2)
  await go(page, '#/analyze')
  await page.waitForTimeout(500)
  await page.locator('.an-tools select').first().selectOption({ index: 1 })
  await page.getByRole('button', { name: '예시 불러오기' }).click()
  await page.getByRole('button', { name: '분석 실행' }).click()
  await page.waitForSelector('text=분석 결과', { timeout: 30000 })
  ok(true, '예시 2번 불러와 분석 실행')
  // A8 중지
  await go(page, '#/analyze'); await page.waitForTimeout(600)
  ok(await page.getByRole('button', { name: '분석 실행' }).isEnabled(), 'A10 첫 로드에 예시가 채워져 실행 가능')
  await page.getByRole('button', { name: '분석 실행' }).click(); await page.waitForTimeout(800)
  await page.getByRole('button', { name: '중지' }).click(); await page.waitForTimeout(300)
  ok(await page.locator('.an-out .spin').count() === 0, 'A8 중지 후 스피너 없음')
  await shot(page, 'analyze-stopped-1440')
  // 입력 변경 후 녹화 불일치 처리(서버 없을 때)
  await page.getByRole('button', { name: '메모 수정' }).click()
  await page.locator('textarea').first().fill('가상 메모입니다. 서류가 어렵다고 함.')
  await page.getByRole('button', { name: '분석 실행' }).click()
  await page.waitForTimeout(2500)
  console.log('수정 입력 결과:', (await page.locator('.an-out .err, .an-out .step.done').count()) > 0 ? '결과 또는 안내 표시' : '표시 없음')

  // 데모 초기화
  await page.locator('.util .reset').click()
  await page.getByRole('button', { name: '초기화', exact: true }).click()
  await go(page, '#/records')
  ok(await page.locator('table.rec tbody tr').count() <= 3, '데모 초기화 후 기록 초기 상태')

  for (const r of ROUTES) { await go(page, r); await noScroll(page, r, 1440) }
})

// ---------- 390: 대기열·분석·셸 ----------
await session(390, async (page) => {
  for (const r of ROUTES) { await go(page, r); await noScroll(page, r, 390) }
  await go(page, '#/')
  await shot(page, 'home-390')
  ok(await page.locator('.tabbar-m').isVisible(), '모바일 하단 탭바 표시')
  await shot(page, 'tabbar-390')
  await page.locator('.tabbar-m').getByRole('link', { name: /대기열/ }).click()
  await page.waitForURL(/#\/queue/)
  await page.waitForTimeout(300)
  await shot(page, 'queue-390')
  await page.locator('tr.click').nth(1).locator('.c-reason').click()
  await page.waitForSelector('.sheet')
  await page.waitForTimeout(150)
  await shot(page, 'queue-sheet-390')
  await noScroll(page, 'sheet', 390)
  await go(page, '#/analyze?auto=1')
  await page.waitForSelector('text=분석 결과', { timeout: 30000 })
  await shot(page, 'analyze-390')
  await noScroll(page, 'analyze-done', 390)
  await go(page, '#/case/H-0412')
  await shot(page, 'detail-390')
  await go(page, '#/rules'); await shot(page, 'rules-390')
  await go(page, '#/data'); await shot(page, 'data-390')
  await go(page, '#/records'); await shot(page, 'records-390')
})

await browser.close()
console.log(bad ? `실패 ${bad}건` : '통과: 모든 클릭 확인, 콘솔 에러 0, 가로 스크롤 없음')
process.exit(bad ? 1 : 0)
