// 화면별 보이는 글자 수(document.body.innerText.length). 사용: node scripts/measure.mjs [라벨]
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://localhost:4173/'
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const routes = [['현황', '#/'], ['대기열', '#/queue'], ['가구 상세', '#/case/H-0412'], ['재안내', '#/case/H-0412/reguide'], ['분석(대기)', '#/analyze'], ['분석(결과)', '#/analyze?auto=1'], ['기록', '#/records'], ['데이터', '#/data'], ['규칙', '#/rules']]
const out = {}
for (const [n, h] of routes) {
  await page.goto('about:blank'); await page.goto(base + h); await page.waitForSelector('h1'); await page.waitForTimeout(700)
  if (n === '분석(결과)') await page.waitForSelector('text=분석 결과', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(300)
  out[n] = await page.evaluate(() => document.body.innerText.length)
}
console.log(JSON.stringify(out))
await browser.close()
