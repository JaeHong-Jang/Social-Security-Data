import { Link } from 'react-router-dom'
import { ArrowRight, CircleAlert, ScanText } from 'lucide-react'
import { ACTION_LABEL, byPriority, decisionRecords, fmtTime, place, topItems, useData, weekRecords } from './data'
import { EmptyState, LevelBadge, LevelMark, Skeleton, type BarRow } from './ui'
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

function Spark({ v, days }: { v: number[]; days: string[] }) {
  const m = Math.max(1, ...v)
  return (
    <span className="spark" role="img" aria-label={`최근 7일 처리 건수 ${v.join(', ')}`}>
      {v.map((x, i) => (
        <span key={i} className="sp-c"><span className={`sp-b${x ? '' : ' z'}`} style={{ height: `${x ? 4 + (x / m) * 18 : 2}px` }} /><span className="sp-d" aria-hidden="true">{days[i]}</span></span>
      ))}
    </span>
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
  const WD = '일월화수목금토'
  const sparkDays = Array.from({ length: 7 }, (_, i) => WD[new Date(ref - (6 - i) * DAY).getDay()])
  const dueBy = new Date(ref + 7 * DAY)
  const safety = cases.filter((c) => !!c.action.safety_check).length
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
  const feed = [...log.map((e) => ({ id: e.id, at: e.at, text: e.text, by: e.by ?? '' })), ...seed].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  const scale = Math.max(5, ...causeRows.map((r) => r.value), ...days.map((r) => r.value))
  const causeHouseholds = cases.filter((c) => c.household.memos.some((m) => !ignoreCause.has(m.f1.barrier_cause))).length

  return (
    <>
      <h1 className="sr-only">오늘의 현황</h1>
      <section className="hero" aria-label="요약">
        <div className="hero-l">
          <div className="eyebrow">다시 찾아갈 가구</div>
          <Link to="/queue?status=미검토" className="huge num" aria-label={`재검토 대상 ${waiting.length}가구, 대기열 보기`}>{waiting.length}<small>가구</small></Link>
          <div className="tally">
            {(['긴급', '주의', '관찰'] as const).map((lv) => (
              <Link key={lv} to={`/queue?tab=${lv}&status=미검토`} className={`t-${lv}`} aria-label={`${lv} ${byLevel(lv)}가구`}>
                <span className="tlab"><LevelMark level={lv} size={16} />{lv}</span>
                <span className="v num">{byLevel(lv)}</span>
              </Link>
            ))}
          </div>
          <Link className="demo" to="/analyze?auto=1"><ScanText size={18} aria-hidden="true" />메모 두 건으로 재검토 과정 보기 <b>데모 실행</b><ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="ill"><div className="paper cut1"><span className="tag num">미검토 {waiting.length} · 전체 {cases.length}</span><img src={familyUrl} alt="" /></div></div>
        <div className="scraps">
          <Scrap i={0} to="/queue?due=1" l="재확인 도래" v={due.length} u="가구" note={`${dueBy.getMonth() + 1}.${dueBy.getDate()}까지`} />
          <Scrap i={1} to="/records?week=1" l="이번 주 처리" v={week.length} u="건" note={<Spark v={spark} days={sparkDays} />} />
          <Scrap i={2} to="/queue?safety=1" l="안전 확인 경로" v={safety} u="가구" note="주변 경로로 확인" />
          <Scrap i={3} to="/queue?reason=반복 장벽" l="반복 장벽 1위" v={topCause} text note={`${cause.get(topCause) ?? 0}가구 · 반복 ${repeated.get(topCause) ?? 0}가구`} />
        </div>
      </section>

      <div className="top">
        <h2 className="sec">오늘 먼저 볼 가구 <small>점수 순 · <Link to="/queue" className="lnk">대기열 전체 보기</Link></small></h2>
        <ul className="strip" aria-label={`전체 ${cases.length}가구 점수 순`}>
          {ranked.map((c) => (
            <li key={c.household.id}>
              <Link to={`/case/${c.household.id}`} className="hm" data-tip={`${c.household.id} · ${c.f2.total}점`} aria-label={`${c.household.id} ${c.f2.level} ${c.f2.total}점`}>
                <House level={c.f2.level} urgent={c.f2.level === '긴급'} /><span className="num">{c.f2.total}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {top.length === 0 ? <EmptyState title="미검토 가구 없음" /> : (
        <ul className="ncs">
          {top.map((c, n) => (
            <li key={c.household.id}>
              <Link to={`/case/${c.household.id}`} className="nc">
                <span className="rk serif">{n + 1}</span>
                <span className="nid num">{c.household.id}</span>
                <span className="nloc">{place(c)} · {c.household.household_type}</span>
                <span className="n2"><b className="serif num">{c.f2.total}</b><span>{topItems(c)[0]?.chip}</span></span>
                <span className="n3"><LevelBadge level={c.f2.level} /><span className="lnk">{ACTION_LABEL(c.action.outreach)}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="modwrap">
        <div className="modgrid">
          <section className="mod" aria-labelledby="feed">
            <div className="mh"><h3 id="feed" className="serif">최근 활동</h3><span className="c num">{feed.length}</span></div>
            <ol className="rows">
              {feed.map((e) => {
                const m = e.text.match(/^([AH]-\d+)\s+(.*)$/)
                const [d] = fmtTime(e.at).split(' ')
                const rest = (m ? m[2] : e.text).replace(/^판단 저장: /, '').replace(/: /, ' · ')
                return (
                  <li key={e.id} className="rw lg">
                    <span className="d num">{d.slice(5).replace('-', '.')}</span>
                    {m ? <Link to={`/case/${m[1]}`} className="lnk num">{m[1]}</Link> : <span />}
                    <span className="v" title={rest}>{rest}</span>
                  </li>
                )
              })}
              {Array.from({ length: Math.max(0, 5 - feed.length) }, (_, i) => <li key={`e${i}`} className="rw rw-e" aria-hidden="true" />)}
            </ol>
            <div className="mf"><Link to="/records" className="lnk">기록 전체</Link></div>
          </section>
          <section className="mod" aria-labelledby="c1">
            <div className="mh"><h3 id="c1" className="serif">장벽 원인</h3><span className="c num">{causeHouseholds}가구</span></div>
            <ul className="rows" aria-label="장벽 원인별 가구 수">
              {causeRows.slice(0, 5).map((r) => (
                <li key={r.label} className="rw br" aria-label={`${r.label} ${r.value}가구${repeated.get(r.label) ? `, 반복 ${repeated.get(r.label)}가구` : ''}`}>
                  <span className="lb">{r.label}{repeated.get(r.label) ? <em>반복</em> : null}</span>
                  <span className="trk" aria-hidden="true"><i style={{ width: `${(r.value / scale) * 100}%` }} /></span>
                  <b className="num">{r.value}</b>
                </li>
              ))}
              {Array.from({ length: Math.max(0, 5 - causeRows.length) }, (_, i) => <li key={`e${i}`} className="rw rw-e" aria-hidden="true" />)}
            </ul>
            <div className="mf"><Link to="/data" className="lnk">근거 보기</Link></div>
          </section>
          <section className="mod" aria-labelledby="c3">
            <div className="mh"><h3 id="c3" className="serif">종결 후 경과</h3><span className="c num">{cases.length}가구</span></div>
            <ul className="rows" aria-label="종결 후 경과일별 가구 수">
              {days.map((r) => (
                <li key={r.label} className="rw br" aria-label={`${r.label} ${r.value}가구`}>
                  <span className="lb">{r.label}</span>
                  <span className="trk" aria-hidden="true"><i style={{ width: `${(r.value / scale) * 100}%` }} /></span>
                  <b className="num">{r.value}</b>
                </li>
              ))}
            </ul>
            <div className="mf"><Link to="/queue" className="lnk">대기열에서 보기</Link></div>
          </section>
        </div>
      </div>
    </>
  )
}

function Scrap({ i, to, l, v, u, text, note }: { i: number; to: string; l: string; v: number | string; u?: string; text?: boolean; note?: React.ReactNode }) {
  return (
    <div className="pw" style={{ transform: `rotate(${TILT[i]})` }}>
      <Link to={to} className={`paper ${CUT[(i + 1) % 3]} scr`}>
        <span className="l">{l}</span>
        <span className={`v serif num${text ? ' t' : ''}`}>{v}{u && <small>{u}</small>}</span>
        {note && <span className="nt">{note}</span>}
      </Link>
    </div>
  )
}
