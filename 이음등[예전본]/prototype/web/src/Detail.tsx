import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Ban, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleX, ShieldCheck } from 'lucide-react'
import {
  ACTION_LABEL, OUTREACH, byPriority, confirmInterpretation, fmtTime, md, place, reviewKey, saveDecision, setReview, setReviewMany, shortReason, sourceLabel, useData,
  type LogEntry, type Memo, type Meta, type Outreach, type Review, type View,
} from './data'
import { EmptyState, FairnessNote, LampIcon, LevelBadge, ScoreBar, Skeleton, Stamp, StatusTag, Tag, useToast } from './ui'

const VISIT: Outreach[] = ['동행 신청 지원(재방문)', '심층상담(재방문)', '재방문']
const IGN = new Set(['해당없음', '미확인'])
const GROUPS = ['업무·종결', '장벽 원인', '연락 의사', '관계망·고립'] as const

/** 문장 경계(오프셋). 마침표 뒤에 공백·끝이 올 때만 끊어 "10.29" 같은 숫자는 자르지 않는다. */
function sentences(t: string) {
  const out: { start: number; end: number }[] = []
  let s = 0
  const re = /[.!?。]+(?=\s|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const e = m.index + m[0].length
    out.push({ start: s, end: e })
    s = e
    while (t[s] === ' ') s++
  }
  if (s < t.length) out.push({ start: s, end: t.length })
  return out
}

interface Note { k: string; v: string; strong?: boolean }
/** 근거 오프셋이 시작하는 문장에 여백 주석을 붙인다(문자열 검색 없음). */
function notesBySentence(m: Memo, sents: { start: number; end: number }[], labels: Record<string, string>) {
  const out: Note[][] = sents.map(() => [])
  const f = m.f1
  m.f1.evidence.forEach((e) => {
    const i = sents.findIndex((s) => e.start >= s.start && e.start < s.end)
    if (i < 0) return
    let n: Note | null = null
    if (e.field === 'barrier_cause' && !IGN.has(f.barrier_cause)) n = { k: '장벽', v: f.barrier_cause, strong: true }
    else if (e.field === 'closure_type' && f.closure_type) n = { k: '종결', v: labels[f.closure_type] ?? f.closure_type }
    else if (e.field.startsWith('consent.')) { const x = e.field.slice(8) as '신청'; n = { k: x, v: f.consent[x] } }
    else if (e.field === 'support_network' && !IGN.has(f.support_network)) n = { k: '관계망', v: f.support_network }
    else if (e.field.startsWith('isolation_signals.')) n = { k: '고립', v: e.field.slice(18) }
    if (n && !out[i].some((x) => x.k === n!.k && x.v === n!.v)) out[i].push(n)
  })
  return out.map((a) => [...a].sort((x, y) => Number(!!y.strong) - Number(!!x.strong)))
}

export default function Detail() {
  const { id } = useParams()
  const { meta, cases, error, retry, review, log } = useData()
  if (error) return <p className="err"><CircleAlert size={18} aria-hidden="true" />오류 가구 정보를 불러오지 못했습니다. <button className="linkbtn" onClick={retry}>다시 시도</button></p>
  if (!cases || !meta) return <Skeleton label="불러오는 중입니다." />
  const c = cases.find((x) => x.household.id === id)
  if (!c) {
    return <><h1>가구를 찾을 수 없습니다</h1><EmptyState title="해당 번호의 가구가 없습니다." action={<Link className="btn" to="/queue">재검토 대기열로</Link>} /></>
  }
  const order = [...cases].sort(byPriority).map((x) => x.household.id)
  const at = order.indexOf(c.household.id)
  return <DetailBody key={c.household.id} c={c} labels={meta.closure_labels} meta={meta} review={review} log={log} prev={order[at - 1] ?? null} next={order[at + 1] ?? null} pos={`${at + 1} / ${order.length}`} />
}

const TABS = [{ k: 'memos', l: '회차별 메모' }, { k: 'score', l: '점수' }, { k: 'cond', l: '조건 대조' }, { k: 'log', l: '기록' }] as const
type TabKey = (typeof TABS)[number]['k']

