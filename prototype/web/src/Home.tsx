import { Link } from 'react-router-dom'
import { ArrowRight, CircleAlert, History, ScanText } from 'lucide-react'
import { ACTION_LABEL, byPriority, decisionRecords, fmtTime, place, topItems, useData, weekRecords } from './data'
import { EmptyState, HBar, LampIcon, LevelBadge, LevelMark, Skeleton, type BarRow } from './ui'
import familyUrl from '../../../design/assets/family-papercut.svg'

const ignoreCause = new Set(['해당없음', '미확인'])
const DAY = 864e5
const CUT = ['cut1', 'cut2', 'cut3']
const TILT = ['.5deg', '-.6deg', '.4deg', '-.4deg']

function House({ level, urgent }: { level: '긴급' | '주의' | '관찰'; urgent: boolean }) {
  const fill = level === '긴급' ? 'var(--text)' : level === '주의' ? 'var(--wood-700)' : 'var(--wood-300)'
  return (
    <svg width="30" height="36" viewBox="0 -2 26 34" aria-hidden="true">
      <path d="M13 8 24 17v13H2V17z" fill={fill} /><path d="M10 30v-8h6v8z" fill="#FFFDF8" />
      {urgent && <><path d="M9.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5z" fill="var(--siren-600)" /><rect x="8" y="8.5" width="10" height="2" fill="var(--text)" /></>}
    </svg>
  )
}

function Spark({ v }: { v: number[] }) {
  const m = Math.max(1, ...v)
  return (
    <svg className="spark" viewBox="0 0 70 24" role="img" aria-label={`최근 7일 처리 건수 ${v.join(', ')}`}>
      {v.map((x, i) => <rect key={i} x={i * 10 + 1} y={24 - (x / m) * 22 - 1} width={8} height={(x / m) * 22 + 1} rx={1} fill="currentColor" opacity={x ? 1 : 0.3} />)}
    </svg>
  )
}

