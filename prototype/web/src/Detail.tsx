import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Ban, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleX, Repeat2, ShieldCheck } from 'lucide-react'
import {
  ACTION_LABEL, OUTREACH, byPriority, confirmInterpretation, fmtTime, md, place, reviewKey, saveDecision, setReview, setReviewMany, shortReason, sourceLabel, topItems, useData,
  type Case, type LogEntry, type Meta, type Outreach, type Review, type View,
} from './data'
import { EmptyState, FairnessNote, Hint, LampIcon, LevelBadge, ScoreBar, Skeleton, Stamp, StatusTag, Tag, useToast } from './ui'

const FIELD_LABEL: Record<string, string> = {
  work_status: '업무 상태', closure_type: '종결 유형', support_network: '도움 관계망',
  barrier_cause: '장벽 원인',
  'consent.신청': '신청 의사', 'consent.문자': '문자 연락 의사', 'consent.방문': '방문 연락 의사', 'consent.전화': '전화 연락 의사',
}
const fieldLabel = (f: string) => FIELD_LABEL[f] ?? (f.startsWith('isolation_signals.') ? `고립 징후(${f.slice(18)})` : f)
const mark = (n: number) => String.fromCharCode(0x2460 + n) // ①②③…
const bmark = (n: number) => String.fromCharCode(0x2776 + n) // ❶❷❸…
const VISIT: Outreach[] = ['동행 신청 지원(재방문)', '심층상담(재방문)', '재방문']

/** 메모 안의 강조 구간. 같은 구간을 가리키는 근거는 하나로 합친다. */
interface Span { start: number; end: number; quote: string; labels: string[]; barrier?: number }
function memoSpans(c: Case, mi: number): Span[] {
  const m = c.household.memos[mi]
  const map = new Map<string, Span>()
  const add = (start: number, end: number, label: string, barrier?: number) => {
    const k = `${start}-${end}`
    const s = map.get(k) ?? { start, end, quote: m.text.slice(start, end), labels: [] }
    if (!s.labels.includes(label)) s.labels.push(label)
    if (barrier !== undefined) s.barrier = barrier
    map.set(k, s)
  }
  m.f1.evidence.forEach((e) => add(e.start, e.end, fieldLabel(e.field)))
  c.household.repeated_barrier?.quotes.forEach((q, n) => { if (q.memo_index === mi) add(q.start, q.end, '반복 장벽', n) })
  c.f2.items.filter((it) => it.key !== 'B').forEach((it) => it.evidence.forEach((q) => {
    const at = m.text.indexOf(q)
    if (at >= 0) add(at, at + q.length, `점수 근거 ${it.key}`)
  }))
  return [...map.values()].sort((a, b) => a.start - b.start || b.end - a.end)
}

