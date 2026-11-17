import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5175'
const mode = process.env.UI_DATA_MODE ?? 'live'
assert.ok(['live', 'mock'].includes(mode), 'UI_DATA_MODE is live or mock')
const output = 'artifacts/public-data-' + mode
await mkdir(output, { recursive: true })
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : { channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const checks = [], errors = [], expectedNetworkErrors = [], requests = []
let intentionalFailure = false
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
  if (message.type() !== 'error') return
  if (intentionalFailure && /Failed to load resource/.test(message.text())) expectedNetworkErrors.push(message.text())
  else errors.push(message.text())
})
const ok = (condition, label) => { assert.ok(condition, label); checks.push(label); console.log('PASS: ' + label) }
const go = async path => { await page.goto(base + path); await page.locator('h1').waitFor(); await page.evaluate(() => document.fonts.ready); await page.waitForFunction(() => !document.querySelector('.public-data .public-state[role="status"]')) }
const shot = async name => page.screenshot({ path: output + '/' + name + '.png', fullPage: true })
const noOverflow = async label => { ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ' has no page-level horizontal overflow') }
const savedAt = '2025-09-20T03:04:00Z'
const rawHash = 'abc12345'.repeat(8)
const snapshot = { id: 'snapshot-ui-contract', sourceId: 'ui-cache', sourceUrl: 'https://www.bokjiro.go.kr/', fetchedAt: savedAt, extractedAt: '2026-11-17T03:00:00Z', rawSha256: rawHash, textSha256: '1234abcd'.repeat(8), rawBytes: 120, textBytes: 90, contentType: 'application/json', parserVersion: 'ui-contract', text: '브라우저 계약 검사에만 사용하는 응답입니다.' }
const sources = ['live', 'cache', 'partial', 'blocked', 'unconfigured'].map((status, index) => ({ id: 'ui-' + status, name: '브라우저 검사 출처 ' + status, provider: 'UI 검사 응답', kind: 'service', homepageUrl: 'https://www.bokjiro.go.kr/', status, fetchedAt: index < 3 ? savedAt : null, lastAttemptAt: '2026-11-17T03:00:00Z', recordCount: index < 3 ? 14 : 0, totalCount: 42, message: '검사 전용 응답 · 실제 수집 결과 아님', snapshotIds: index < 3 ? [snapshot.id] : [] }))
const services = Array.from({ length: 42 }, (_, index) => ({
  id: 'local:ui-' + index, kind: index < 40 ? 'local' : 'central', name: '브라우저검사 사업 ' + String(index + 1).padStart(2, '0'), region: index < 40 ? '서울특별시' : '전국', department: 'UI 검사 응답', summary: '실제 API 계약 검사를 위한 네트워크 대역 응답입니다.', support: '지원 내용 검사', target: '지원 대상 검사', criteria: '선정 기준 검사', application: '신청 방법 검사', legalBases: index === 0 ? [{ name: '검사 근거 조례', content: '근거 문구 검사', code: 'SERVICE-CODE-NOT-LAW-ID' }] : [], homepageUrl: 'https://www.bokjiro.go.kr/', sourceUrl: snapshot.sourceUrl, fetchedAt: savedAt, sourceId: 'ui-cache', snapshotId: snapshot.id, detailStatus: index < 10 ? 'collected' : 'missing', attachments: [{ name: '검사 첨부', url: 'https://www.bokjiro.go.kr/attachment' }], relatedLinks: [{ name: '검사 관련 공식 링크', url: 'https://www.bokjiro.go.kr/' }], serviceStartDate: '2026-01-01', serviceEndDate: null, modifiedAt: '2026-11-01',
}))
const documents = ['ordinance', 'ordinance', 'guidance'].map((kind, index) => ({ id: 'document-ui-' + index, kind, title: index === 2 ? '검사 사업 안내문' : '검사 조례 ' + (index === 0 ? '이전 원문' : '개정 원문'), jurisdiction: '서울특별시', sourceUrl: 'https://www.law.go.kr/', fetchedAt: savedAt, snapshotId: snapshot.id, text: '수집 원문 본문 검사. 조례 연결은 후보입니다.', relatedServiceIds: [services[0].id], relationStatus: 'candidate', historyStatus: index === 2 ? 'current-only' : 'paired', pairedDocumentIds: index < 2 ? ['document-ui-' + (1 - index)] : [], legalInstrumentId: index < 2 ? 'ordin:ui-contract' : undefined, versionRole: index === 0 ? 'before' : index === 1 ? 'after' : undefined, historySnapshotId: index < 2 ? snapshot.id : undefined, representation: index === 2 ? 'public-field-projection' : 'original-html', responseSha256: index === 2 ? 'abcd1234'.repeat(8) : undefined, version: { promulgatedDate: '2025-09-01', effectiveDate: index === 0 ? '2025-09-01' : '2026-01-01', ordinSeq: null } }))
const statistic = { id: 'statistic-ui', title: '검사 참고 통계', provider: 'UI 검사 응답', sourceUrl: 'https://www.data.go.kr/', fetchedAt: savedAt, snapshotId: snapshot.id, recordCount: 2, columns: ['지역', '사업수'], previewRows: [{ 지역: '서울', 사업수: 42 }, ['전국', 100]], purpose: '지역 분포 참고', scope: '브라우저 검사 응답' }
const mockCatalog = { schemaVersion: 1, generatedAt: '2026-11-17T03:00:00Z', sources, documents, statistics: [statistic], summary: { services: 42, localServices: 40, centralServices: 2, detailedServices: 10, legalBases: 1, documents: 3, statistics: 1 } }
let failCatalog = false, emptyCatalog = false, mismatchPair = false
if (mode === 'mock') await page.route('**/api/ordinance-impact/**', async route => {
  const url = new URL(route.request().url()), path = decodeURIComponent(url.pathname.replace('/api/ordinance-impact', ''))
  requests.push(url.pathname + url.search)
  let body
  if (path === '/catalog') {
    if (failCatalog) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'intentional UI failure' }) }); return }
    body = emptyCatalog ? { ...mockCatalog, sources: [], documents: [], statistics: [], summary: { services: 0, localServices: 0, centralServices: 0, detailedServices: 0, legalBases: 0, documents: 0, statistics: 0 } } : mockCatalog
  } else if (path === '/services') {
    const query = url.searchParams.get('query') ?? '', kind = url.searchParams.get('kind') ?? 'all', region = url.searchParams.get('region') ?? '', legalOnly = url.searchParams.get('legalOnly') === 'true'
    const pageNumber = Number(url.searchParams.get('page') ?? 1), pageSize = Number(url.searchParams.get('pageSize') ?? 20)
    const items = (emptyCatalog ? [] : services).filter(service => (service.name + service.region + service.legalBases.map(basis => basis.name).join(' ')).includes(query) && (kind === 'all' || service.kind === kind) && service.region.includes(region) && (!legalOnly || service.legalBases.length))
    body = { items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), total: items.length, page: pageNumber, pageSize }
  } else if (path.startsWith('/services/')) body = { ...services.find(service => service.id === path.slice('/services/'.length)), documents }
  else if (path.startsWith('/documents/')) { body = documents.find(document => document.id === path.slice('/documents/'.length)); if (mismatchPair && body?.versionRole === 'after') body = { ...body, legalInstrumentId: 'ordin:other-law' } }
  else if (path.startsWith('/snapshots/')) body = snapshot
  if (body) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  else await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
})
try {
  const catalog = mode === 'mock' ? mockCatalog : await (async () => {
    const response = await page.request.get(base + '/api/ordinance-impact/catalog')
    assert.ok(response.ok(), 'read-only API must be running; use UI_DATA_MODE=mock for isolated browser contract checks')
    return response.json()
  })()
  await go('/')
  await page.waitForURL('**/data')
  await page.locator('.public-summary').waitFor()
  ok(await page.getByRole('heading', { name: '실제 공공데이터', exact: true }).isVisible(), 'default route opens actual public data')
  ok(await page.locator('.demo-notice').count() === 0, 'actual public data has no synthetic-data banner')
  ok(await page.getByRole('button', { name: '정정안 승인', exact: true }).count() === 0, 'actual data is read-only without demo approval actions')
  await page.locator('.public-result-count').waitFor()
  await noOverflow('actual data desktop'); await shot('catalog-1440')
  if (mode === 'mock') {
    ok(await page.locator('.public-service-list > article').count() === 20, 'service list respects API page size')
    await page.getByRole('button', { name: '다음', exact: true }).click()
    await page.waitForURL('**/data?page=2')
    await page.getByRole('link', { name: '브라우저검사 사업 21', exact: true }).waitFor()
    ok(await page.locator('.public-service-list > article').count() === 20, 'next page loads a different server page')
    await page.getByRole('textbox', { name: '사업·지역·근거법령 검색' }).fill('검사 근거 조례')
    await page.getByRole('combobox', { name: '사업 유형' }).selectOption('local')
    await page.getByRole('textbox', { name: '지역', exact: true }).fill('서울')
    await page.getByRole('checkbox', { name: '근거 문구 보유' }).check()
    await page.getByRole('button', { name: '검색', exact: true }).click()
    await page.getByText('검색 결과 1건 · 1페이지', { exact: true }).waitFor()
    ok(requests.some(request => request.includes('kind=local') && request.includes('legalOnly=true') && request.includes('page=1') && request.includes('region=')), 'search, type, region and legal filters reach paged API and reset page')
    await page.getByRole('link', { name: '브라우저검사 사업 01', exact: true }).click()
    await page.getByRole('heading', { name: '브라우저검사 사업 01', exact: true }).waitFor()
    for (const text of ['지원 내용 검사', '지원 대상 검사', '선정 기준 검사', '신청 방법 검사', '근거 문구 검사']) ok(await page.getByText(text, { exact: true }).isVisible(), 'service detail displays ' + text)
    ok(await page.getByRole('link', { name: '검사 첨부 (새 창)', exact: true }).getAttribute('href') === services[0].attachments[0].url, 'official attachments are linked without claiming body collection')
    ok(await page.getByText('SERVICE-CODE-NOT-LAW-ID · 법규 ID 확인 전', { exact: false }).isVisible(), 'service code is not represented as a law identifier')
    await page.getByTestId('raw-hash').waitFor()
    ok(await page.getByTestId('raw-hash').textContent() === rawHash, 'source raw SHA-256 is loaded from immutable snapshot API')
    ok(await page.getByText(/2025.*09.*20.*12:04.*KST/).count() > 0, 'original collection time is retained independently from catalog date')
    await noOverflow('service detail desktop'); await shot('service-1440')
    await page.getByRole('link', { name: '연혁 원문 나란히 보기', exact: true }).first().click()
    await page.getByRole('heading', { name: '연혁 원문과 현재 안내', exact: true }).waitFor()
    await page.locator('.public-comparison-grid').waitFor()
    ok(await page.locator('.public-comparison-document').count() === 3, 'verified before and after law plus candidate guidance render together')
    ok(await page.getByText('AI 변경 분석이나 현재 안내의 오류 판단을 수행하지 않았습니다.', { exact: false }).isVisible(), 'actual comparison does not claim automatic error analysis')
    ok(await page.getByRole('button', { name: '정정안 승인', exact: true }).count() === 0, 'actual comparison does not enter synthetic approval')
    const beforeText = page.locator('.public-comparison-grid .public-raw-text').first(); await beforeText.focus()
    ok(await beforeText.evaluate(element => element === document.activeElement), 'scrollable original text is keyboard focusable')
    await noOverflow('paired document comparison desktop'); await shot('comparison-1440')
    mismatchPair = true
    await go('/data/compare/' + documents[0].id)
    ok(await page.getByRole('heading', { name: '연혁 연결 정보를 확인할 수 없습니다', exact: true }).isVisible(), 'mismatched legal instrument IDs cannot be represented as a verified pair')
    mismatchPair = false
    await go('/data/compare/' + documents[2].id)
    ok(await page.getByRole('heading', { name: '비교할 연혁쌍이 없습니다', exact: true }).isVisible(), 'current-only guidance cannot be compared as an acquired history pair')
    await go('/data/documents/' + documents[0].id)
    await page.getByRole('heading', { name: '검사 조례 이전 원문', exact: true }).waitFor()
    ok(await page.getByText('수집 원문 본문 검사. 조례 연결은 후보입니다.', { exact: true }).isVisible(), 'document route loads preserved document body')
    ok(await page.getByText('연결 후보 · 적용 관계 미확정', { exact: true }).isVisible(), 'candidate relation is not represented as a confirmed legal link')
    ok(await page.getByText('동일 법규의 연혁쌍을 확보했습니다.', { exact: false }).isVisible(), 'paired history is labelled only for paired documents')
    await page.getByTestId('raw-hash').waitFor(); await shot('document-1440')
    await go('/data/services/' + encodeURIComponent(services[20].id))
    ok(await page.getByText('목록만 확보', { exact: true }).isVisible(), 'listing-only service is distinguishable from collected detail')
    await go('/data?view=documents')
    await page.getByRole('combobox', { name: '문서 유형' }).selectOption('guidance')
    ok(await page.locator('.public-document-list > article').count() === 1, 'guidance documents can be explored separately from statutes')
    await page.getByRole('link', { name: '검사 사업 안내문', exact: true }).click()
    await page.getByRole('heading', { name: '검사 사업 안내문', exact: true }).waitFor()
    ok(await page.getByText('이전 안내문 버전을 확보하지 못했습니다.', { exact: false }).isVisible(), 'unpaired guidance shows missing previous version')
    ok(await page.getByText('공개 안내 필드 추출본 · 원 HTML은 보존하지 않음', { exact: true }).isVisible(), 'guidance distinguishes preserved public field projection from original HTML')
    ok(await page.locator('.public-response-hash code').textContent() === documents[2].responseSha256, 'received HTML hash is shown separately from preserved copy hash')
    await go('/data?view=sources')
    for (const label of ['실수집', '보존 자료', '일부 확보', '수집 제한', '인증 미설정']) ok(await page.getByText(label, { exact: true }).isVisible(), 'source status is explicit: ' + label)
    ok(await page.getByText('원수집일 미확인', { exact: true }).count() === 2, 'unknown original source dates are not replaced with import time')
    await shot('sources-1440')
    await go('/data?view=statistics')
    await page.getByRole('heading', { name: statistic.title, exact: true }).waitFor()
    ok(await page.getByRole('cell', { name: '서울', exact: true }).isVisible() && await page.getByRole('cell', { name: '전국', exact: true }).isVisible(), 'statistics render object and array preview rows')
    ok(await page.getByText('특정 사업 안내의 오류나 조례 적용 관계를 입증하는 근거가 아닙니다.', { exact: false }).isVisible(), 'statistics are explained as context rather than error evidence')
  } else {
    ok(!('services' in catalog), 'catalog transfers summary without the complete service list')
    ok(catalog.sources.length === await page.request.get(base + '/api/ordinance-impact/catalog').then(response => response.json()).then(data => data.sources.length), 'actual catalog is reachable through Vite proxy')
    if (catalog.summary.services) {
      const firstPage = await page.request.get(base + '/api/ordinance-impact/services?page=1&pageSize=20').then(response => response.json())
      const first = firstPage.items[0]
      await page.getByRole('textbox', { name: '사업·지역·근거법령 검색' }).fill(first.name)
      await page.getByRole('button', { name: '검색', exact: true }).click()
      const link = page.getByRole('link', { name: first.name, exact: true }).first(); await link.waitFor(); await link.click()
      await page.getByRole('heading', { name: first.name, exact: true }).waitFor()
      ok(await page.getByText('지원 대상', { exact: true }).isVisible() && await page.getByText('선정 기준', { exact: true }).isVisible() && await page.getByText('신청 방법', { exact: true }).isVisible(), 'actual service search opens target, criteria and application detail')
      if (first.snapshotId) {
        const evidence = await page.request.get(base + '/api/ordinance-impact/snapshots/' + encodeURIComponent(first.snapshotId)).then(response => response.json())
        await page.getByTestId('raw-hash').waitFor()
        ok(await page.getByTestId('raw-hash').textContent() === evidence.rawSha256, 'actual service snapshot hash matches preserved API evidence')
      }
      await noOverflow('actual service desktop'); await shot('service-1440')
    } else ok(await page.getByRole('heading', { name: '확보한 복지사업이 없습니다' }).isVisible(), 'empty actual catalog remains empty without synthetic fallback')
    await go('/data?view=sources')
    await page.locator(catalog.sources.length ? '.public-source-list' : '.public-state h2').waitFor()
    ok(await page.locator('.public-source-list > article').count() === catalog.sources.length, 'every actual source success or failure is visible')
    await shot('sources-1440')
    await go('/data?view=documents')
    if (catalog.documents.length) {
      const document = catalog.documents[0]
      await page.getByRole('link', { name: document.title, exact: true }).first().click()
      await page.getByRole('heading', { name: document.title, exact: true }).waitFor()
      ok(await page.getByRole('heading', { name: '수집한 본문', exact: true }).isVisible(), 'actual document body is reachable')
      await shot('document-1440')
    }
    const paired = catalog.documents.find(document => document.historyStatus === 'paired' && document.pairedDocumentIds?.length)
    if (paired) {
      await go('/data/compare/' + encodeURIComponent(paired.id))
      ok(await page.locator('.public-comparison-grid').isVisible(), 'actual verified history pair can be read side by side')
      ok(await page.locator('.public-comparison-guidance .public-comparison-document').count() > 0, 'actual comparison includes a collected current guidance candidate')
      ok(await page.getByRole('button', { name: '정정안 승인', exact: true }).count() === 0, 'actual comparison remains separate from synthetic approval')
      const beforeText = page.locator('.public-comparison-grid .public-raw-text').first(); await beforeText.focus()
      ok(await beforeText.evaluate(element => element === document.activeElement), 'actual scrollable original text is keyboard focusable')
      await noOverflow('actual paired comparison desktop'); await shot('comparison-1440')
    }
    await go('/data?view=statistics')
    await page.getByRole('heading', { name: '사회보장 참고 통계', exact: true }).waitFor()
    ok(await page.getByText('특정 사업 안내의 오류나 조례 적용 관계를 입증하는 근거가 아닙니다.', { exact: false }).isVisible(), 'actual statistics scope boundary is visible')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/data', '/data?view=sources', '/data?view=documents', '/data?view=statistics']) {
    await go(path); await page.locator('.public-summary').waitFor(); await noOverflow(path + ' mobile'); await shot(path.includes('?') ? path.split('=')[1] + '-390' : 'catalog-390')
  }
  if (catalog.summary.services) {
    const id = mode === 'mock' ? services[0].id : await page.request.get(base + '/api/ordinance-impact/services?page=1&pageSize=1').then(response => response.json()).then(data => data.items[0].id)
    await go('/data/services/' + encodeURIComponent(id)); await page.getByRole('heading', { name: '사업 설명', exact: true }).waitFor(); await noOverflow('actual service mobile'); await shot('service-390')
  }
  const mobilePair = catalog.documents.find(document => document.historyStatus === 'paired' && document.pairedDocumentIds?.length)
  if (mobilePair) { await go('/data/compare/' + encodeURIComponent(mobilePair.id)); await noOverflow('paired comparison mobile'); await shot('comparison-390') }
  await page.setViewportSize({ width: 360, height: 800 }); await go('/data'); await page.locator('.public-summary').waitFor(); await noOverflow('actual data small mobile')
  await go('/impacts')
  ok(await page.locator('.demo-notice').isVisible(), 'separate synthetic review keeps its explicit synthetic-data banner')
  ok(await page.locator('.impact-table tbody tr').count() === 6, 'existing synthetic workflow remains available')
  await page.getByRole('link', { name: '실제 공공데이터', exact: true }).click()
  await page.getByRole('heading', { name: '실제 공공데이터', exact: true }).waitFor()
  ok(await page.locator('.demo-notice').count() === 0, 'returning to real data removes synthetic banner')
  if (mode === 'mock') {
    failCatalog = true; intentionalFailure = true
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.getByRole('heading', { name: '자료를 불러오지 못했습니다', exact: true }).waitFor()
    ok(await page.locator('.public-summary, .public-service-list').count() === 0, 'failed API does not render synthetic fallback or stale catalog as current')
    ok(await page.getByText('자료 서버가 응답하지 못했습니다. (503)', { exact: true }).isVisible(), 'API error is shown with retry')
    await shot('unavailable-360')
    failCatalog = false
    await page.getByRole('button', { name: '다시 시도', exact: true }).click()
    await page.locator('.public-summary').waitFor()
    ok(await page.getByRole('heading', { name: '복지사업 탐색', exact: true }).isVisible(), 'retry recovers from an actual data API failure')
    intentionalFailure = false
    emptyCatalog = true
    await go('/data')
    ok(await page.getByRole('heading', { name: '확보한 복지사업이 없습니다', exact: true }).isVisible(), 'an empty API catalog is not populated with synthetic services')
    await go('/data?view=sources')
    ok(await page.getByRole('heading', { name: '등록한 출처가 없습니다', exact: true }).isVisible(), 'unregistered sources have an explicit empty state')
  }
  ok(errors.length === 0, 'no unexpected browser console or runtime errors: ' + errors.join(' | '))
  await writeFile(output + '/qa-report.json', JSON.stringify({ mode, checks, errors, expectedNetworkErrors }, null, 2))
  console.log('Public data UI checks passed: ' + checks.length + ' (' + mode + ')')
} catch (error) {
  await shot('failure').catch(() => {})
  await writeFile(output + '/qa-report.json', JSON.stringify({ mode, checks, errors, expectedNetworkErrors, error: String(error) }, null, 2))
  throw error
} finally { await browser.close() }
