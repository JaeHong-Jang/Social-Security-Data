// 데이터 접근 모듈 (v3 계약: prototype/api/schemas_v2.py). 지금은 mock JSON을 읽고, API가 생기면 load()만 fetch로 바꾼다.
// 주의: 파일의 `audit`(성별·연령 등 편향 점검용)은 화면에서 쓰지 않으므로 가져오지도, 타입에 넣지도 않는다.
import { useEffect, useState } from 'react'
import { meta as mockMeta, cases as mockCases } from '../mock/households.v3.json'

export type Level = '긴급' | '주의' | '관찰'
export type Outreach = '동행 신청 지원(재방문)' | '심층상담(재방문)' | '재방문' | '안부 문자' | '문자재안내' | '재확인 예약'
export type ApplyConsent = '동의' | '거부' | '보류(장벽)' | '미확인'
export type ContactConsent = '동의' | '거부' | '미확인'
export interface Consent { 신청: ApplyConsent; 문자: ContactConsent; 방문: ContactConsent; 전화: ContactConsent }
export interface Evidence { field: string; quote: string; start: number; end: number }
export interface F1 {
  work_status: string; closure_type: string | null; barrier_cause: string; consent: Consent; consent_guard: boolean; support_network: string
  isolation_signals: string[]; evidence: Evidence[]; needs_check: boolean; needs_check_reason: string | null; model: string
}
export interface Memo { discovery_date: string; written_at: string; consult_type: string; text: string; closure_label: string | null; f1: F1 }
export interface MemoQuote { memo_index: number; quote: string; start: number; end: number }
export interface Signal { date: string; kind: string; domain: string | null; source: string }
export interface F2Item {
  key: string; label: string; source: string; points: number; max: number; chip: string; reason: string
  unknown: boolean; evidence: string[]
}
export interface Check { condition: string; status: '충족' | '미충족' | '확인필요'; evidence: string }
export interface Candidate {
  serv_id: string; name: string; org: string; source: '중앙' | '지자체'; criteria_quote: string
  checks: Check[]; apply_method: string; contact: string; fetched_at: string; found_by_tag_filter: boolean
}
export interface Decision {
  status: '미검토' | Outreach; by: string | null; at: string | null; reason: string | null
  ai_suggestion: Outreach; agrees_with_ai: boolean | null
}
export interface Case {
  household: {
    id: string; gu: string; dong: string; household_type: string
    discoveries: { date: string; crisis_domains: string[]; result: string }[]
    memos: Memo[]
    repeated_barrier: { cause: string; summary: string; quotes: MemoQuote[]; model: string } | null
    post_closure_signals: Signal[]
    closed_at: string; days_since_closure: number; consent: Consent; contact_refused: boolean
  }
  f2: { total: number; items: F2Item[]; level: Level; flags: string[]; next_check_due: string; excluded_attributes: string[]; rule_version: string }
  action: {
    outreach: Outreach; outreach_reason: string; due: string | null; consent_note: string
    safety_check: { channels: string[]; triggers: string[]; reason: string } | null
  }
  f1_source: 'llm' | 'mock'
  f3: {
    notice_source: 'mock' | 'llm' | null; tag_filter_source: string
    candidates: Candidate[]; notice_draft: string | null; model: string; tag_filter: Record<string, string[]>
    checks_narrowed: { total: number; 충족: number; 미충족: number; 확인필요: number; summary: string }
  }
  decision: Decision
}
export interface Meta {
  notice: string; reference_date: string; closure_labels: Record<string, string>
  level_thresholds: Record<Level, number>; service_cache_fetched_at: string
  region?: { sido: string; sgg: string; unit: string; dong_source?: string }
  rule_version: string; weights: Record<string, number>; recheck_days: Record<Level, number>
  f1_source: 'llm' | 'mock'; f1_model_info: { model: string; digest: string }; f1_prompt_version: string; f1_run_at: string
}

export const OUTREACH: Outreach[] = ['동행 신청 지원(재방문)', '심층상담(재방문)', '재방문', '안부 문자', '문자재안내', '재확인 예약']
export const ACTION_LABEL = (s: Decision['status']) => (s === '문자재안내' ? '문자 재안내' : s)
export const OPERATOR = '담당자(가상)'

