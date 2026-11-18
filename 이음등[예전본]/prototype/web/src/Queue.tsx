import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Ban, CircleAlert, CircleCheck, CircleHelp, ListFilter, PencilLine, Search, ShieldCheck, UserPlus, X } from 'lucide-react'
import {
  ACTION_LABEL, ASSIGNEES, OUTREACH, RANK, assignCases, consentKinds, md, needsCheck, place, topItems, useData, type View,
} from './data'
import { EmptyState, Hint, LevelBadge, ScoreBar, Skeleton, StatusTag, useToast } from './ui'

const PAGE = 20
const TABS = ['전체', '긴급', '주의', '관찰', '처리완료'] as const
const FILTERS = {
  days: { label: '종결 후 경과', opts: ['30일 이내', '31~90일', '91일 이상'] },
  reason: { label: '재검토 사유', opts: [] as string[] }, // 항목 이름은 데이터에서 채운다
  consent: { label: '연락 동의', opts: ['동의', '보류', '거부', '미확인'] },
  status: { label: '처리 상태', opts: ['미검토', ...OUTREACH.map(ACTION_LABEL)] },
} as const
type FilterKey = keyof typeof FILTERS
const CHIPS = { due: '재확인 7일 안', safety: '안전 확인 필요', check: '메모 해석 확인 필요', free: '담당자 미배정' } as const
type ChipKey = keyof typeof CHIPS
const SORTS: Record<string, string> = {
  'level-desc': '단계 높은 순 → 점수 높은 순',
  'score-desc': '재검토 점수 높은 순', 'score-asc': '재검토 점수 낮은 순',
  'days-desc': '종결 후 오래된 순', 'days-asc': '종결 후 짧은 순',
  'level-asc': '단계 낮은 순 → 점수 낮은 순',
  'id-asc': '가구 번호 순', 'id-desc': '가구 번호 역순',
}
const DAY = 864e5

function matches(c: View, f: Record<FilterKey, string>) {
  const d = c.household.days_since_closure
  if (f.days === '30일 이내' && d > 30) return false
  if (f.days === '31~90일' && (d < 31 || d > 90)) return false
  if (f.days === '91일 이상' && d < 91) return false
  if (f.reason && !c.f2.items.some((i) => i.label === f.reason && i.points > 0)) return false
  if (f.consent && !consentKinds(c).includes(f.consent as never)) return false
  if (f.status && ACTION_LABEL(c.decision.status) !== f.status) return false
  return true
}
const haystack = (c: View) => [c.household.id, c.household.gu, c.household.dong, c.household.household_type, ...c.household.memos.map((m) => m.text)].join(' ').toLowerCase()