export default function Home() {
  const { meta, cases, log, error, retry } = useData()
  if (error) return <p className="err"><CircleAlert size={18} aria-hidden="true" />오류 현황을 불러오지 못했습니다. <button className="linkbtn" onClick={retry}>다시 시도</button></p>
  if (!cases || !meta) return <Skeleton label="불러오는 중입니다." />

  const ref = new Date(meta.reference_date).getTime()
  const waiting = cases.filter((c) => !c.decided)
  const byLevel = (l: string) => waiting.filter((c) => c.f2.level === l).length
  const due = cases.filter((c) => (!c.decided || c.decision.status === '재확인 예약') && new Date(c.f2.next_check_due).getTime() <= ref + 7 * DAY)
  const recs = decisionRecords(cases, log)
  const week = weekRecords(recs, meta.reference_date)
  const spark = Array.from({ length: 7 }, (_, i) => { const d = new Date(ref - (6 - i) * DAY).toISOString().slice(0, 10); return week.filter((r) => r.at.slice(0, 10) === d).length })

  const cause = new Map<string, number>()
  cases.forEach((c) => new Set(c.household.memos.map((m) => m.f1.barrier_cause).filter((x) => !ignoreCause.has(x))).forEach((x) => cause.set(x, (cause.get(x) ?? 0) + 1)))
  const repeated = new Map<string, number>()
  cases.forEach((c) => { const r = c.household.repeated_barrier; if (r) repeated.set(r.cause, (repeated.get(r.cause) ?? 0) + 1) })
  const causeRows: BarRow[] = [...cause].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, text: `${v}가구`, sub: repeated.get(k) ? `반복 장벽 ${repeated.get(k)}가구 포함` : undefined }))
  const topCause = [...repeated].sort((a, b) => b[1] - a[1])[0]?.[0] ?? causeRows[0]?.label ?? '—'
  const buckets: [string, (d: number) => boolean][] = [['30일 이내', (d) => d <= 30], ['31~60일', (d) => d > 30 && d <= 60], ['61~90일', (d) => d > 60 && d <= 90], ['91~120일', (d) => d > 90 && d <= 120], ['121일 이상', (d) => d > 120]]
  const days = buckets.map(([label, f]): BarRow => { const n = cases.filter((c) => f(c.household.days_since_closure)).length; return { label, value: n, text: `${n}가구` } })

  const ranked = [...cases].sort(byPriority)
  const top = [...waiting].sort(byPriority).slice(0, 3)
  const inLog = new Set(log.filter((e) => e.kind === 'decision').map((e) => e.caseId))
  const seed = recs.filter((r) => !inLog.has(r.caseId)).map((r) => ({ id: `s-${r.caseId}`, at: r.at, text: `${r.caseId} 판단 저장: ${ACTION_LABEL(r.status as never)}`, by: r.by }))
  const feed = [...log.map((e) => ({ id: e.id, at: e.at, text: e.text, by: e.by ?? '' })), ...seed].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)

  return (
    <>
      <h1 className="sr-only">오늘의 현황</h1>
      <section className="hero" aria-label="요약">
        <div className="hero-l">
          <div className="eyebrow">다시 찾아갈 가구</div>
          <Link to="/queue?status=미검토" className="huge num" aria-label={`재검토 대상 ${waiting.length}가구, 대기열 보기`}>{waiting.length}<small>가구</small></Link>
          <div className="tally">
            <Link to="/queue?tab=긴급&status=미검토" aria-label={`긴급 ${byLevel('긴급')}`}><LevelMark level="긴급" /><span className="v num">{byLevel('긴급')}</span></Link>
            <Link to="/queue?tab=주의&status=미검토" aria-label={`주의 ${byLevel('주의')}`}><LevelMark level="주의" /><span className="v num">{byLevel('주의')}</span></Link>
            <Link to="/queue?tab=관찰&status=미검토" aria-label={`관찰 ${byLevel('관찰')}`}><LevelMark level="관찰" /><span className="v num">{byLevel('관찰')}</span></Link>
          </div>
          <Link className="demo" to="/analyze?auto=1"><ScanText size={18} aria-hidden="true" />메모 두 건으로 재검토 과정 보기 <b>데모 실행</b><ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="ill"><div className="paper cut1"><span className="tag num">미검토 {waiting.length} · 전체 {cases.length}</span><img src={familyUrl} alt="" /></div></div>
        <div className="scraps">
          <Scrap i={0} to="/queue?due=1" v={due.length} l="재확인 도래" />
          <Scrap i={1} to="/records?week=1" v={week.length} l="이번 주 처리" extra={<Spark v={spark} />} />
          <Scrap i={2} to="/queue?tab=긴급&status=미검토" v={byLevel('긴급')} l="긴급" lamp />
          <Scrap i={3} to="/queue?reason=반복 장벽" v={topCause} l="반복 장벽 1위" text />
        </div>
      </section>

      <div className="strip-w">
        <span className="l">전체 {cases.length}가구 · 점수</span>
        <ul className="strip">
          {ranked.map((c) => (
            <li key={c.household.id}>
              <Link to={`/case/${c.household.id}`} className="hm" data-tip={`${c.household.id} · ${c.f2.total}점`} aria-label={`${c.household.id} ${c.f2.level} ${c.f2.total}점`}>
                <House level={c.f2.level} urgent={c.f2.level === '긴급'} /><span className="num">{c.f2.total}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="sec-head"><h2 className="sec">오늘 먼저 볼 가구 <i>점수 순</i></h2><Link to="/queue">대기열 전체 보기<ArrowRight size={16} aria-hidden="true" /></Link></div>
      {top.length === 0 ? <EmptyState title="미검토 가구 없음" /> : (
        <ul className="notes">
          {top.map((c, n) => (
            <li key={c.household.id} className="pw" style={{ transform: `rotate(${TILT[n % 4]})` }}>
              <Link to={`/case/${c.household.id}`} className={`paper ${CUT[n % 3]} note`}>
                <span className="clip" aria-hidden="true" />
                <span className="rk serif">{n + 1}</span>
                <span className="nid num">{c.household.id}</span>
                <span className="nloc">{place(c)} · {c.household.household_type}</span>
                <span className="n2"><span className="sc serif num">{c.f2.total}</span><span className="why">{topItems(c)[0]?.chip}</span></span>
                <span className="n3"><LevelBadge level={c.f2.level} /><span className="act">{ACTION_LABEL(c.action.outreach)}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="home-cols">
        <section aria-labelledby="feed">
          <h2 className="sec" id="feed"><History size={18} aria-hidden="true" /> 최근 활동</h2>
          {feed.length === 0 ? <p className="muted">활동 없음</p> : (
            <ul className="feed">{feed.map((e) => <li key={e.id}><span>{e.text}</span><small>{fmtTime(e.at)}{e.by && ` · ${e.by}`}</small></li>)}</ul>
          )}
        </section>
        <section aria-labelledby="c1">
          <h2 className="sec" id="c1">장벽 원인 <i>가구</i></h2>
          {causeRows.length ? <HBar rows={causeRows} label="장벽 원인별 가구 수" /> : <p className="muted">없음</p>}
        </section>
        <section aria-labelledby="c3">
          <h2 className="sec" id="c3">종결 후 경과 <i>가구</i></h2>
          <HBar rows={days} max={cases.length} label="종결 후 경과일별 가구 수" />
          <p className="caption muted">긴급 ≥{meta.level_thresholds.긴급}점 · 주의 ≥{meta.level_thresholds.주의}점 또는 '처리 확인 필요' 플래그</p>
        </section>
      </div>
    </>
  )
}

function Scrap({ i, to, v, l, lamp, text, extra }: { i: number; to: string; v: number | string; l: string; lamp?: boolean; text?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="pw" style={{ transform: `rotate(${TILT[i]})` }}>
      <Link to={to} className={`paper ${CUT[(i + 1) % 3]} scr`}>
        <span className={`v serif num${text ? ' t' : ''}`}>{v}</span>
        <span className="l">{lamp && <LampIcon lit size={20} />}{l}</span>
        {extra}
      </Link>
    </div>
  )
}
