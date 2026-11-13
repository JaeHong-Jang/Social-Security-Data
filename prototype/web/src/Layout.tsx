import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, matchPath } from 'react-router-dom'
import { RotateCcw, Server } from 'lucide-react'
import { LampIcon, ConfirmDialog, Hint, useToast } from './ui'
import { byPriority, resetDemo, useData } from './data'
import { useHealth } from './analyzeApi'

let lastCase: string | null = null

const TITLES: [string, string][] = [
  ['/', '오늘의 현황'], ['/queue', '대기열'], ['/case/:id', '가구 상세'], ['/case/:id/reguide', '조건 대조·재안내'],
  ['/analyze', '메모 분석'], ['/records', '기록'], ['/data', '근거 · 데이터 진단'], ['/rules', '근거 · 규칙 공개'],
]
const DAYS = ['일', '월', '화', '수', '목', '금', '토']

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { meta, cases, source } = useData()
  const health = useHealth()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  const m = matchPath('/case/:id/*', pathname)
  if (m?.params.id) lastCase = m.params.id
  const all = cases ?? []
  const first = [...all].filter((c) => !c.decided).sort(byPriority)[0] ?? [...all].sort(byPriority)[0]
  const caseId = lastCase ?? first?.household.id ?? 'H-0412'
  const waiting = all.filter((c) => !c.decided).length
  const urgent = all.filter((c) => !c.decided && c.f2.level === '긴급').length
  const title = TITLES.find(([p]) => matchPath({ path: p, end: true }, pathname))?.[1] ?? '이음등'
  const d = meta ? new Date(meta.reference_date) : new Date()
  const dateLine = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`
  const dateShort = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}`

  const items: { no: string; to: string; label: string; short: string; on: boolean; badge?: ReactNode }[] = [
    { no: '01', to: '/', label: '오늘의 현황', short: '현황', on: pathname === '/' },
    { no: '02', to: '/queue', label: '대기열', short: '대기열', on: pathname === '/queue',
      badge: <span className="nbn" title="미검토 기준" aria-label={`미검토 ${waiting}${urgent ? `, 긴급 ${urgent}` : ''}`}>{waiting}{urgent > 0 && <em>긴급 {urgent}</em>}</span> },
    { no: '03', to: `/case/${caseId}`, label: '가구 상세', short: '가구', on: !!m },
    { no: '04', to: '/analyze', label: '메모 분석', short: '분석', on: pathname === '/analyze' },
    { no: '05', to: '/records', label: '기록', short: '기록', on: pathname === '/records' },
    { no: '06', to: '/data', label: '근거', short: '근거', on: pathname === '/data' || pathname === '/rules' },
  ]
  const ai = health.state === 'live' ? { t: '분석 서버 연결됨', cls: 'ok' }
    : health.state === 'checking' ? { t: '서버 확인 중', cls: '' } : { t: '녹화 재생', cls: 'rep' }

  return (
    <div className="d-shell">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>본문으로 건너뛰기</a>
      <div className="d-page">
        <header className="mast-wrap">
          <div className="mast">
            <NavLink to="/" className="logo" aria-label="이음등 홈"><LampIcon size={28} /><span>이음등</span></NavLink>
            <div className="dateline num"><span className="d-long">{dateLine}</span><span className="d-short">{dateShort}</span><span className="d-title">{title}</span></div>
            <nav className="dnav" aria-label="주 메뉴">
              {items.map((it) => (
                <NavLink key={it.no} to={it.to} className={`dnav-i${it.on ? ' on' : ''}`} aria-current={it.on ? 'page' : undefined}>
                  <i>{it.no}</i><span>{it.label}</span>{it.badge}
                </NavLink>
              ))}
            </nav>
            <span className="virt" title={meta?.notice}>가상 데이터</span>
          </div>
          <div className="rule2" />
          <div className="util">
            <span className="who">{meta?.region?.sgg ?? '강북구'} 희망복지지원단 · 담당자(가상)</span>
            <span className="spacer" />
            <span className={`srv ${ai.cls}`} title={ai.t}><Server size={16} aria-hidden="true" /><span className="srv-t">{ai.t}</span></span>
            <button className="linkbtn reset" onClick={() => setConfirm(true)}><RotateCcw size={15} aria-hidden="true" />데모 초기화</button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="page">{children}</main>
        <footer className="footer">
          <p>가상 데이터 · 시연용 | 주최 한국사회보장정보원·대구가톨릭대학교
            <Hint label="데이터 출처·모델 정보">
              <p>데이터: {source === 'api' ? '분석 서버(/api/cases)' : '내장 가상 데이터'} · 실제 행복이음 시스템 아님</p>
              {meta && <p>{meta.notice}</p>}
              {meta && <p>모델 {meta.f1_model_info.model} (digest {meta.f1_model_info.digest}) · 프롬프트 {meta.f1_prompt_version} · 실행 {meta.f1_run_at}</p>}
            </Hint>
          </p>
        </footer>
      </div>
      <nav className="tabbar-m" aria-label="하단 메뉴">
        {items.map((it) => (
          <NavLink key={it.no} to={it.to} className={`tb-i${it.on ? ' on' : ''}`} aria-current={it.on ? 'page' : undefined}><i>{it.no}</i><span>{it.short}</span></NavLink>
        ))}
      </nav>
      {confirm && (
        <ConfirmDialog title="데모를 초기화할까요?" confirm="초기화"
          body="저장한 판단·배정·기록·추가한 가구를 모두 지웁니다."
          onCancel={() => setConfirm(false)} onConfirm={() => { resetDemo(); setConfirm(false); toast('데모를 초기화했습니다.') }} />
      )}
    </div>
  )
}
