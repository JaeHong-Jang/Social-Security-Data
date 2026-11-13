import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Ban, CircleAlert, CircleCheck, Circle, LoaderCircle, MinusCircle, Plus, Repeat2, ScanText, ShieldCheck, Square, Trash2, Play } from 'lucide-react'
import {
  DEFAULT_STEPS, fetchHealth, fetchSamples, findRecording, recordings, replay, streamAnalyze,
  type AnalyzeEvent, type AnalyzeRequest, type AnalyzeResult, type Sample, type SampleMemo, type StepDef, type StepEvent,
} from './analyzeApi'
import { ACTION_LABEL, addSessionCase, md, useData, type Case, type F1 } from './data'
import { Highlighted, LevelBadge, ScoreBar, Stamp, Tag, useToast } from './ui'

const HOUSEHOLD = ['1인가구', '부부가구', '한부모가구', '조손가구', '다인가구']
const CONSULT = ['전화 상담', '방문 상담', '내방 상담']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const shortDetail = (id: string, d: string) => {
  if (id === 'validate') return d.match(/메모 \d+건 · \d+자/)?.[0] ?? d
  if (id === 'f1') return d.match(/장벽 [^·]+/)?.[0].trim() ?? d
  if (id === 'quote_check') { const m = d.match(/(\d+)개 중 (\d+)개/); return m ? `인용 ${m[2]}/${m[1]} 일치` : d }
  if (id === 'refusal_guard') return d.replace('명시적 ', '')
  if (id === 'f3') return d.replace(/ ?\(.*\)/, '')
  return d
}
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)
const blank = (): SampleMemo => ({ date: '2026-11-01', consult_type: '전화 상담', text: '' })
const MAX_LEN = 1000

interface Run {
  status: 'idle' | 'running' | 'done' | 'error'
  mode: 'live' | 'replay' | null; model?: string; offline: boolean
  steps: StepDef[]; st: Record<string, StepEvent>; f1: (F1 | undefined)[]; n: number
  stopped?: boolean; result: AnalyzeResult | null; error: string | null; elapsed?: number; input: AnalyzeRequest | null
}
const idle: Run = { status: 'idle', mode: null, offline: false, steps: DEFAULT_STEPS, st: {}, f1: [], n: 0, result: null, error: null, input: null }

