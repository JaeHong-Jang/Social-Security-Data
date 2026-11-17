import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5175'
const output = 'artifacts'
await mkdir(output, { recursive: true })
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : { channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
const checks = []
const contrastFailures = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()) })
const ok = (condition, label) => { assert.ok(condition, label); checks.push(label); console.log('PASS: ' + label) }
const go = async path => { await page.goto(base + path); await page.locator('h1').waitFor(); await page.evaluate(() => document.fonts.ready); await page.evaluate(() => window.scrollTo(0, 0)) }
const shot = async name => { await page.evaluate(() => window.scrollTo(0, 0)); await page.evaluate(() => new Promise(requestAnimationFrame)); await page.screenshot({ path: output + '/' + name + '.png', fullPage: true }) }
const noOverflow = async name => { const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); ok(size.scroll <= size.width, name + ' has no page-level horizontal overflow') }
async function auditContrast(name) {
  const failures = await page.evaluate(() => {
    const rgb = s => { const n = s.match(/[\d.]+/g)?.map(Number); return n && n.length >= 3 ? n : null }
    const luminance = c => c.slice(0,3).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,i) => sum + v*[.2126,.7152,.0722][i],0)
    const result = []
    for (const el of document.querySelectorAll('main *, nav a, .demo-notice *, .breadcrumb *, .app-footer *')) {
      if (!Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue
      const rect = el.getBoundingClientRect(), cs = getComputedStyle(el)
      if (!rect.width || !rect.height || cs.visibility === 'hidden' || el.closest('button:disabled') || el.classList.contains('sr-only')) continue
      const foreground = rgb(cs.color)
      if (!foreground) continue
      let parent = el, background = [248,247,243]
      while (parent) { const candidate=rgb(getComputedStyle(parent).backgroundColor); if (candidate && (candidate.length < 4 || candidate[3] > .99)) { background=candidate; break } parent=parent.parentElement }
      const a=luminance(foreground), b=luminance(background), contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
      const size=parseFloat(cs.fontSize), weight=parseInt(cs.fontWeight), limit=size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5
      if (contrast < limit) result.push({ text:el.textContent.trim().slice(0,55), selector:el.tagName.toLowerCase()+'.'+el.className, color:cs.color, background, ratio:+contrast.toFixed(2), limit })
    }
    return result
  })
  contrastFailures.push(...failures.map(f => ({ route:name, ...f })))
}
try {
  await go('/impacts')
  ok(await page.locator('.impact-table tbody tr').count() === 6, 'six synthetic review cases')
  ok(await page.locator('.demo-notice').isVisible(), 'synthetic data notice is visible')
  ok(await page.evaluate(() => window.scrollY) === 0, 'initial focus does not scroll past navigation')
  await shot('queue-1440'); await noOverflow('queue desktop'); await auditContrast('queue')
  await page.getByRole('tab', { name: /시행 예정/ }).click()
  ok(await page.locator('.impact-table tbody tr').count() === 1, 'upcoming filter')
  await page.getByRole('tab', { name: /전체/ }).click()
  await page.getByRole('textbox', { name: '조례 또는 사업 검색' }).fill('없는사업')
  ok(await page.getByText('조건에 맞는 변경이 없습니다').isVisible(), 'search empty state')
  await page.getByRole('button', { name: '필터 초기화' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '검토 보고서', exact: true }).click()
  const download = await downloadPromise
  ok(download.suggestedFilename().endsWith('.md'), 'review report download')
  await page.locator('.case-title').first().click()
  await page.waitForURL('**/impacts/OI-001')
  ok(await page.getByRole('button', { name: '정정안 승인', exact:true }).count() === 0, 'approval is not exposed before the draft is opened')
  await shot('comparison-1440'); await auditContrast('comparison')
  await page.getByRole('button', { name: '변경 근거 보기' }).click()
  ok(await page.getByRole('dialog').isVisible(), 'source and supplementary provision dialog')
  await page.keyboard.press('Escape')
  ok(await page.getByRole('dialog').count() === 0, 'Escape closes source dialog')
  ok(await page.getByRole('button', { name:'변경 근거 보기' }).evaluate(e => e === document.activeElement), 'dialog restores focus to trigger')
  await page.getByRole('button', { name: '정정 초안 보기' }).click()
  const approve = page.getByRole('button', { name: '정정안 승인', exact:true })
  ok(await approve.isDisabled(), 'approval requires explicit review check')
  const draft = page.getByRole('textbox', { name: '정정할 안내 문구' })
  await draft.fill('180일 이내 신청하면 999만원을 지급합니다.')
  await page.getByRole('checkbox').check()
  ok(await approve.isDisabled(), 'unsupported edited content cannot be approved')
  await page.getByRole('button', { name:'예시 초안 복원' }).click()
  ok(!await page.getByRole('checkbox').isChecked(), 'restoring draft clears review confirmation')
  await page.getByRole('checkbox').check()
  ok(await approve.isEnabled(), 'valid synthetic draft can be approved after confirmation')
  await shot('draft-1440'); await auditContrast('draft')
  await approve.click()
  ok(await page.getByRole('heading', { name:'정정안을 승인했습니다' }).isVisible(), 'approval state is separate from verification')
  const verify=page.getByRole('button', { name:'수정 확인', exact:true })
  ok(await verify.isDisabled(), 'verification requires separate reflection check')
  await shot('approved-1440')
  await page.getByRole('checkbox').check()
  await verify.click()
  ok(await page.getByRole('heading', { name:'수정 확인을 마쳤습니다' }).isVisible(), 'separate synthetic result verification')
  await shot('verified-1440'); await auditContrast('verified')
  await page.getByRole('link', { name:'검토 이력 보기' }).click()
  ok(await page.getByRole('heading', { name:'가상 정정안 승인', exact:true }).isVisible(), 'approval audit record')
  ok(await page.getByRole('heading', { name:'가상 수정 결과 확인', exact:true }).isVisible(), 'verification audit record')
  await shot('history-1440'); await auditContrast('history')

  await go('/impacts/OI-004')
  ok(await page.getByText('시행 전 기준으로 안내 중입니다').isVisible(), 'upcoming guidance is not presented as a current error')
  await page.getByRole('button', { name:'정정 초안 보기' }).click()
  await page.getByRole('checkbox').check()
  ok(await page.getByRole('button', { name:'정정안 승인', exact:true }).isDisabled(), 'future-effective case remains blocked')
  await shot('upcoming-1440')
  await go('/impacts/OI-005')
  await page.getByRole('button', { name:'정정 초안 보기' }).click()
  await page.getByRole('checkbox').check()
  ok(await page.getByRole('button', { name:'정정안 승인', exact:true }).isDisabled(), 'uncertain supplementary applicability remains blocked')
  await shot('needs-evidence-1440'); await auditContrast('needs-evidence')
  await go('/impacts/OI-006')
  await page.getByRole('button', { name:'정정 초안 보기' }).click()
  await page.getByRole('checkbox').check()
  ok(await page.getByRole('button', { name:'정정안 승인', exact:true }).isDisabled(), 'unconfirmed program link remains blocked')

  await go('/impacts/OI-003')
  await page.getByRole('button', { name:'검토 제외', exact:true }).click()
  await page.getByRole('textbox', { name:'제외 사유' }).fill('가상 검토에서 해당 안내자료의 대상 시기와 일치하지 않음을 확인했습니다.')
  await page.getByRole('button', { name:'사유를 남기고 제외' }).click()
  ok(await page.getByRole('heading', { name:'검토 제외 사유를 기록했습니다' }).isVisible(), 'dismissal requires a recorded reason')
  for (const path of ['/links','/sources']) { await go(path); await shot(path.slice(1)+'-1440'); await noOverflow(path+' desktop'); await auditContrast(path) }

  await page.setViewportSize({width:1024,height:900})
  await go('/impacts/OI-001'); await noOverflow('detail tablet'); await shot('comparison-1024')
  await page.setViewportSize({width:390,height:844})
  for (const path of ['/impacts','/impacts/OI-001','/links','/sources','/history']) { await go(path); await noOverflow(path+' mobile'); await shot((path === '/impacts/OI-001' ? 'comparison' : path.slice(1))+'-390') }
  await page.setViewportSize({width:360,height:800})
  await go('/impacts/OI-001'); await noOverflow('detail small mobile')
  ok(errors.length === 0, 'no browser console or runtime errors: '+errors.join(' | '))
  await writeFile(output+'/qa-report.json',JSON.stringify({checks,errors,contrastFailures},null,2))
  if (contrastFailures.length) console.log('CONTRAST REVIEW: '+JSON.stringify(contrastFailures,null,2))
  ok(contrastFailures.length === 0, 'sampled visible text contrast meets 4.5:1 (large 3:1); not a complete WCAG audit')
  console.log('UI checks passed: '+checks.length)
} catch (error) {
  await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{})
  await writeFile(output+'/qa-report.json',JSON.stringify({checks,errors,contrastFailures,error:String(error)},null,2))
  throw error
} finally { await browser.close() }
