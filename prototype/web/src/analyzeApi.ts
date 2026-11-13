// 메모 분석 API 클라이언트. 계약: prototype/api/CONTRACT.md
// POST /api/analyze 는 SSE지만 EventSource가 POST를 못 하므로 fetch + ReadableStream으로 직접 읽는다.
import { useEffect, useState } from 'react'
import type { Case, F1 } from './data'

export interface StepDef { id: string; label: string }
export interface SampleMemo { date: string; consult_type: string; text: string }
export interface Sample { id: string; title: string; household_type: string; memos: SampleMemo[] }
export interface AnalyzeRequest { household_type: string; memos: SampleMemo[]; mode: 'auto' | 'live' | 'replay' }
export interface StepEvent { id: string; status: 'running' | 'done' | 'error' | 'skipped'; ms?: number; detail?: string; memo_index?: number }
export interface AnalyzeResult { f1: F1[]; repeated_barrier: Case['household']['repeated_barrier']; f2: Case['f2']; action: Case['action']; f3: Case['f3'] }
export type AnalyzeEvent =
  | { event: 'start'; data: { run_id?: string; mode: 'live' | 'replay'; model?: string; steps: StepDef[] } }
  | { event: 'step'; data: StepEvent }
  | { event: 'f1'; data: { memo_index: number; f1: F1 } }
  | { event: 'result'; data: AnalyzeResult }
  | { event: 'error'; data: { message: string } }
  | { event: 'end'; data: { run_id?: string; elapsed_ms?: number } }

export const DEFAULT_STEPS: StepDef[] = [
  { id: 'validate', label: '원문 확인' }, { id: 'f1', label: '메모 읽기' }, { id: 'quote_check', label: '인용 원문 대조' },
  { id: 'refusal_guard', label: '거부 표현 가드' }, { id: 'cross', label: '회차 비교' }, { id: 'f2', label: '재검토 점수' },
  { id: 'action', label: '행동 제안' }, { id: 'f3', label: '조건 대조' },
]

// ---------- 녹화본(웹 번들 포함, 없으면 빈 객체) ----------
type Rec = Record<string, unknown>
const recFiles = import.meta.glob('../mock/recordings/*.json', { eager: true, import: 'default' }) as Record<string, Rec>
export const recordings: Rec[] = Object.values(recFiles).filter((r) => Array.isArray(r.events))
const asArr = (v: unknown) => (Array.isArray(v) ? v : [])
const recInput = (r: Rec): Sample => {
  const inp = (r.sample ?? r.input ?? r.request ?? r) as Rec
  return {
    id: String(r.id ?? inp.id ?? ''), title: String(r.title ?? inp.title ?? '녹화된 예시'),
    household_type: String(inp.household_type ?? r.household_type ?? '1인가구'), memos: asArr(inp.memos) as SampleMemo[],
  }
}
export const recordedSamples = (): Sample[] => recordings.map(recInput).filter((s) => s.memos.length)

/** 녹화 JSON에서 이벤트 열을 꺼낸다. events 배열({event,data,t?})을 우선하고, 없으면 결과만으로 만든다. */
function recEvents(r: Rec): (AnalyzeEvent & { t?: number; t_ms?: number })[] {
  const ev = asArr(r.events ?? r.stream) as (AnalyzeEvent & { t?: number; t_ms?: number })[]
  if (ev.length) return ev.map((e) => ({ ...e, t: e.t ?? e.t_ms })) as (AnalyzeEvent & { t?: number; t_ms?: number })[]
  const res = (r.result ?? null) as AnalyzeResult | null
  if (!res) return []
  const out: (AnalyzeEvent & { t?: number; t_ms?: number })[] = [{ event: 'start', data: { mode: 'replay', steps: DEFAULT_STEPS } }]
  DEFAULT_STEPS.forEach((s) => { out.push({ event: 'step', data: { id: s.id, status: 'running' } }); if (s.id === 'f1') res.f1.forEach((f, i) => out.push({ event: 'f1', data: { memo_index: i, f1: f } })); out.push({ event: 'step', data: { id: s.id, status: 'done' } }) })
  out.push({ event: 'result', data: res }, { event: 'end', data: {} })
  return out
}
const sameInput = (a: SampleMemo[], b: SampleMemo[]) => a.length === b.length && a.every((m, i) => m.text.trim() === b[i].text.trim())
export const findRecording = (memos: SampleMemo[]) => recordings.find((r) => sameInput(recInput(r).memos, memos))

const sleep = (ms: number, sig?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  sig?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')) })
})

/** 녹화 재생: 이벤트 사이를 t(ms)가 있으면 그 간격, 없으면 280ms로 보낸다. 전체 6초 이내. */
export async function* replay(r: Rec, sig?: AbortSignal): AsyncGenerator<AnalyzeEvent> {
  const ev = recEvents(r)
  const withT = ev.every((e) => typeof e.t === 'number')
  const total = withT ? Math.max(1, ev[ev.length - 1].t!) : ev.length * 280
  const k = Math.min(1, 6000 / total)
  let prev = 0
  for (let i = 0; i < ev.length; i++) {
    const at = withT ? ev[i].t! * k : (i + 1) * 280 * k
    await sleep(Math.max(0, at - prev), sig)
    prev = at
    const e = ev[i]
    if (e.event === 'start') yield { event: 'start', data: { ...e.data, mode: 'replay' } } as AnalyzeEvent
    else yield e
  }
}

// ---------- 서버 ----------
export async function* streamAnalyze(req: AnalyzeRequest, sig: AbortSignal): AsyncGenerator<AnalyzeEvent> {
  const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(req), signal: sig })
  if (!r.ok || !r.body) throw new Error(`서버 응답 ${r.status}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2)
      let event = 'message'; const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (!data.length) continue
      try { yield { event, data: JSON.parse(data.join('\n')) } as AnalyzeEvent } catch { /* 깨진 조각은 건너뜀 */ }
    }
  }
}

export interface Health { state: 'checking' | 'live' | 'replay' | 'off'; model?: string }
export async function fetchHealth(): Promise<Health> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500)
    const r = await fetch('/api/health', { signal: ctl.signal }); clearTimeout(t)
    if (!r.ok) return { state: 'off' }
    const j = await r.json()
    return j.ollama && j.mode !== 'replay' ? { state: 'live', model: j.model } : { state: 'replay', model: j.model }
  } catch { return { state: 'off' } }
}
export function useHealth() {
  const [h, setH] = useState<Health>({ state: 'checking' })
  useEffect(() => { let on = true; fetchHealth().then((x) => on && setH(x)); return () => { on = false } }, [])
  return h
}

export async function fetchSamples(): Promise<{ samples: Sample[]; from: 'api' | 'recording' }> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500)
    const r = await fetch('/api/samples', { signal: ctl.signal }); clearTimeout(t)
    if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) return { samples: j, from: 'api' } }
  } catch { /* 녹화본으로 */ }
  return { samples: recordedSamples(), from: 'recording' }
}