export default function Queue() {
  const { meta, cases, error, retry } = useData()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [who, setWho] = useState(ASSIGNEES[0])
  const [fopen, setFopen] = useState(false)
  const toast = useToast()

  const f = Object.fromEntries((Object.keys(FILTERS) as FilterKey[]).map((k) => [k, params.get(k) ?? ''])) as Record<FilterKey, string>
  const tab = (params.get('tab') ?? '전체') as (typeof TABS)[number]
  const q = params.get('q') ?? ''
  const sort = params.get('sort') ?? 'level-desc'
  const chips = (Object.keys(CHIPS) as ChipKey[]).filter((k) => params.get(k) === '1')
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    v ? next.set(k, v) : next.delete(k)
    setParams(next, { replace: true }); setPage(0)
  }
  const clear = () => { setParams(new URLSearchParams(), { replace: true }); setPage(0) }
  const sortBy = (col: string, first: 'asc' | 'desc') => set('sort', sort === `${col}-${first}` ? `${col}-${first === 'asc' ? 'desc' : 'asc'}` : `${col}-${first}`)
  const ariaSort = (col: string) => (sort.startsWith(col) ? (sort.endsWith('asc') ? 'ascending' : 'descending') : 'none') as 'ascending' | 'descending' | 'none'

  if (error) return <p className="err"><CircleAlert size={18} aria-hidden="true" />오류 목록을 불러오지 못했습니다. <button className="linkbtn" onClick={retry}>다시 시도</button></p>
  const all = cases ?? []
  const ref = meta ? new Date(meta.reference_date).getTime() : 0
  const reasonOpts = all[0]?.f2.items.map((i) => i.label) ?? []
  const tabCount = (t: (typeof TABS)[number]) => all.filter((c) => (t === '전체' ? true : t === '처리완료' ? c.decided : c.f2.level === t)).length
  const inTab = (c: View) => (tab === '전체' ? true : tab === '처리완료' ? c.decided : c.f2.level === tab)
  const chipOk = (c: View, k: ChipKey) => k === 'due' ? (!c.decided || c.decision.status === '재확인 예약') && new Date(c.f2.next_check_due).getTime() <= ref + 7 * DAY
    : k === 'safety' ? !!c.action.safety_check : k === 'check' ? needsCheck(c) && !c.interpretationConfirmed : !c.assignee
  const rows = all.filter((c) => inTab(c) && matches(c, f) && chips.every((k) => chipOk(c, k)) && (!q || haystack(c).includes(q.trim().toLowerCase()))).sort((a, b) => {
    const [col, dir] = sort.split('-')
    if (col === 'level') { const v = RANK[b.f2.level] - RANK[a.f2.level] || b.f2.total - a.f2.total; return dir === 'asc' ? -v : v }
    if (col === 'id') { const v = a.household.id.localeCompare(b.household.id); return dir === 'desc' ? -v : v }
    const [x, y] = col === 'days' ? [a.household.days_since_closure, b.household.days_since_closure] : [a.f2.total, b.f2.total]
    return dir === 'asc' ? x - y : y - x
  })
  const shown = rows.slice(page * PAGE, (page + 1) * PAGE)
  const active = (Object.keys(FILTERS) as FilterKey[]).filter((k) => f[k])
  const anyFilter = active.length > 0 || chips.length > 0 || !!q || tab !== '전체'
  const allShownSel = shown.length > 0 && shown.every((c) => sel.includes(c.household.id))
  const open = all.find((c) => c.household.id === openId) ?? null

  const closeSheet = () => {
    const id = openId
    setOpenId(null)
    setTimeout(() => document.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus(), 0)
  }
  const bulk = () => {
    assignCases(sel, who)
    toast(`${sel.length}가구를 ${who}에게 배정했습니다.`)
    setSel([])
  }

  const groupCount = (l: string) => rows.filter((r) => r.f2.level === l).length
  const grouped = sort === 'level-desc' || sort === 'level-asc'
  const filtersOpen = fopen || active.length > 0
  return (
    <>
      <div className="tt">
        <h1>대기열</h1><Hint label="숫자 기준">탭: 전체 기준 · 메뉴 숫자: 미검토 기준</Hint>
        <span className="num">미검토 {all.filter((c) => !c.decided).length} · 처리됨 {all.filter((c) => c.decided).length}</span>
        <div className="qseg" role="tablist" aria-label="단계별 보기">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`qs${tab === t ? ' on' : ''}`} onClick={() => set('tab', t === '전체' ? '' : t)}>
              {t === '처리완료' ? '처리됨' : t}<span className="tab-n num">{tabCount(t)}</span>
            </button>
          ))}
        </div>
      </div>


      <div className="toolbar">
        <label className="search">
          <Search size={18} aria-hidden="true" /><span className="sr-only">가구 번호·동·메모 내용 검색</span>
          <input type="search" value={q} placeholder="가구 번호, 동, 메모 내용 검색" onChange={(e) => set('q', e.target.value)} />
        </label>
        <div className="chips" role="group" aria-label="빠른 필터">
          {(Object.keys(CHIPS) as ChipKey[]).map((k) => (
            <button key={k} className={`fchip${chips.includes(k) ? ' on' : ''}`} aria-pressed={chips.includes(k)} onClick={() => set(k, chips.includes(k) ? '' : '1')}>{CHIPS[k]}</button>
          ))}
        </div>
        <button className="fchip filter-toggle" aria-expanded={filtersOpen} onClick={() => setFopen(!fopen)}><ListFilter size={16} aria-hidden="true" />필터{active.length ? ` (${active.length})` : ''}</button>
      </div>
      {filtersOpen && (
        <div className="filters open">
          {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
            <label key={k}>{FILTERS[k].label}
              <select value={f[k]} onChange={(e) => set(k, e.target.value)}>
                <option value="">전체</option>
                {(k === 'reason' ? reasonOpts : FILTERS[k].opts).map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          ))}
          <label className="sort">정렬
            <select value={sort} onChange={(e) => set('sort', e.target.value)}>
              {Object.entries(SORTS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
        </div>
      )}
      {anyFilter && (
        <div className="active-filters">
          {active.map((k) => (
            <span key={k} className="tag tag-neutral">{FILTERS[k].label}: {f[k]}
              <button aria-label={`${FILTERS[k].label} 해제`} onClick={() => set(k, '')}><X size={14} aria-hidden="true" /></button>
            </span>
          ))}
          <button className="linkbtn" onClick={clear}>필터 모두 해제</button>
        </div>
      )}

      {sel.length > 0 && (
        <div className="bulk" role="region" aria-label="일괄 배정">
          <b>{sel.length}가구 선택</b>
          <label className="inline">담당자
            <select value={who} onChange={(e) => setWho(e.target.value)}>{ASSIGNEES.map((a) => <option key={a}>{a}</option>)}</select>
          </label>
          <button className="btn primary" onClick={bulk}><UserPlus size={18} aria-hidden="true" />일괄 배정</button>
          <button className="btn" onClick={() => setSel([])}>선택 해제</button>
        </div>
      )}

      {cases && rows.length === 0 ? (
        all.length === 0
          ? <EmptyState title="가구 없음" />
          : <EmptyState title="조건에 맞는 가구 없음" action={<button className="btn" onClick={clear}>필터 모두 해제</button>} />
      ) : (
        <div className="ledger-wrap">
          <table className="ledger">
            <caption className="sr-only">재검토 대기 가구 목록</caption>
            <thead>
              <tr>
                <th scope="col" className="c-gut"><span className="sr-only">단계 구분</span></th>
                <th scope="col" className="c-sel">
                  <input type="checkbox" aria-label="이 쪽의 가구 모두 선택" checked={allShownSel}
                    onChange={() => setSel(allShownSel ? sel.filter((i) => !shown.some((c) => c.household.id === i)) : [...new Set([...sel, ...shown.map((c) => c.household.id)])])} />
                </th>
                <th scope="col" className="c-score" aria-sort={ariaSort('score')}>
                  <button className="sortbtn" onClick={() => sortBy('score', 'desc')}>점수<ArrowUpDown size={14} aria-hidden="true" /></button>
                </th>
                <th scope="col" className="c-level" aria-sort={ariaSort('level')}><button className="sortbtn" onClick={() => sortBy('level', 'desc')}>단계<ArrowUpDown size={14} aria-hidden="true" /></button></th>
                <th scope="col" className="c-id" aria-sort={ariaSort('id')}><button className="sortbtn" onClick={() => sortBy('id', 'asc')}>가구<ArrowUpDown size={14} aria-hidden="true" /></button></th>
                <th scope="col" className="c-reason">가장 큰 이유</th>
                <th scope="col" className="c-days num" aria-sort={ariaSort('days')}>
                  <button className="sortbtn" onClick={() => sortBy('days', 'desc')}>종결 후<ArrowUpDown size={14} aria-hidden="true" /></button>
                </th>
                <th scope="col" className="c-act">다음 행동</th>
                <th scope="col" className="c-dec">처리</th>
              </tr>
            </thead>
            <tbody>
              {!cases && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={9}>{i === 0 ? <Skeleton label="불러오는 중입니다." /> : <span className="sk-bar" />}</td></tr>)}
              {shown.map((c, i) => (
                <Row key={c.household.id} c={c} on={openId === c.household.id} checked={sel.includes(c.household.id)}
                  group={grouped && (i === 0 || shown[i - 1].f2.level !== c.f2.level) ? { level: c.f2.level, n: groupCount(c.f2.level) } : null}
                  toggle={() => setSel(sel.includes(c.household.id) ? sel.filter((i2) => i2 !== c.household.id) : [...sel, c.household.id])}
                  open={() => setOpenId(c.household.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <span className="muted num">{rows.length ? `${page * PAGE + 1}–${page * PAGE + shown.length} / ${rows.length}가구` : '0가구'}</span>
        {rows.length > PAGE && <span><button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button> <button className="btn" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>다음</button></span>}
      </div>
      {open && <PreviewSheet c={open} onClose={closeSheet} />}
    </>
  )
}

function Row({ c, on, checked, toggle, open, group }: { c: View; on: boolean; checked: boolean; toggle: () => void; open: () => void; group: { level: string; n: number } | null }) {
  const urgent = c.f2.level === '긴급' && !c.decided
  const reasons = topItems(c)
  const kinds = consentKinds(c)
  const consent = kinds.includes('거부') ? { I: Ban, t: '연락 거부 이력' } : kinds.includes('보류') ? { I: CircleHelp, t: '신청 보류(장벽)' } : kinds.includes('동의') ? { I: CircleCheck, t: '연락 동의' } : { I: CircleHelp, t: '연락 동의 미확인' }
  const memo = c.interpretationConfirmed ? { I: CircleCheck, t: '메모 해석: 담당자 확인' } : needsCheck(c) ? { I: CircleHelp, t: '메모 해석: 확인 필요' } : { I: PencilLine, t: '메모 해석: 초안' }
  return (
    <tr className={`click${group ? ' first' : ''}${urgent ? ' hot' : ''}${on ? ' sel' : ''}`} data-row={c.household.id} tabIndex={0} aria-label={`${c.household.id} ${c.f2.level} ${c.f2.total}점, 요약 열기`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,input,label')) open() }}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open() } }}>
      <td className="c-gut">{group && <span className={`gtab g-${group.level}`}>{group.level}<i className="num">{group.n}</i></span>}</td>
      <td className="c-sel"><input type="checkbox" aria-label={`${c.household.id} 선택`} checked={checked} onChange={toggle} /></td>
      <td className="c-score"><ScoreBar total={c.f2.total} /></td>
      <td className="c-level" title={`${c.f2.level} · 다음 확인 ${c.f2.next_check_due}`}><LevelBadge level={c.f2.level} /></td>
      <td className="c-id">
        <Link to={`/case/${c.household.id}`}>{c.household.id}</Link>{c.session && <span className="tag-s">분석 추가</span>}
        <div className="sub nowrap" title={`${place(c)} · ${c.household.household_type}`}>{place(c)} · {c.household.household_type}</div>
      </td>
      <td className="c-reason">
        {reasons[0] && <span title={reasons.map((i) => `${i.chip} +${i.points}`).join(' · ')}>{reasons[0].chip}</span>}
        {reasons.length > 1 && <span className="more-n" aria-label={`외 ${reasons.length - 1}개 사유`}> +{reasons.length - 1}</span>}
        {c.action.safety_check && <span className="quiet-safe"><ShieldCheck size={14} aria-hidden="true" />안전 확인</span>}
      </td>
      <td className="c-days num">{c.household.days_since_closure}<i>일</i></td>
      <td className="c-act">{ACTION_LABEL(c.action.outreach)}</td>
      <td className="c-dec">
        <StatusTag c={c} />
        <span className="ico-pair">
          <span className="ico" title={consent.t} role="img" aria-label={consent.t}><consent.I size={16} aria-hidden="true" /></span>
          <span className="ico" title={memo.t} role="img" aria-label={memo.t}><memo.I size={16} aria-hidden="true" /></span>
        </span>
        {c.assignee && <div className="sub nowrap">담당 {c.assignee}</div>}
      </td>
    </tr>
  )
}

function PreviewSheet({ c, onClose }: { c: View; onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null)
  const toast = useToast()
  const [who, setWho] = useState(c.assignee ?? ASSIGNEES[0])
  useEffect(() => {
    closeBtn.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const h = c.household
  const items = [...c.f2.items].sort((a, b) => b.points - a.points)
  return (
    <>
      <div className="sheet-back" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">
        <div className="sheet-head">
          <div>
            <h2 id="sheet-t">{h.id} <LevelBadge level={c.f2.level} /></h2>
            <p className="sub">{place(c)} · {h.household_type} · 종결 후 {h.days_since_closure}일 · 다음 확인 {c.f2.next_check_due}</p>
          </div>
          <button ref={closeBtn} className="icon-btn" aria-label="요약 닫기" onClick={onClose}><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="sheet-body">
          <section aria-labelledby="sh-s">
            <h3 id="sh-s">점수 {c.f2.total}<span className="of">/100</span></h3>
            <ul className="sh-items">
              {items.map((i) => (
                <li key={i.key} className={i.points === 0 ? 'zero' : ''}>
                  <span className="sh-l"><b>{i.key} {i.label}</b><span className="num">{i.unknown ? '미확인' : `${i.points}/${i.max}`}</span></span>
                  <span className="bar wide" role="presentation"><span style={{ width: `${(i.points / i.max) * 100}%` }} /></span>
                  {i.points > 0 && <span className="sub">{i.chip}</span>}
                  {i.evidence.map((q) => <q key={q} className="ev"><mark>{q}</mark></q>)}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="sh-a">
            <h3 id="sh-a">제안</h3>
            <p><b>{ACTION_LABEL(c.action.outreach)}</b>{c.action.due && <span className="muted"> · 기한 {md(c.action.due)}</span>}</p>
            {c.action.safety_check && <p className="quiet-safe"><ShieldCheck size={16} aria-hidden="true" />안전 확인 경로: {c.action.safety_check.channels.join(', ')}</p>}
            <p className="caption muted">{c.decided ? `처리: ${ACTION_LABEL(c.decision.status)}` : '미검토'}</p>
          </section>
          <section aria-labelledby="sh-w">
            <h3 id="sh-w">담당자 배정</h3>
            <div className="assign">
              <label className="inline"><span className="sr-only">담당자 선택</span>
                <select value={who} onChange={(e) => setWho(e.target.value)}>{ASSIGNEES.map((a) => <option key={a}>{a}</option>)}</select>
              </label>
              <button className="btn" onClick={() => { assignCases([h.id], who); toast(`${h.id}를 ${who}에게 배정했습니다.`) }}><UserPlus size={18} aria-hidden="true" />담당자 배정</button>
            </div>
            {c.assignee && <p className="caption muted">현재 담당: {c.assignee}</p>}
          </section>
        </div>
        <div className="sheet-foot">
          <Link className="btn primary" to={`/case/${h.id}`}>상세 보기</Link>
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </aside>
    </>
  )
}