function segments(text: string, sp: Span[]) {
  const cuts = [...new Set([0, text.length, ...sp.flatMap((e) => [e.start, e.end])])].sort((a, b) => a - b)
  return cuts.slice(0, -1).map((s, k) => {
    const e = cuts[k + 1]
    return {
      text: text.slice(s, e),
      ids: sp.flatMap((x, n) => (x.start <= s && e <= x.end ? [n] : [])),
      ends: sp.flatMap((x, n) => (x.end === e ? [n] : [])),
    }
  })
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

function DetailBody({ c, labels, meta, review, log, prev, next, pos }: { c: View; labels: Record<string, string>; meta: Meta; review: Record<string, Review>; log: LogEntry[]; prev: string | null; next: string | null; pos: string }) {
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>('memos')
  const [fix, setFix] = useState<Record<number, boolean>>({})
  const h = c.household
  const urgent = c.f2.level === '긴급' && !c.decided
  const [active, setActive] = useState<string | null>(null)
  const markRefs = useRef<Record<string, HTMLElement | null>>({})
  const spans = h.memos.map((_, mi) => memoSpans(c, mi))
  const rb = h.repeated_barrier
  const B = c.f2.items.find((i) => i.key === 'B')

  /** 인용 문장이 들어 있는 가장 최근 메모의 강조 구간 키 */
  const locate = (quote: string) => {
    for (let mi = spans.length - 1; mi >= 0; mi--) {
      const n = spans[mi].findIndex((s) => s.quote === quote)
      if (n >= 0) return `${mi}:${n}`
    }
    return null
  }
  const jump = (key: string | null) => {
    if (!key) return
    const go = () => { setActive(key); markRefs.current[key]?.scrollIntoView({ block: 'center' }) }
    if (tab !== 'memos') { setTab('memos'); setTimeout(go, 60) } else go()
  }
  const spanKey = (mi: number, start: number, end: number) => `${mi}:${spans[mi].findIndex((s) => s.start === start && s.end === end)}`

  const nMemo = new Set(rb?.quotes.map((q) => q.memo_index)).size
  const tl = [
    ...h.discoveries.map((d, n) => ({ k: `d${n}`, date: d.date.slice(5).replace('-', '.'), sort: d.date, label: `발굴 ${n + 1}`, cls: '', memo: n < h.memos.length ? n : undefined })),
    ...h.post_closure_signals.map((sg) => ({ k: `s${sg.date}${sg.kind}`, date: sg.date.slice(5).replace('-', '.'), sort: sg.date, label: sg.kind, cls: 'sig', memo: undefined as number | undefined })),
    { k: 'now', date: meta.reference_date.slice(5).replace('-', '.'), sort: meta.reference_date, label: '오늘', cls: 'now', memo: undefined as number | undefined },
  ].sort((a, b) => a.sort.localeCompare(b.sort))
  const caseLog = [...log.filter((e) => e.caseId === h.id)].reverse()

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
        <span className="sc"><b className="serif num">{c.f2.total}</b><small>/100</small></span>
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
            <i className="hole h1" aria-hidden="true" /><i className="hole h2" aria-hidden="true" /><i className="hole h3" aria-hidden="true" />
            {tab === 'memos' && (
              <>
        {c.action.safety_check && (
          <section className="pane a-safety" aria-labelledby="h-safe">
            <div className="card-head">
              <h2 id="h-safe"><ShieldCheck size={22} aria-hidden="true" /> 안전 확인</h2>
              <Tag tone="warn" icon="shield">본인 연락 별개</Tag>
            </div>
            <p>{c.action.safety_check.reason}</p>
            <div className="safe-cols">
              <div>
                <h3>확인 경로</h3>
                <ul className="channels">{c.action.safety_check.channels.map((ch) => <li key={ch}>{ch}</li>)}</ul>
              </div>
              <div>
                <h3>근거</h3>
                <ul className="triggers">
                  {c.action.safety_check.triggers.map((t) => {
                    const quote = t.startsWith('메모: ') ? t.slice(4) : null
                    const key = quote ? locate(quote) : null
                    return <li key={t}>{key
                      ? <button className="srcbtn" onClick={() => jump(key)}><Tag icon="pencil">메모 근거</Tag>“{quote}”</button>
                      : t}</li>
                  })}
                </ul>
              </div>
            </div>
          </section>
        )}

        <section className="pane a-compare" aria-labelledby="h-compare">
          <div className="card-head">
            <h2 id="h-compare">회차별 메모 <Hint label="표시 설명">점선 밑줄 = 메모에서 읽은 내용(확인 전). 번호를 누르면 원문 구간으로 이동합니다.</Hint></h2>
            <span className="head-actions">
              {c.interpretationConfirmed && <Tag tone="done" icon="ok">담당자 확인</Tag>}
              <button className="btn primary" disabled={c.interpretationConfirmed} onClick={() => confirmInterpretation(h.id)}>
                <CircleCheck size={18} aria-hidden="true" />해석 확정
              </button>
            </span>
          </div>

          {rb ? (
            <div className="callout" role="note" aria-label="회차 교차 발견">
              <p className="callout-kicker"><Repeat2 size={18} aria-hidden="true" />반복 장벽: {rb.cause} ({nMemo}/{h.memos.length}회차)</p>
              <p className="callout-main">{rb.summary}</p>
              <ol className="bq">
                {rb.quotes.map((q, n) => (
                  <li key={n}>
                    <button onClick={() => jump(spanKey(q.memo_index, q.start, q.end))}
                      aria-label={`반복 장벽 근거 ${n + 1}, ${q.memo_index + 1}회차 메모 원문으로 이동`}>
                      <span className="qn">{bmark(n)}</span><small>{q.memo_index + 1}회차 · {h.memos[q.memo_index].written_at}</small>
                      <span className="q">“{q.quote}”</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="callout none"><Repeat2 size={18} aria-hidden="true" />{B?.unknown ? '회차 메모가 1건뿐이라 반복 장벽 여부는 미확인입니다.' : '회차 메모 사이에 반복되는 장벽은 찾지 못했습니다.'}</p>
          )}

          <div className="memo-cols">
            {h.memos.map((m, mi) => {
              const sp = spans[mi]
              return (
                <article key={mi} className="memo-card" aria-label={`${mi + 1}회차 메모`}>
                  <h3>{mi + 1}회차 <small>{m.written_at} · {m.consult_type}</small></h3>
                  <p className="memo">
                    {segments(m.text, sp).map((s, i) => (
                      <Fragment key={i}>
                        {s.ids.length ? (
                          <mark
                            className={`${s.ids.some((n) => `${mi}:${n}` === active) ? 'on' : ''}${s.ids.some((n) => sp[n].barrier !== undefined) ? ' barrier' : ''}`}
                            ref={(el) => { if (el) s.ids.forEach((n) => { markRefs.current[`${mi}:${n}`] ??= el }) }}
                            onMouseEnter={() => setActive(`${mi}:${s.ids[0]}`)} onMouseLeave={() => setActive(null)}
                          >{s.text}</mark>
                        ) : s.text}
                        {s.ends.map((n) => (
                          <sup key={n} className="mk" tabIndex={0} data-tip={`${sp[n].labels.join(' · ')}`} aria-label={`근거 ${n + 1}: ${sp[n].labels.join(', ')}`}>{mark(n)}{sp[n].barrier !== undefined && <b className="bm">{bmark(sp[n].barrier!)}</b>}</sup>
                        ))}
                      </Fragment>
                    ))}
                  </p>
                  {(() => {
                    const bc = m.f1.evidence.filter((e) => e.field === 'barrier_cause')
                    const gs: { g: string; rows: [string, ReactNode][] }[] = [
                      { g: '업무·종결', rows: [['업무 상태', m.f1.work_status], ['종결 유형', m.f1.closure_type ? labels[m.f1.closure_type] : '판단 못함']] },
                      { g: '장벽 원인', rows: [['장벽 원인', <>{m.f1.barrier_cause}{bc.length > 0 && <span className="mk-in" title={bc.map((e) => `“${e.quote}”`).join(' ')}> ⓘ</span>}</>]] },
                      { g: '연락 의사', rows: [['연락 의사', (['신청', '문자', '방문'] as const).map((k) => `${k} ${m.f1.consent[k]}`).join(' · ')]] },
                      { g: '관계망·고립', rows: [['도움 관계망', m.f1.support_network], ['고립 징후', m.f1.isolation_signals.length ? m.f1.isolation_signals.join(' · ') : '없음']] },
                    ]
                    const st = gs.map((x) => review[reviewKey(h.id, mi, x.g)])
                    const allOk = st.every((x) => x === 'approved')
                    const anyBad = st.some((x) => x === 'rejected')
                    const open = !!fix[mi] || anyBad
                    return (
                      <>
                        <dl className="kv2">
                          {gs.flatMap((x) => x.rows).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={allOk ? '' : 'derived'}>{v}</dd></div>)}
                        </dl>
                        <div className={`rv${allOk ? ' ok' : ''}${open ? ' bad' : ''}`} role="group" aria-label={`${mi + 1}회차 해석 검토`}>
                          <button className="btn small" aria-pressed={allOk} onClick={() => {
                            if (allOk) setReviewMany(h.id, mi, gs.map((x) => x.g), null, '')
                            else { setReviewMany(h.id, mi, gs.map((x) => x.g), 'approved', '해석 확인'); setFix({ ...fix, [mi]: false }); toast(`${mi + 1}회차 해석을 확인했습니다.`) }
                          }}><CircleCheck size={16} aria-hidden="true" />해석 확인</button>
                          <button className="btn small" aria-pressed={open} aria-expanded={open} onClick={() => { if (open) { setFix({ ...fix, [mi]: false }); gs.forEach((x) => setReview(h.id, mi, x.g, null)) } else { setFix({ ...fix, [mi]: true }); if (allOk) setReviewMany(h.id, mi, gs.map((x) => x.g), null, '') } }}><CircleX size={16} aria-hidden="true" />수정 필요</button>
                        </div>
                        {open && (
                          <div className="fixrow" role="group" aria-label={`${mi + 1}회차 수정할 항목`}>
                            {gs.map((x, n) => {
                              const on = st[n] === 'rejected'
                              return <button key={x.g} className={`chip-f${on ? ' on' : ''}`} aria-pressed={on} onClick={() => { setReview(h.id, mi, x.g, on ? null : 'rejected'); if (!on) toast(`${mi + 1}회차 ${x.g} 수정 필요로 표시했습니다.`) }}>{x.g}</button>
                            })}
                          </div>
                        )}
                      </>
                    )
                  })()}
                  {m.f1.consent_guard && (['신청', '문자', '방문', '전화'] as const).filter((k) => m.f1.consent[k] === '거부').map((k) => (
                    <p key={k} className="check-line">
                      <Tag tone="warn" icon="ban">거부 표현 감지(코드 규칙)</Tag>
                      <span>{k} 거부{m.f1.evidence.filter((e) => e.field === `consent.${k}`).map((e) => <q key={e.start} className="bq-inline"> “{e.quote}”</q>)}</span>
                    </p>
                  ))}
                  {m.f1.needs_check && !c.interpretationConfirmed && (
                    <p className="check-line"><Tag tone="warn" icon="help">확인 필요</Tag><span>{m.f1.needs_check_reason}</span></p>
                  )}
                </article>
              )
            })}
          </div>
        </section>
                <section className="tl-wrap" aria-labelledby="h-time">
                  <h2 id="h-time" className="sr-only">진행 경과</h2>
                  <ol className="tl">
                    {tl.map((e) => (
                      <li key={e.k} className={`ev ${e.cls}`}>
                        <i aria-hidden="true" />
                        {e.memo !== undefined
                          ? <button className="evb" onClick={() => document.querySelector(`[aria-label="${e.memo! + 1}회차 메모"]`)?.scrollIntoView({ block: 'center' })}><b className="num">{e.date}</b><span>{e.label}</span></button>
                          : <span className="evb"><b className="num">{e.date}</b><span>{e.label}</span></span>}
                      </li>
                    ))}
                  </ol>
                </section>
              </>
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
                      {i.evidence.map((q) => {
                        const key = locate(q)
                        return key
                          ? <button key={q} className="srcbtn" onClick={() => jump(key)}><Tag icon="pencil">메모 근거</Tag>“{q}”</button>
                          : <span key={q} className="srcbtn"><Tag icon="pencil">메모 근거</Tag>“{q}”</span>
                      })}
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
                  <Link className="btn" to={`/case/${h.id}/reguide`}>조건 대조·재안내 열기<ArrowRight size={16} aria-hidden="true" /></Link></div>
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

        <aside className="side">
          <section className="score-sum" aria-labelledby="h-ss">
            <h2 id="h-ss">점수 구성</h2>
            <ul>{topItems(c).concat(c.f2.items.filter((i) => i.points > 0).sort((a, b) => b.points - a.points).slice(2, 3)).map((i) => <li key={i.key} className="fr"><span>{i.chip}</span><b className="serif num">+{i.points}</b></li>)}</ul>
            <button className="linkbtn" onClick={() => setTab('score')}>점수 전체 보기</button>
          </section>
          <DecisionPanel c={c} />
        </aside>
      </div>
    </>
  )
}

function DecisionPanel({ c }: { c: View }) {
  const toast = useToast()
  const h = c.household
  const k = h.consent
  const d = c.decision
  const sug = d.ai_suggestion
  const rb = h.repeated_barrier
  const [editing, setEditing] = useState(false)
  const [pick, setPick] = useState<Outreach | '미검토'>(sug)
  const [reason, setReason] = useState('')

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
    if (a.startsWith('동행') && k.신청 === '보류(장벽)') out.push('신청 보류(장벽): 거부가 아니라 서류·절차 부담으로 미룬 상태')
    if (a === '재확인 예약') out.push('본인 연락 없이 재확인일까지 둠')
    return out
  }
  const needReason = pick !== '미검토' && pick !== sug
  const missing = needReason && !reason.trim()
  const nothing = pick === '미검토' && !c.decided
  const readOnly = c.decided && !editing

  return (
    <section className="dec" aria-labelledby="h-dec">
      <h2 id="h-dec">처리 결정</h2>
      <div className="rationale">
        <p><b>제안: {ACTION_LABEL(sug)}</b>{c.action.due && <small> · 기한 {md(c.action.due)}</small>}</p>
        {rb && c.action.outreach.startsWith('동행') && <p className="why-line">반복 장벽 {rb.cause} → 동행 신청 지원</p>}
        <p className="muted">{c.action.outreach_reason}</p>
      </div>
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
          <button className="btn" onClick={() => { setEditing(true); setPick(d.status); setReason('') }}>판단 변경</button>
        </>
      ) : (
        <>
          <div role="radiogroup" aria-label="판단" className="radios">
            {[...OUTREACH, ...(c.decided ? ['미검토' as const] : [])].map((o) => {
              const off = o !== '미검토' && !!block(o)
              const lines = o === '미검토' ? [] : hint(o)
              return (
                <label key={o} className={`radio${pick === o ? ' sel' : ''}${off ? ' off' : ''}`}>
                  <input type="radio" name="decision" value={o} checked={pick === o} disabled={off} onChange={() => setPick(o)} />
                  <span><b>{o === '재확인 예약' ? `재확인 예약 — 대기열에 남고 ${c.f2.next_check_due}에 다시 올라옵니다` : ACTION_LABEL(o)}</b>{o === sug && <span className="stamp sm">제안</span>}
                    {lines.map((l) => <small key={l}>{off && <Ban size={14} aria-hidden="true" />}{l}</small>)}</span>
                </label>
              )
            })}
          </div>
          <label className="field">사유 <small>(제안과 다르면 필수)</small>
            <textarea
              rows={3} value={reason} placeholder="사유"
              onChange={(e) => setReason(e.target.value)} 
              aria-invalid={missing} aria-describedby={missing ? 'reason-err' : undefined}
            />
          </label>
          {missing && <p id="reason-err" className="err"><CircleAlert size={16} aria-hidden="true" />사유를 입력하십시오</p>}
          <button
            className="btn primary block" disabled={missing || nothing}
            onClick={() => {
              saveDecision(c, pick, reason); setEditing(false); setReason('');
              toast(pick === '미검토' ? `${h.id} 판단을 취소했습니다.` : `${h.id} 판단을 저장했습니다: ${ACTION_LABEL(pick)} (처리 기록에 남음)`)
            }}
          >판단 저장</button>
        </>
      )}
      <Link className="more" to={`/case/${h.id}/reguide`}>조건 대조·재안내 보기<ArrowRight size={16} aria-hidden="true" /></Link>
    </section>
  )
}