function DetailBody({ c, labels, review, log, prev, next, pos }: { c: View; labels: Record<string, string>; meta: Meta; review: Record<string, Review>; log: LogEntry[]; prev: string | null; next: string | null; pos: string }) {
  const toast = useToast()
  const h = c.household
  const urgent = c.f2.level === '긴급' && !c.decided
  const [tab, setTab] = useState<TabKey>('memos')
  const [sel, setSel] = useState(Math.max(0, h.memos.length - 1))
  const [flash, setFlash] = useState<{ mi: number; start: number; end: number } | null>(null)
  const [evOpen, setEvOpen] = useState(false)
  const [fix, setFix] = useState<Record<number, boolean>>({})
  const trRefs = useRef<(HTMLButtonElement | null)[]>([])
  const markRefs = useRef<Record<string, HTMLElement | null>>({})
  const rb = h.repeated_barrier
  const B = c.f2.items.find((i) => i.key === 'B')

  const m = h.memos[sel]
  const sents = sentences(m.text)
  const notes = notesBySentence(m, sents, labels)
  const barrier = !IGN.has(m.f1.barrier_cause)
  /** 선택한 회차에서 강조할 구간: 장벽 근거만 */
  const hl = [
    ...m.f1.evidence.filter((e) => e.field === 'barrier_cause').map((e) => ({ start: e.start, end: e.end })),
    ...(rb?.quotes.filter((q) => q.memo_index === sel).map((q) => ({ start: q.start, end: q.end })) ?? []),
  ]
  if (flash && flash.mi === sel) hl.push({ start: flash.start, end: flash.end })
  const cuts = (s: { start: number; end: number }) => {
    const pts = new Set([s.start, s.end])
    hl.forEach((r) => { if (r.end > s.start && r.start < s.end) { pts.add(Math.max(r.start, s.start)); pts.add(Math.min(r.end, s.end)) } })
    const a = [...pts].sort((x, y) => x - y)
    return a.slice(0, -1).map((from, k) => {
      const to = a[k + 1]
      return { from, to, on: hl.some((r) => r.start <= from && to <= r.end), flash: !!flash && flash.mi === sel && flash.start <= from && to <= flash.end }
    })
  }

  const selectMemo = (i: number, focusBtn = false) => { setSel(i); setFlash(null); if (focusBtn) setTimeout(() => trRefs.current[i]?.focus(), 0) }
  const quotesOf = (i: number) => (rb?.quotes.filter((q) => q.memo_index === i) ?? [])
  const goMemo = (i: number, q?: { start: number; end: number }) => {
    setTab('memos'); setSel(i)
    const qq = q ?? quotesOf(i)[0] ?? h.memos[i].f1.evidence.find((e) => e.field === 'barrier_cause')
    if (qq) setFlash({ mi: i, start: qq.start, end: qq.end }); else setFlash(null)
    setTimeout(() => document.querySelector('.passage mark.on, .passage')?.scrollIntoView({ block: 'center' }), 80)
  }
  const focusQuote = (quote: string) => {
    for (let i = h.memos.length - 1; i >= 0; i--) {
      const at = h.memos[i].text.indexOf(quote)
      if (at >= 0) { goMemo(i, { start: at, end: at + quote.length }); return }
    }
  }
  const locate = (quote: string) => h.memos.some((x) => x.text.includes(quote))

  const caseLog = [...log.filter((e) => e.caseId === h.id)].reverse()
  const repMemos = [...new Set(rb?.quotes.map((q) => q.memo_index) ?? [])].sort((a, b) => a - b)

  // 선택 회차 해석 검토
  const gKey = (g: string) => reviewKey(h.id, sel, g)
  const st = GROUPS.map((g) => review[gKey(g)])
  const allOk = st.every((x) => x === 'approved')
  const anyBad = st.some((x) => x === 'rejected')
  const fixOpen = !!fix[sel] || anyBad
  const confirmMemo = () => {
    if (allOk) { setReviewMany(h.id, sel, [...GROUPS], null, ''); return }
    setReviewMany(h.id, sel, [...GROUPS], 'approved', '해석 확인'); setFix({ ...fix, [sel]: false })
    const others = h.memos.every((_, i) => i === sel || GROUPS.every((g) => review[reviewKey(h.id, i, g)] === 'approved'))
    if (others) confirmInterpretation(h.id)
    toast(`${sel + 1}회차 해석을 확인했습니다.`)
  }
  const evRows: [string, string, string[]][] = [
    ['업무 상태', m.f1.work_status, m.f1.evidence.filter((e) => e.field === 'work_status').map((e) => e.quote)],
    ['종결 유형', m.f1.closure_type ? labels[m.f1.closure_type] : '판단 못함', m.f1.evidence.filter((e) => e.field === 'closure_type').map((e) => e.quote)],
    ['장벽 원인', m.f1.barrier_cause, m.f1.evidence.filter((e) => e.field === 'barrier_cause').map((e) => e.quote)],
    ['연락 의사', (['신청', '문자', '방문'] as const).map((k) => `${k} ${m.f1.consent[k]}`).join(' · '), m.f1.evidence.filter((e) => e.field.startsWith('consent.')).map((e) => e.quote)],
    ['도움 관계망', m.f1.support_network, m.f1.evidence.filter((e) => e.field === 'support_network').map((e) => e.quote)],
    ['고립 징후', m.f1.isolation_signals.length ? m.f1.isolation_signals.join(' · ') : '없음', m.f1.evidence.filter((e) => e.field.startsWith('isolation_signals')).map((e) => e.quote)],
  ]
  const uniq = (a: string[]) => [...new Set(a)]
  const copyText = async () => {
    try { await navigator.clipboard.writeText(m.text) } catch { /* 복사 불가 */ }
    toast(`${sel + 1}회차 원문을 복사했습니다.`)
  }

  useEffect(() => { markRefs.current = {} }, [sel])

  return (
    <>
      <div className="crumb">
        <span><Link to="/queue">대기열</Link> / <span className="num">{pos}</span></span>
        <span className="pnav">
          {prev ? <Link to={`/case/${prev}`}><ChevronLeft size={16} aria-hidden="true" />이전 가구 {prev}</Link> : <span className="off">이전 가구 없음</span>}
          {next ? <Link to={`/case/${next}`}>다음 가구 {next}<ChevronRight size={16} aria-hidden="true" /></Link> : <span className="off">다음 가구 없음</span>}
        </span>
      </div>
      <div className="ttl">
        <LampIcon lit={urgent} size={28} />
        <h1 className="num">{h.id}</h1>
        <LevelBadge level={c.f2.level} />
        <span className="meta">{place(c)} · {h.household_type} · 종결 후 {h.days_since_closure}일</span>
        <StatusTag c={c} />
        {c.f2.flags.map((f) => <Tag key={f} tone="warn" icon="help">{f}</Tag>)}
        {h.contact_refused && <Tag icon="ban">연락 거부 이력</Tag>}
        <span className="tot"><span className="sc"><b className="serif num">{c.f2.total}</b><small>/100</small></span><button className="lnk-btn" onClick={() => setTab('score')}>점수 구성</button></span>
      </div>

      <div className="find" role="note" aria-label="반복 결론">
        <span className="k">반복</span>
        <h2>{rb ? rb.summary : B?.unknown ? '회차 메모 1건 — 반복 여부 미확인' : '반복되는 장벽 없음'}</h2>
        {rb && (
          <span className="j">{h.memos.length}회 중 {repMemos.length}회{repMemos.map((i) => <Fragment key={i}> · <button className="lnk-btn" onClick={() => goMemo(i)}>{i + 1}회차</button></Fragment>)}</span>
        )}
      </div>

      <div className="layout">
        <div className="filecol">
          <div className="itabs" role="tablist" aria-label="가구 상세 구역" onKeyDown={(e) => {
            const i = TABS.findIndex((t) => t.k === tab)
            if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length].k)
            if (e.key === 'ArrowLeft') setTab(TABS[(i + TABS.length - 1) % TABS.length].k)
          }}>
            {TABS.map((t) => (
              <button key={t.k} role="tab" id={`itab-${t.k}`} aria-selected={tab === t.k} aria-controls="file-panel" tabIndex={tab === t.k ? 0 : -1} className={`itab${tab === t.k ? ' on' : ''}`} onClick={() => setTab(t.k)}>{t.l}</button>
            ))}
          </div>
          <div className="file" role="tabpanel" id="file-panel" aria-labelledby={`itab-${tab}`}>
            {tab === 'memos' && (
              <div className="mainrow">
                <ol className="tline" role="tablist" aria-orientation="vertical" aria-label="회차 선택" onKeyDown={(e) => {
                  const f = trRefs.current.findIndex((b) => b === document.activeElement)
                  const cur = f >= 0 ? f : sel
                  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); selectMemo(Math.min(h.memos.length - 1, cur + 1), true) }
                  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); selectMemo(Math.max(0, cur - 1), true) }
                  if (e.key === 'Home') { e.preventDefault(); selectMemo(0, true) }
                  if (e.key === 'End') { e.preventDefault(); selectMemo(h.memos.length - 1, true) }
                }}>
                  {h.memos.map((mm, i) => {
                    const b = !IGN.has(mm.f1.barrier_cause)
                    return (
                      <li key={i} role="presentation">
                        <button ref={(el) => { trRefs.current[i] = el }} role="tab" aria-selected={sel === i} tabIndex={sel === i ? 0 : -1} className={`tr${sel === i ? ' on' : ''}`} onClick={() => selectMemo(i)} aria-label={`${i + 1}회차 ${mm.written_at.slice(5).replace('-', '.')}${b ? ` 장벽 ${mm.f1.barrier_cause}` : ''}`}>
                          <span className={`dot${b ? ' b' : ''}`} aria-hidden="true" />
                          <span><b className="serif">{i + 1}회차</b><span className="num">{mm.written_at.slice(5).replace('-', '.')} · {mm.consult_type.replace(' 상담', '')}</span>{b && <em>{mm.f1.barrier_cause}</em>}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
                <section className="read" aria-label={`${sel + 1}회차 메모`}>
                  {!barrier && <p className="quiet">장벽 해당 없음</p>}
                  <div className="passage">
                    {sents.map((s, i) => {
                      const faint = i === 0 && /발굴\.?$/.test(m.text.slice(s.start, s.end)) && s.end - s.start < 14
                      return (
                        <div className="ps" key={i}>
                          <p className={faint ? 'faint' : ''}>
                            {cuts(s).map((seg, k) => seg.on
                              ? <mark key={k} className={seg.flash ? 'on' : ''}>{m.text.slice(seg.from, seg.to)}</mark>
                              : <Fragment key={k}>{m.text.slice(seg.from, seg.to)}</Fragment>)}
                          </p>
                          <div className="mg">
                            {notes[i].map((n) => <div key={n.k + n.v} className={`mn${n.strong ? ' st' : ''}`}><span>{n.k}</span><b>{n.v}</b></div>)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="rbar">
                    <button className="btn sec sm" aria-pressed={allOk} onClick={confirmMemo}><CircleCheck size={16} aria-hidden="true" />{allOk ? '해석 확정됨' : '이 회차 해석 확정'}</button>
                    <button className="lnk-btn" aria-expanded={evOpen} onClick={() => setEvOpen(!evOpen)}>근거 전체 {evOpen ? '▴' : '▾'}</button>
                    <button className="lnk-btn right" onClick={copyText}>원문 복사</button>
                  </div>
                  {evOpen && (
                    <div className="evall">
                      <dl className="evrows">
                        {evRows.map(([k, v, q]) => (
                          <div key={k}><dt>{k}</dt><dd className={allOk ? '' : 'derived'}>{v}</dd><dd className="evq">{uniq(q).map((x) => <q key={x}>{x}</q>)}</dd></div>
                        ))}
                      </dl>
                      <div className={`rv${allOk ? ' ok' : ''}${fixOpen ? ' bad' : ''}`} role="group" aria-label={`${sel + 1}회차 해석 검토`}>
                        <button className="btn sec sm" aria-pressed={allOk} onClick={confirmMemo}><CircleCheck size={16} aria-hidden="true" />해석 확인</button>
                        <button className="btn sec sm" aria-pressed={fixOpen} aria-expanded={fixOpen} onClick={() => { if (fixOpen) { setFix({ ...fix, [sel]: false }); GROUPS.forEach((g) => setReview(h.id, sel, g, null)) } else { setFix({ ...fix, [sel]: true }); if (allOk) setReviewMany(h.id, sel, [...GROUPS], null, '') } }}><CircleX size={16} aria-hidden="true" />수정 필요</button>
                      </div>
                      {fixOpen && (
                        <div className="fixrow" role="group" aria-label={`${sel + 1}회차 수정할 항목`}>
                          {GROUPS.map((g, n) => {
                            const on = st[n] === 'rejected'
                            return <button key={g} className={`chip-f${on ? ' on' : ''}`} aria-pressed={on} onClick={() => { setReview(h.id, sel, g, on ? null : 'rejected'); if (!on) toast(`${sel + 1}회차 ${g} 수정 필요로 표시했습니다.`) }}>{g}</button>
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}
            {tab === 'score' && (
              <section className="pane a-score" aria-labelledby="h-score">
                <h2 id="h-score">점수 구성</h2>
                <dl className="items">
                  {c.f2.items.map((i) => (
                    <div key={i.key}>
                      <dt>{i.label}<small>{sourceLabel(i.source)}</small></dt>
                      <dd className="pts">
                        {i.unknown ? <Tag tone="warn" icon="help">미확인 · 0점</Tag>
                          : i.points === 0 ? <span className="muted">0점 (해당 없음)</span> : <>{i.points} / {i.max}</>}
                      </dd>
                      <dd className="why">
                        {shortReason(i)}
                        {i.evidence.length > 0 && (
                          <span className="src">
                            {i.evidence.map((q) => locate(q)
                              ? <button key={q} className="srcbtn" onClick={() => focusQuote(q)}><Tag icon="pencil">메모 근거</Tag>“{q}”</button>
                              : <span key={q} className="srcbtn"><Tag icon="pencil">메모 근거</Tag>“{q}”</span>)}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                  <div className="total"><dt>합계</dt><dd className="pts"><ScoreBar total={c.f2.total} /></dd></div>
                </dl>
                <FairnessNote items={c.f2.excluded_attributes} />
              </section>
            )}
            {tab === 'cond' && (
              <section className="pane" aria-labelledby="h-cond">
                <div className="card-head"><h2 id="h-cond">조건 대조 <small>후보 {c.f3.candidates.length}건</small></h2>
                  <Link className="btn sec" to={`/case/${h.id}/reguide`}>조건 대조·재안내 열기<ArrowRight size={16} aria-hidden="true" /></Link></div>
                {c.f3.candidates.length === 0 ? <p className="muted">후보 없음 · 다음 확인일 {c.f2.next_check_due}</p> : (
                  <ul className="cond-list">
                    {c.f3.candidates.slice(0, 3).map((cd) => (
                      <li key={cd.serv_id}><b>{cd.name}</b><span className="sub">{cd.source} · {cd.org}</span><span className="open-n num">확인 필요 {cd.checks.filter((k) => k.status !== '충족').length}건</span></li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {tab === 'log' && (
              <section className="pane" aria-labelledby="h-log">
                <h2 id="h-log">기록</h2>
                {caseLog.length === 0 ? <p className="muted">기록 없음</p> : (
                  <ul className="feed">{caseLog.map((e) => <li key={e.id}><span>{e.text}</span><small>{fmtTime(e.at)}{e.by && ` · ${e.by}`}</small></li>)}</ul>
                )}
              </section>
            )}
          </div>
        </div>
        <aside className="side"><DecisionPanel c={c} onScore={() => setTab('score')} onQuote={focusQuote} /></aside>
      </div>
    </>
  )
}

function DecisionPanel({ c, onScore, onQuote }: { c: View; onScore: () => void; onQuote: (q: string) => void }) {
  const toast = useToast()
  const h = c.household
  const k = h.consent
  const d = c.decision
  const sug = d.ai_suggestion
  const [editing, setEditing] = useState(false)
  const [pick, setPick] = useState<Outreach | '미검토'>(sug)
  const [reason, setReason] = useState('')
  const [reasonOpen, setReasonOpen] = useState(false)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  const block = (a: Outreach): string | null => {
    if (VISIT.includes(a) && k.방문 === '거부') return '방문을 거부한 가구입니다.'
    if ((a === '안부 문자' || a === '문자재안내') && k.문자 === '거부') return '문자 연락을 거부한 가구입니다.'
    if (a.startsWith('동행') && k.신청 === '거부') return '신청을 거부한 가구입니다.'
    return null
  }
  const hint = (a: Outreach): string[] => {
    const b = block(a)
    if (b) return [b]
    const out: string[] = []
    if (VISIT.includes(a)) out.push(k.방문 === '동의' ? '방문 연락 동의' : '방문 연락 미확인 · 확인 후 진행')
    if (a === '안부 문자' || a === '문자재안내') out.push(k.문자 === '동의' ? '문자 연락 동의' : '문자 연락 미확인 · 확인 후 진행')
    if (a.startsWith('동행') && k.신청 === '보류(장벽)') out.push('신청 보류(장벽) · 서류·절차 부담으로 미룬 상태')
    if (a === '재확인 예약') out.push(`대기열에 남고 ${c.f2.next_check_due}에 다시 올라옴`)
    return out
  }
  const needReason = pick !== '미검토' && pick !== sug
  const missing = needReason && !reason.trim()
  const nothing = pick === '미검토' && !c.decided
  const readOnly = c.decided && !editing
  // 제안과 다른 판단이면 사유 입력란을 열고 곧바로 포커스한다.
  useEffect(() => {
    if (!needReason) return
    setReasonOpen((open) => { if (!open) setTimeout(() => reasonRef.current?.focus(), 0); return true })
  }, [needReason, pick, editing])
  const safety = c.action.safety_check

  return (
    <section className="dec" aria-labelledby="h-dec">
      <h2 id="h-dec">처리 결정</h2>
      {readOnly ? (
        <>
          <p className="saved" role="status"><Stamp>{ACTION_LABEL(d.status)} 처리</Stamp>
            <span>저장됨 · {d.by} · {fmtTime(d.at ?? '')}</span></p>
          <dl className="kv">
            <dt>판단</dt><dd><b>{ACTION_LABEL(d.status)}</b> ({d.agrees_with_ai ? '제안과 같음' : '제안과 다름'})</dd>
            {d.reason && <><dt>사유</dt><dd>{d.reason}</dd></>}
          </dl>
          {c.history.length > 0 && (
            <p className="caption muted">이전 기록: {c.history.map((x) => `${ACTION_LABEL(x.status)}(${fmtTime(x.at ?? '')})`).join(', ')}</p>
          )}
          <button className="btn sec" onClick={() => { setEditing(true); setPick(d.status); setReason(''); setReasonOpen(false) }}>판단 변경</button>
        </>
      ) : (
        <>
          <div role="radiogroup" aria-label="판단" className="radios">
            {[...OUTREACH, ...(c.decided ? ['미검토' as const] : [])].map((o) => {
              const off = o !== '미검토' && !!block(o)
              const lines = o === '미검토' ? [] : hint(o)
              return (
                <Fragment key={o}>
                  <label className={`radio op${pick === o ? ' sel' : ''}${off ? ' off' : ''}`} title={off ? block(o as Outreach) ?? undefined : undefined}>
                    <input type="radio" name="decision" value={o} checked={pick === o} disabled={off} onChange={() => setPick(o)} />
                    <b>{ACTION_LABEL(o)}</b>{o === sug && <span className="stamp sm">제안</span>}{off && <span className="no">불가</span>}
                  </label>
                  {pick === o && lines.length > 0 && <div className="subtxt">{lines.map((l) => <span key={l}>{off && <Ban size={13} aria-hidden="true" />}{l}</span>)}</div>}
                  {o === sug && safety && (
                    <div className="a-safety" role="note" aria-label="안전 확인">
                      <b><ShieldCheck size={15} aria-hidden="true" /> 안전 확인 <span className="ch">{safety.channels.join(' · ')}</span></b>
                      <p>{safety.reason}</p>
                      <ul>
                        {safety.triggers.map((t) => {
                          const q = t.startsWith('메모: ') ? t.slice(4) : null
                          return <li key={t}>{q ? <button className="srcbtn" onClick={() => onQuote(q)}>“{q}”</button> : t}</li>
                        })}
                      </ul>
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
          <div className="why">
            <button className="lnk-btn" aria-expanded={reasonOpen} onClick={() => setReasonOpen(!reasonOpen)}>다른 판단이면 사유 {reasonOpen ? '▴' : '▾'}</button>
            <button className="lnk-btn" onClick={onScore}>점수 구성</button>
          </div>
          {reasonOpen && (
            <label className="field">사유 <small>(제안과 다르면 필수)</small>
              <textarea ref={reasonRef} rows={3} value={reason} placeholder="사유" onChange={(e) => setReason(e.target.value)} aria-invalid={missing} aria-describedby={missing ? 'reason-err' : undefined} />
            </label>
          )}
          {missing && <p id="reason-err" className="err"><CircleAlert size={16} aria-hidden="true" />사유를 입력하십시오</p>}
          <button
            className="btn primary block" disabled={missing || nothing}
            onClick={() => {
              saveDecision(c, pick, reason); setEditing(false); setReason(''); setReasonOpen(false)
              toast(pick === '미검토' ? `${h.id} 판단을 취소했습니다.` : `${h.id} 판단을 저장했습니다: ${ACTION_LABEL(pick)} (처리 기록에 남음)`)
            }}
          >판단 저장</button>
        </>
      )}
      {c.action.due && !readOnly && <p className="caption muted">기한 {md(c.action.due)}</p>}
      <Link className="more" to={`/case/${h.id}/reguide`}>조건 대조·재안내 보기<ArrowRight size={16} aria-hidden="true" /></Link>
    </section>
  )
}