// ---------- 로딩 ----------
export let dataSource: 'api' | 'mock' = 'mock'
let cache: Promise<{ meta: Meta; cases: Case[] }> | null = null
async function load() {
  // 계약: GET /api/cases → {meta, cases}. 서버가 꺼져 있으면 mock JSON으로 대신한다.
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2500)
    const r = await fetch('/api/cases', { signal: ctl.signal })
    clearTimeout(t)
    if (r.ok) {
      const j = await r.json()
      if (j?.meta && Array.isArray(j.cases)) { dataSource = 'api'; return j as { meta: Meta; cases: Case[] } }
    }
  } catch { /* 서버 없음 → mock */ }
  dataSource = 'mock'
  return { meta: mockMeta as unknown as Meta, cases: mockCases as unknown as Case[] }
}

// ---------- 담당자 입력(메모리 + localStorage) ----------
interface NoticeState { text: string; approved: { by: string; at: string } | null }
export type Review = 'approved' | 'rejected'
export interface LogEntry {
  id: string; at: string; kind: 'decision' | 'assign' | 'review' | 'notice' | 'analysis'; caseId: string; text: string
  status?: string; ai?: string; agrees?: boolean | null; reason?: string | null; by?: string
}
interface Local {
  decisions: Record<string, Decision>
  history: Record<string, Decision[]>
  confirmed: Record<string, boolean>
  notices: Record<string, NoticeState>
  assign: Record<string, string>
  review: Record<string, Review>
  log: LogEntry[]
  session: Case[]
}
const KEY = 'ieumdeung-demo-v3'
const empty = (): Local => ({ decisions: {}, history: {}, confirmed: {}, notices: {}, assign: {}, review: {}, log: [], session: [] })
let local: Local = empty()
try { local = { ...local, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { /* 저장소를 쓸 수 없으면 메모리만 */ }
const listeners = new Set<() => void>()
function commit() {
  try { localStorage.setItem(KEY, JSON.stringify(local)) } catch { /* 무시 */ }
  local = { ...local }
  listeners.forEach((l) => l())
}
/** 한국 표준시(KST) 시각 문자열. 화면·기록·CSV가 모두 같은 시각대를 쓴다. */
export const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19)
const nowIso = kstNow
function pushLog(e: Omit<LogEntry, 'id' | 'at'>) {
  local.log = [...local.log, { ...e, id: `${Date.now()}-${local.log.length}`, at: nowIso() }]
}

export const ASSIGNEES = ['담당자 A(가상)', '담당자 B(가상)', '담당자 C(가상)']

export function saveDecision(c: Case, status: Decision['status'], reason: string) {
  const prev = local.decisions[c.household.id] ?? c.decision
  if (prev.status !== '미검토') local.history[c.household.id] = [...(local.history[c.household.id] ?? []), prev]
  const decided = status !== '미검토'
  const agrees = decided ? status === c.decision.ai_suggestion : null
  local.decisions[c.household.id] = {
    status, ai_suggestion: c.decision.ai_suggestion,
    by: decided ? OPERATOR : null, at: decided ? nowIso() : null,
    reason: reason.trim() || null, agrees_with_ai: agrees,
  }
  pushLog({
    kind: 'decision', caseId: c.household.id, by: OPERATOR, status, ai: c.decision.ai_suggestion, agrees, reason: reason.trim() || null,
    text: decided ? `${c.household.id} 판단 저장: ${ACTION_LABEL(status)}` : `${c.household.id} 판단 취소(미검토로 되돌림)`,
  })
  commit()
}
export function confirmInterpretation(id: string) {
  local.confirmed[id] = true
  pushLog({ kind: 'review', caseId: id, by: OPERATOR, text: `${id} 메모 해석 확정` })
  commit()
}
export const reviewKey = (id: string, mi: number, group: string) => `${id}:${mi}:${group}`
export function setReview(id: string, mi: number, group: string, v: Review | null) {
  const k = reviewKey(id, mi, group)
  const next = { ...local.review }
  if (v) next[k] = v; else delete next[k]
  local.review = next
  if (v) pushLog({ kind: 'review', caseId: id, by: OPERATOR, text: `${id} ${mi + 1}회차 ${group} 해석 ${v === 'approved' ? '승인' : '반려'}` })
  commit()
}
export function setReviewMany(id: string, mi: number, groups: string[], v: Review | null, label: string) {
  const next = { ...local.review }
  groups.forEach((g) => { const k = reviewKey(id, mi, g); if (v) next[k] = v; else delete next[k] })
  local.review = next
  if (v) pushLog({ kind: 'review', caseId: id, by: OPERATOR, text: `${id} ${mi + 1}회차 ${label}` })
  commit()
}
export function saveNotice(id: string, patch: Partial<NoticeState>) {
  local.notices[id] = { ...(local.notices[id] ?? { text: '', approved: null }), ...patch }
  if (patch.approved) pushLog({ kind: 'notice', caseId: id, by: OPERATOR, text: `${id} 재안내문 담당자 승인` })
  commit()
}
export function assignCases(ids: string[], who: string) {
  const next = { ...local.assign }
  ids.forEach((id) => { next[id] = who; pushLog({ kind: 'assign', caseId: id, by: OPERATOR, text: `${id} 담당자 배정: ${who}` }) })
  local.assign = next
  commit()
}
export function addSessionCase(c: Case) {
  local.session = [...local.session.filter((x) => x.household.id !== c.household.id), c]
  pushLog({ kind: 'analysis', caseId: c.household.id, by: OPERATOR, text: `${c.household.id} AI 분석 결과를 대기열에 추가` })
  commit()
}
export function resetDemo() { local = empty(); commit() }

/** 로컬 결정·확정·안내문을 덮어쓴 화면용 케이스 */
export interface View extends Case {
  decided: boolean; interpretationConfirmed: boolean; history: Decision[]; notice: NoticeState | null
  assignee: string | null; session: boolean
}
function view(c: Case, session = false): View {
  const id = c.household.id
  const decision = local.decisions[id] ?? c.decision
  const decided = decision.status !== '미검토'
  return {
    ...c, decision, decided, history: local.history[id] ?? [], notice: local.notices[id] ?? null,
    interpretationConfirmed: !!local.confirmed[id] || (decided && !needsCheck(c)),
    assignee: local.assign[id] ?? null, session,
  }
}

export function useData() {
  const [state, setState] = useState<{ meta: Meta; cases: Case[] } | null>(null)
  const [error, setError] = useState(false)
  const [, tick] = useState(0)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    cache ??= load()
    setError(false)
    cache.then(setState, () => setError(true))
  }, [attempt])
  useEffect(() => {
    const l = () => tick((n) => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  const base = state?.cases.map((c) => view(c)) ?? []
  const cases = state ? [...base, ...local.session.map((c) => view(c, true))] : undefined
  return {
    meta: state?.meta, cases, error, retry: () => { cache = null; setAttempt((n) => n + 1) },
    log: local.log, review: local.review, source: dataSource,
  }
}

/** 처리 기록: 이 브라우저에서 저장한 판단 + mock에 미리 들어 있던 판단 */
/** state: current=지금 유효한 판단, prev=나중에 바뀐 이전 판단, cancel=미검토로 되돌린 취소 기록 */
export interface RecordRow { at: string; by: string; caseId: string; status: string; ai: string; agrees: boolean | null; reason: string | null; state: 'current' | 'prev' | 'cancel' }
export function decisionRecords(cases: View[], log: LogEntry[]): RecordRow[] {
  const dec = log.filter((e) => e.kind === 'decision' && e.status)
  const lastIdx = new Map<string, number>()
  dec.forEach((e, i) => lastIdx.set(e.caseId, i))
  const mine = dec.map((e, i): RecordRow => ({
    at: e.at, by: e.by ?? OPERATOR, caseId: e.caseId, status: e.status!, ai: e.ai ?? '', agrees: e.agrees ?? null, reason: e.reason ?? null,
    state: e.status === '미검토' ? 'cancel' : lastIdx.get(e.caseId) === i ? 'current' : 'prev',
  }))
  const touched = new Set(dec.map((e) => e.caseId))
  const seed = cases.filter((c) => !c.session && c.decided && !touched.has(c.household.id)).map((c): RecordRow => ({
    at: c.decision.at ?? '', by: c.decision.by ?? OPERATOR, caseId: c.household.id, status: c.decision.status,
    ai: c.decision.ai_suggestion, agrees: c.decision.agrees_with_ai, reason: c.decision.reason, state: 'current',
  }))
  return [...seed, ...mine].sort((a, b) => b.at.localeCompare(a.at))
}

export const RANK = { 긴급: 2, 주의: 1, 관찰: 0 } as const
export const byPriority = (a: Case, b: Case) => RANK[b.f2.level] - RANK[a.f2.level] || b.f2.total - a.f2.total

// ---------- 표시용 파생값 ----------
export const needsCheck = (c: Case) => c.household.memos.some((m) => m.f1.needs_check)
export const topItems = (c: Case) =>
  [...c.f2.items].filter((i) => i.points > 0).sort((a, b) => b.points - a.points).slice(0, 2)

/** 연락 의사 표시: 신청 "보류(장벽)"은 거부가 아니라 따로 적는다. */
export function consentParts(c: Case): { kind: '동의' | '거부' | '보류' | '미확인'; text: string }[] {
  const k = c.household.consent
  const out: { kind: '동의' | '거부' | '보류' | '미확인'; text: string }[] = []
  if (c.household.contact_refused) out.push({ kind: '거부', text: '연락 거부' })
  if (k.신청 === '보류(장벽)') out.push({ kind: '보류', text: '신청 보류(장벽)' })
  if (k.신청 === '거부') out.push({ kind: '거부', text: '신청 거부' })
  if (k.전화 === '거부') out.push({ kind: '거부', text: '전화 거부' })
  const ok = (['신청', '문자', '방문', '전화'] as const).filter((x) => k[x] === '동의')
  if (ok.length) out.push({ kind: '동의', text: `${ok[0]} 동의${ok.length > 1 ? ` 외 ${ok.length - 1}건` : ''}` })
  if (!out.length) out.push({ kind: '미확인', text: '미확인' })
  return out
}
export const consentKinds = (c: Case) => consentParts(c).map((p) => p.kind)
export const lastSignal = (c: Case) => c.household.post_closure_signals.at(-1)
export const place = (c: Case) => `${c.household.gu} ${c.household.dong}`
export const fmtTime = (s: string) => s.replace('T', ' ').slice(0, 16)
export const md = (d: string) => d.slice(5).replace('-', '.')

/** 메모 해석(F1) 출처 표기. 예: "qwen3:4b · 프롬프트 r3 · 담당자 확정 전 초안" */
export const modelLabel = (m: Meta) =>
  m.f1_source === 'llm'
    ? `${m.f1_model_info.model.split('-')[0]} · 프롬프트 ${m.f1_prompt_version.split('-')[0]} · 담당자 확정 전 초안`
    : '손으로 단 라벨(가상) · 담당자 확정 전 초안'

/** 이번 주 처리: 기준일 7일 안에 저장된 '현재 유효한' 판단 */
export const weekRecords = (rows: RecordRow[], ref: string) =>
  rows.filter((r) => r.state === 'current' && new Date(r.at).getTime() >= new Date(ref).getTime() - 7 * 864e5)

/** 점수 항목 사유를 짧은 명사구로. 긴 문장은 상세 데이터에 남기고 화면에는 쓰지 않는다. */
export function shortReason(i: F2Item): string {
  const r = i.reason
  let m: RegExpMatchArray | null
  switch (i.key) {
    case 'R': if ((m = r.match(/내 (\d+)회 발굴/))) return `관찰기간 내 ${m[1]}회 발굴`; if (/첫 발굴/.test(r)) return '첫 발굴'; break
    case 'C': if ((m = r.match(/위기영역은 (\d+)개\(([^)]*)\)/))) return `위기영역 ${m[1]}개 (${m[2].replace(/,\s*/g, '·')})`; break
    case 'W': if ((m = r.match(/(\d+)개에서 (\d+)개로 (늘었|늘지)/))) return `위기영역 ${m[1]}→${m[2]}개${m[3] === '늘지' ? ' (증가 없음)' : ''}`; if (/직전 발굴이 없/.test(r)) return '직전 발굴 없음'; break
    case 'M': if (/일치/.test(r)) return '종결 상태 일치'; if (/조사불가/.test(r)) return '조사불가 종결'; if ((m = r.match(/'([^']+)' 상태/))) return `메모상 ${m[1]}`; break
    case 'B': if ((m = r.match(/장벽 원인\(([^)]+)\)/))) return `${m[1]} 반복`; if (/1건뿐/.test(r)) return '비교 메모 없음'; if (/반복되지는/.test(r)) return '반복 없음'; break
    case 'I': {
      const p: string[] = []
      if (/1인가구입니다/.test(r)) p.push('1인가구'); else if (/1인가구가 아닙니다/.test(r)) p.push('다인가구')
      if (/관계망 부재/.test(r)) p.push('관계망 부재'); else if (/관계망이 있/.test(r)) p.push('관계망 있음'); else if (/관계망은 메모 인용이 없어/.test(r)) p.push('관계망 미확인')
      if (/고립 징후가 있/.test(r)) p.push('고립 징후')
      if (p.length) return p.join(' · ')
      break
    }
    case 'N': {
      if (/없습니다/.test(r)) return '새 신호 없음'
      const items = [...r.matchAll(/([^,():]+?)\((\d\d\.\d\d)/g)].map((x) => `${x[1].trim()} ${x[2]}`)
      if (items.length) return items.join(', ')
      break
    }
    case 'T': if ((m = r.match(/종결 후 (\d+)일/))) return `종결 후 ${m[1]}일`; break
  }
  return i.chip
}
export const sourceLabel = (s: string) => (s === '행정+F1' ? '행정자료·메모' : s === 'F1' ? '메모' : s === '행정' ? '행정자료' : s)
