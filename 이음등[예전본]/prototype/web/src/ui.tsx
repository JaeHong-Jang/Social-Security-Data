import { Link, useLocation } from 'react-router-dom'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Ban, CircleAlert, Info, CircleCheck, CircleHelp, CircleX, PencilLine, Search, ShieldCheck } from 'lucide-react'
import lampSvg from '../../../design/assets/lamp.svg?raw'
import familyUrl from '../../../design/assets/family-papercut.svg'
import { ACTION_LABEL, type Level, type View } from './data'

/** lit=true 는 긴급 가구 상세 머리글에서만 쓴다(레드 예산 R3). */
export function LampIcon({ lit = false, size = 24 }: { lit?: boolean; size?: 16 | 20 | 24 | 28 }) {
  return (
    <span
      className={`lamp${lit ? ' lit' : ''}`} aria-hidden="true" style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: lampSvg }}
    />
  )
}

/** 단계 표시: 색 + 아이콘 + 글자. 긴급=램프, 주의=삼각형, 관찰=원. 빨강은 긴급에만. */
export function LevelMark({ level, size = 18 }: { level: Level; size?: number }) {
  if (level === '긴급') return <LampIcon lit size={size <= 18 ? 20 : 24} />
  if (level === '주의') return <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5 16 15.5H2z" fill="none" stroke="var(--warn-700)" strokeWidth="2" strokeLinejoin="round" /></svg>
  return <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="var(--observe-700)" strokeWidth="2" /></svg>
}
/** 단계 표시는 판단을 저장해도 바뀌지 않는다. 처리 상태는 StatusTag(도장)로 따로 보인다. */
export function LevelBadge({ level }: { level: Level }) {
  return <span className={`lvl lvl-${level}`}><LevelMark level={level} /><b>{level}</b></span>
}

/** 처리 결정 도장: --primary 잉크, 빨강 금지. */
export const Stamp = ({ children }: { children: ReactNode }) => <span className="stamp">{children}</span>
export const StatusTag = ({ c }: { c: View }) =>
  c.decided ? <Stamp>{ACTION_LABEL(c.decision.status)}</Stamp> : <span className="undec">미검토</span>

type Tone = 'neutral' | 'warn' | 'done' | 'draft' | 'info' | 'observe'
export function Tag({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: 'ok' | 'ban' | 'help' | 'pencil' | 'x' | 'alert' | 'shield' | 'search'; children: ReactNode }) {
  const Icon = icon && { ok: CircleCheck, ban: Ban, help: CircleHelp, pencil: PencilLine, x: CircleX, alert: CircleAlert, shield: ShieldCheck, search: Search }[icon]
  return <span className={`tag tag-${tone}`}>{Icon && <Icon size={16} aria-hidden="true" />}{children}</span>
}

export function ScoreBar({ total }: { total: number }) {
  return <span className="score"><b className="serif num">{total}</b><span className="of">/100</span></span>
}

export function SubNav({ on }: { on: 'data' | 'rules' }) {
  return (
    <nav className="subnav" aria-label="근거 구역">
      <Link to="/data" className={on === 'data' ? 'on' : ''} aria-current={on === 'data' ? 'page' : undefined}>데이터 진단</Link>
      <Link to="/rules" className={on === 'rules' ? 'on' : ''} aria-current={on === 'rules' ? 'page' : undefined}>규칙 공개</Link>
    </nav>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <img src={familyUrl} alt="" height={96} />
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  )
}

export const FairnessNote = ({ items }: { items: string[] }) => (
  <p className="fairness"><Ban size={16} aria-hidden="true" /><span>점수 미사용: {items.join('·')}</span></p>
)

/** 짧은 설명은 ⓘ 안에 넣는다(본문에 문단을 두지 않는다). */
export function Hint({ children, label = '설명' }: { children: ReactNode; label?: string }) {
  return (
    <details className="hint">
      <summary aria-label={label}><Info size={16} aria-hidden="true" /></summary>
      <div className="hint-body">{children}</div>
    </details>
  )
}

export const Skeleton = ({ label }: { label: string }) => (
  <div role="status" className="skeleton"><span className="sk-bar" /><span className="sk-bar short" />{label}</div>
)

// ---------- 토스트 ----------
const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([])
  const n = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { pathname } = useLocation()
  const push = useCallback((msg: string) => {
    const id = ++n.current
    clearTimeout(timer.current)
    setItems([{ id, msg }]) // 한 번에 하나만
    timer.current = setTimeout(() => setItems([]), 4000)
  }, [])
  useEffect(() => { clearTimeout(timer.current); setItems([]) }, [pathname])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <p key={t.id} className="toast"><CircleCheck size={18} aria-hidden="true" />{t.msg}</p>)}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- 확인 대화상자 ----------
export function ConfirmDialog({ title, body, confirm, onConfirm, onCancel }: { title: string; body: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCancel])
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="cd-t" aria-describedby="cd-b" onClick={(e) => e.stopPropagation()}>
        <h2 id="cd-t">{title}</h2>
        <p id="cd-b" className="muted">{body}</p>
        <div className="btn-row">
          <button ref={ref} className="btn" onClick={onCancel}>취소</button>
          <button className="btn primary" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- 원문 인용 하이라이트 ----------
export function Highlighted({ text, ranges }: { text: string; ranges: { start: number; end: number }[] }) {
  const rs = [...ranges].filter((r) => r.end > r.start && r.start >= 0 && r.end <= text.length).sort((a, b) => a.start - b.start)
  const out: ReactNode[] = []
  let at = 0
  rs.forEach((r, i) => {
    if (r.start < at) return // 겹치는 구간은 앞 구간에 포함
    out.push(text.slice(at, r.start))
    out.push(<mark key={i}>{text.slice(r.start, r.end)}</mark>)
    at = r.end
  })
  out.push(text.slice(at))
  return <>{out}</>
}

// ---------- 가로 막대 차트(손으로 그린 CSS 막대) ----------
export interface BarRow { label: string; value: number; text?: string; tone?: 'default' | 'primary' | 'urgent' | 'warn' | 'observe'; sub?: string }
export function HBar({ rows, max, label }: { rows: BarRow[]; max?: number; label: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="hbar" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label}>
          <span className="hb-l">{r.label}{r.sub && <small>{r.sub}</small>}</span>
          <span className="hb-t" role="presentation">
            <span className={`hb-f ${r.tone ?? 'default'}`} style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / m) * 86)}%` }} />
            <span className="hb-v">{r.text ?? r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