export default function Analyze() {
  const { meta, cases } = useData()
  const [params] = useSearchParams()
  const toast = useToast()
  const [samples, setSamples] = useState<Sample[]>([])
  const [, setFrom] = useState<'api' | 'recording'>('api')
  const [pick, setPick] = useState('')
  const [type, setType] = useState(HOUSEHOLD[0])
  const [memos, setMemos] = useState<SampleMemo[]>([blank()])
  const [mode, setMode] = useState<AnalyzeRequest['mode']>('auto')
  const [run, setRun] = useState<Run>(idle)
  const [addedId, setAddedId] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const auto = useRef(params.get('auto') === '1')
  const resultRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let on = true
    fetchSamples().then(({ samples: s, from: f }) => {
      if (!on) return
      setSamples(s); setFrom(f)
      if (s[0]) { setPick(s[0].id); load(s[0]) }
      if (auto.current && s[0]) { auto.current = false; start(s[0].memos, s[0].household_type, 'auto') }
    })
    return () => { on = false; ctl.current?.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = (s: Sample) => { setType(s.household_type); setMemos(s.memos.map((m) => ({ ...m }))); setRun(idle); setAddedId(null) }
  const setMemo = (i: number, patch: Partial<SampleMemo>) => setMemos(memos.map((m, k) => (k === i ? { ...m, ...patch } : m)))

  async function start(ms: SampleMemo[], ht: string, md_: AnalyzeRequest['mode']) {
    const req: AnalyzeRequest = { household_type: ht, memos: ms, mode: md_ }
    ctl.current?.abort()
    const ac = new AbortController(); ctl.current = ac
    setAddedId(null)
    let cur: Run = { ...idle, status: 'running', input: req, f1: Array(ms.length).fill(undefined), n: ms.length }
    setRun(cur)
    const apply = (ev: AnalyzeEvent) => {
      if (ev.event === 'start') cur = { ...cur, mode: ev.data.mode, model: ev.data.model, steps: ev.data.steps?.length ? ev.data.steps : DEFAULT_STEPS }
      else if (ev.event === 'step') cur = { ...cur, st: { ...cur.st, [ev.data.id]: ev.data } }
      else if (ev.event === 'f1') { const f = [...cur.f1]; f[ev.data.memo_index] = ev.data.f1; cur = { ...cur, f1: f } }
      else if (ev.event === 'result') cur = { ...cur, result: ev.data, f1: ev.data.f1?.length ? ev.data.f1 : cur.f1 }
      else if (ev.event === 'error') cur = { ...cur, status: 'error', error: /꺼져|예시만/.test(ev.data.message) ? '녹화된 예시와 일치하는 메모가 없습니다.' : ev.data.message }
      else if (ev.event === 'end') cur = { ...cur, status: cur.status === 'error' ? 'error' : 'done', elapsed: ev.data.elapsed_ms }
      setRun(cur)
    }
    let got = false
    try {
      for await (const ev of streamAnalyze(req, ac.signal)) { got = true; apply(ev) }
    } catch (e) {
      if (ac.signal.aborted) return
      if (got) { cur = { ...cur, status: 'error', error: '서버 연결이 끊겼습니다.' }; setRun(cur); return }
      const up = (await fetchHealth()).state !== 'off'
      if (up) {
        setRun({ ...cur, status: 'error', mode: null, error: md_ === 'replay'
          ? '녹화된 예시와 일치하는 메모가 없습니다.'
          : `분석 서버 오류 (${e instanceof Error ? e.message : '오류'})` })
        return
      }
      if (md_ === 'live') {
        setRun({ ...cur, status: 'error', mode: null, error: '분석 서버에 연결할 수 없습니다. 실행 방식을 바꾸십시오.' })
        return
      }
      // 서버에 닿지 않음 → 녹화 재생
      const rec = findRecording(ms)
      cur = { ...cur, offline: true, mode: 'replay' }
      if (!rec) {
        setRun({ ...cur, status: 'error', error: recordings.length
          ? '서버 연결 없음 · 입력과 일치하는 녹화본 없음'
          : '서버 연결 없음 · 녹화본 없음' })
        return
      }
      try { for await (const ev of replay(rec, ac.signal)) apply(ev) } catch { if (!ac.signal.aborted) setRun({ ...cur, status: 'error', error: '녹화 재생 중 오류가 났습니다.' }) }
    }
    if (!ac.signal.aborted) setTimeout(() => resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 100)
  }

  const invalid = memos.some((m) => !m.text.trim() || m.text.length > MAX_LEN || !DATE_RE.test(m.date)) || memos.length < 1 || memos.length > 5
  const running = run.status === 'running'
  const result = run.result

  function addToQueue() {
    if (!result || !run.input) return
    const id = `A-${String(Date.now()).slice(-4)}`
    const c = buildCase(id, run.input, result, meta?.reference_date ?? '2026-11-13')
    addSessionCase(c)
    setAddedId(id)
    toast(`${id}를 대기열에 추가했습니다.`)
  }

  const editing = run.status === 'idle'
  const shownMemos = editing || !run.input ? memos : run.input.memos
  const readN = run.f1.filter(Boolean).length
  const doneSteps = run.steps.filter((s) => run.st[s.id]?.status === 'done').length
  const stop = () => { ctl.current?.abort(); setRun({ ...run, status: 'error', stopped: true, error: '분석을 중지했습니다.', st: Object.fromEntries(Object.entries(run.st).map(([k, v]) => [k, v.status === 'running' ? { ...v, status: 'skipped' as const, detail: '중지됨' } : v])) }) }

  return (
    <>
      <div className="tt">
        <h1>메모 분석</h1>
        <span className="num">{shownMemos.length}건{run.status !== 'idle' ? ` · ${readN}/${shownMemos.length}` : ''}</span>
        <span className="spacer" />
        <ModeBadge run={run} />
      </div>

      <div className="an-tools" role="group" aria-label="입력 설정">
        <label className="fld">예시
          <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={samples.length === 0}>
            {samples.length === 0 && <option value="">예시 없음</option>}
            {samples.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <button className="btn" disabled={!samples.find((s) => s.id === pick)} onClick={() => { const s = samples.find((x) => x.id === pick); if (s) load(s) }}>예시 불러오기</button>
        <label className="fld">가구 유형
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={!editing}>{[...new Set([type, ...HOUSEHOLD])].map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label className="fld">실행 방식
          <select value={mode} onChange={(e) => setMode(e.target.value as AnalyzeRequest['mode'])}>
            <option value="auto">자동</option><option value="live">실시간만</option><option value="replay">녹화 재생</option>
          </select>
        </label>
        {editing && <button className="btn" disabled={memos.length >= 5} onClick={() => setMemos([...memos, { ...blank(), consult_type: memos.at(-1)?.consult_type ?? '전화 상담' }])}><Plus size={18} aria-hidden="true" />회차 추가 ({memos.length}/5)</button>}
        {!editing && !running && <button className="btn" onClick={() => setRun(idle)}>메모 수정</button>}
      </div>

      <div className="cols">
        <section className="an-in" aria-labelledby="an-h">
          <h2 id="an-h">회차별 메모 <i>{shownMemos.length}건</i></h2>
          {shownMemos.map((m, i) => {
            const f = run.f1[i]
            const st = f ? { t: '읽음', I: CircleCheck } : run.status === 'running' ? { t: '읽는 중', I: LoaderCircle } : run.status === 'idle' ? null : { t: run.stopped ? '중지됨' : '결과 없음', I: MinusCircle }
            return (
              <article key={i} className={`slip${!f && run.status === 'running' ? ' wait' : ''}`} aria-label={`${i + 1}회차 메모`}>
                <header>
                  <b className="serif">{i + 1}회차</b>
                  {editing ? (
                    <>
                      <label className="fld inl">날짜 <input type="text" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="2026-11-01" maxLength={10} value={m.date} aria-label={`${i + 1}회차 날짜 (YYYY-MM-DD)`} aria-invalid={!DATE_RE.test(m.date)} onChange={(e) => setMemo(i, { date: e.target.value })} /></label>
                      <label className="fld inl"><span className="sr-only">상담 방식</span>
                        <select value={m.consult_type} onChange={(e) => setMemo(i, { consult_type: e.target.value })}>{[...new Set([m.consult_type, ...CONSULT])].map((t) => <option key={t}>{t}</option>)}</select>
                      </label>
                      {memos.length > 1 && <button className="linkbtn del" aria-label={`${i + 1}회차 메모 삭제`} onClick={() => setMemos(memos.filter((_, k) => k !== i))}><Trash2 size={15} aria-hidden="true" />삭제</button>}
                    </>
                  ) : (
                    <><span className="num">{m.date}</span><span>{m.consult_type}</span>
                      {st && <em className={`rs ${f ? 'ok' : ''}`}><st.I size={16} aria-hidden="true" className={st.t === '읽는 중' ? 'spin' : ''} />{st.t}</em>}
                      {!st && null}
                    </>
                  )}
                </header>
                {editing ? (
                  <>
                    <label className="sr-only" htmlFor={`memo-${i}`}>{i + 1}회차 메모 내용</label>
                    <textarea id={`memo-${i}`} rows={4} value={m.text} maxLength={MAX_LEN + 200} placeholder="상담 내용 (가상 데이터만)" onChange={(e) => setMemo(i, { text: e.target.value })} aria-invalid={m.text.length > MAX_LEN} />
                    <p className={`caption ${m.text.length > MAX_LEN ? 'err' : 'muted'} num`}>{m.text.length} / {MAX_LEN}자</p>
                  </>
                ) : (
                  <>
                    <p className="memo"><Highlighted text={m.text} ranges={f?.evidence ?? []} /></p>
                    {f && (
                      <div className="res">
                        <span className="chip">종결 유형 · {f.closure_type ?? '—'}</span>
                        <span className="chip">장벽 · {f.barrier_cause}</span>
                        <span className="chip">신청 · {f.consent?.신청 ?? '미확인'}</span>
                        {f.consent_guard && <span className="chip">거부 표현 감지</span>}
                        {f.needs_check && <span className="chip">확인 필요</span>}
                      </div>
                    )}
                  </>
                )}
              </article>
            )
          })}
        </section>

        <section className="an-out" aria-labelledby="an-t" aria-live="polite">
          <h2 id="an-t">단계 <i className="num">{doneSteps}/{run.steps.length} 진행</i></h2>
          <div className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={run.steps.length} aria-valuenow={doneSteps} aria-label="분석 진행"><i style={{ width: `${(doneSteps / run.steps.length) * 100}%` }} /></div>
          <Timeline run={run} />
          {run.status === 'error' && <p className="err" role="alert"><CircleAlert size={18} aria-hidden="true" />{run.error}</p>}
          <div className="model"><span>인용 대조 후 표시{run.status === 'done' && run.elapsed != null ? ` · 총 ${(run.elapsed / 1000).toFixed(1)}초` : ''}</span><span>담당자가 최종 결정</span></div>
          <div className="an-bar">
            {running
              ? <button className="btn" onClick={stop}><Square size={18} aria-hidden="true" />중지</button>
              : <button className="btn primary" disabled={invalid || !editing} onClick={() => start(memos, type, mode)}><Play size={18} aria-hidden="true" />분석 실행</button>}
            {invalid && editing && <span className="caption muted">날짜(YYYY-MM-DD)와 메모(1,000자 이하) 필요</span>}
          </div>
        </section>
      </div>

      {result && (
        <section className="an-res" aria-labelledby="an-r" ref={resultRef}>
          <h2 id="an-r">분석 결과</h2>
          <Result r={result} />
          <div className="btn-row">
            {addedId
              ? <><Stamp>추가됨 {addedId}</Stamp><Link className="btn" to={`/case/${addedId}`}>가구 상세</Link><Link className="btn" to="/queue">대기열 보기</Link></>
              : <button className="btn primary" onClick={addToQueue}><ScanText size={18} aria-hidden="true" />결과를 대기열에 추가</button>}
          </div>
        </section>
      )}
      {cases && cases.length === 0 && <p className="muted">대기열 데이터를 불러오지 못했습니다.</p>}
    </>
  )
}

function ModeBadge({ run }: { run: Run }) {
  if (!run.mode) return <Tag tone="neutral">대기</Tag>
  return run.mode === 'live'
    ? <Tag tone="done" icon="ok">실시간 (로컬)</Tag>
    : <Tag tone="warn" icon="help">녹화 재생</Tag>
}

function Timeline({ run }: { run: Run }) {
  return (
    <ol className="steps">
      {run.steps.map((s, k) => {
        const e = run.st[s.id]
        const f1Done = s.id === 'f1' ? run.f1.filter(Boolean).length : 0
        const status = (e?.status ?? 'pending') as StepEvent['status'] | 'pending'
        const Icon = status === 'done' ? CircleCheck : status === 'error' ? CircleAlert : status === 'skipped' ? MinusCircle : status === 'running' ? LoaderCircle : Circle
        const word = status === 'running' ? '진행' : status === 'done' ? '완료' : status === 'skipped' ? (run.stopped ? '중지됨' : '건너뜀') : status === 'error' ? '오류' : '대기'
        return (
          <li key={s.id} className={`step ${status}`}>
            <span className="no serif">{k + 1}</span>
            <Icon size={20} aria-hidden="true" className={status === 'running' ? 'spin' : ''} />
            <span className="st-l"><b>{s.label}</b>{(e?.detail || (s.id === 'f1' && run.n > 0 && status !== 'pending')) && <small>{s.id === 'f1' && run.n > 0 ? `${f1Done}/${run.n}` : ''}{s.id === 'f1' && e?.detail ? ' · ' : ''}{e?.detail ? shortDetail(s.id, e.detail) : ''}</small>}</span>
            <span className="tm num">{status === 'done' && e?.ms != null ? fmtMs(e.ms) : ''}</span>
            <em>{word}</em>
          </li>
        )
      })}
    </ol>
  )
}

function Result({ r }: { r: AnalyzeResult }) {
  const rb = r.repeated_barrier
  const f3 = r.f3
  return (
    <>
      <div className="head">
        <LevelBadge level={r.f2.level} />
        <ScoreBar total={r.f2.total} />
        <span className="muted">다음 확인일 {r.f2.next_check_due}</span>
        {r.f2.flags?.map((f) => <Tag key={f} tone="warn" icon="help">{f}</Tag>)}
      </div>
      {rb ? (
        <div className="callout" role="note" aria-label="반복 장벽">
          <p className="callout-kicker"><Repeat2 size={18} aria-hidden="true" />반복 장벽 · {rb.cause}</p>
          <p className="callout-main">{rb.summary}</p>
          <ol className="bq">{rb.quotes.map((q, n) => <li key={n}><span className="bqs"><small>{q.memo_index + 1}회차</small><span className="q">“{q.quote}”</span></span></li>)}</ol>
        </div>
      ) : <p className="callout none"><Repeat2 size={18} aria-hidden="true" />회차 메모 사이에 반복되는 장벽은 찾지 못했습니다.</p>}
      <div className="res-cols">
      <div>
      <h3>점수 구성</h3>
      <dl className="items">
        {r.f2.items.map((i) => (
          <div key={i.key}>
            <dt>{i.key} {i.label}<small>{i.source}</small></dt>
            <dd className="pts">{i.unknown ? <Tag tone="warn" icon="help">미확인 · 0점</Tag> : i.points === 0 ? <span className="muted">0점 (해당 없음)</span> : <>{i.points} / {i.max}</>}</dd>
            <dd className="why">{i.reason}{i.evidence?.length > 0 && <span className="src">{i.evidence.map((q) => <span key={q} className="srcbtn"><Tag icon="pencil">메모 근거</Tag>“{q}”</span>)}</span>}</dd>
          </div>
        ))}
        <div className="total"><dt>합계</dt><dd className="pts"><ScoreBar total={r.f2.total} /></dd></div>
      </dl>
            </div>
      <div>
      <h3>제안</h3>
      <div className="rationale">
        <p><b>제안: {ACTION_LABEL(r.action.outreach)}</b>{r.action.due && <small> · 기한 {md(r.action.due)}</small>}</p>
      </div>
      {r.action.safety_check && (
        <div className="a-safety safe-inline">
          <p><b><ShieldCheck size={18} aria-hidden="true" /> 안전 확인</b></p>
          <p>{r.action.safety_check.reason}</p>
          <ul className="channels">{r.action.safety_check.channels.map((c) => <li key={c}>{c}</li>)}</ul>
          <ul className="triggers">{r.action.safety_check.triggers.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      <h3>조건 대조</h3>
      {f3?.candidates?.length ? (
        <ul className="cand-mini">{f3.candidates.slice(0, 3).map((c) => <li key={c.serv_id}><b>{c.name}</b> <Tag>{c.source}</Tag><span className="sub"> 확인 필요 {c.checks.filter((k) => k.status !== '충족').length}건</span></li>)}</ul>
      ) : <p className="muted"><Ban size={16} aria-hidden="true" /> 후보 없음</p>}
      </div>
      </div>
    </>
  )
}

function buildCase(id: string, req: AnalyzeRequest, r: AnalyzeResult, ref: string): Case {
  const last = req.memos[req.memos.length - 1]
  const f1 = r.f1
  const lastF1 = f1[f1.length - 1]
  const days = Math.max(0, Math.round((new Date(ref).getTime() - new Date(last.date).getTime()) / 864e5))
  const f3 = { ...{ notice_source: null, tag_filter_source: '', candidates: [], notice_draft: null, model: '', tag_filter: {}, checks_narrowed: { total: 0, 충족: 0, 미충족: 0, 확인필요: 0, summary: '' } }, ...(r.f3 as Partial<Case['f3']>) } as Case['f3']
  return {
    household: {
      id, gu: '(가상)', dong: 'AI 분석', household_type: req.household_type, discoveries: [],
      memos: req.memos.map((m, i) => ({ discovery_date: m.date, written_at: m.date, consult_type: m.consult_type, text: m.text, closure_label: null, f1: f1[i] })),
      repeated_barrier: r.repeated_barrier ?? null, post_closure_signals: [], closed_at: last.date, days_since_closure: days,
      consent: lastF1.consent, contact_refused: lastF1.consent.문자 === '거부' && lastF1.consent.방문 === '거부',
    },
    f2: r.f2, action: r.action, f1_source: 'llm', f3,
    decision: { status: '미검토', by: null, at: null, reason: null, ai_suggestion: r.action.outreach, agrees_with_ai: null },
  }
}
