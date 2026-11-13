import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Ban, ChevronLeft, CircleAlert, CircleCheck, CircleHelp, CircleX, Copy, Printer, RotateCcw } from 'lucide-react'
import { ACTION_LABEL, OPERATOR, kstNow, consentParts, fmtTime, place, saveNotice, useData, type Candidate, type View } from './data'
import { EmptyState, Hint, Skeleton, StatusTag, Tag, useToast } from './ui'

const STATUS = { 충족: ['done', CircleCheck, '충족'], 미충족: ['observe', CircleX, '미충족'], 확인필요: ['warn', CircleHelp, '확인 필요'] } as const
// 안내문에는 점수·단계·위험 문구가 들어가면 안 된다. '긴급복지' 같은 제도명은 허용.
const FORBIDDEN = /점수|위험|우선순위|긴급(?!복지)/

export default function Reguide() {
  const { id } = useParams()
  const { meta, cases, error, retry } = useData()
  if (error) return <p className="err"><CircleAlert size={18} aria-hidden="true" />오류 서비스 정보를 불러오지 못했습니다. <button className="linkbtn" onClick={retry}>다시 시도</button></p>
  if (!cases || !meta) return <Skeleton label="불러오는 중입니다." />
  const c = cases.find((x) => x.household.id === id)
  if (!c) return <><h1>가구를 찾을 수 없습니다</h1><EmptyState title="해당 번호의 가구가 없습니다." action={<Link className="btn" to="/queue">재검토 대기열로</Link>} /></>
  return <ReguideBody key={id} c={c} fetchedAt={meta.service_cache_fetched_at} />
}

function ReguideBody({ c, fetchedAt }: { c: View; fetchedAt: string }) {
  const { candidates, notice_draft, checks_narrowed: cn, tag_filter } = c.f3
  const mapped = c.f3.tag_filter_source.startsWith('mock')
  const h = c.household
  const tags = Object.values(tag_filter).flat()
  return (
    <>
      <Link to={`/case/${h.id}`} className="back"><ChevronLeft size={16} aria-hidden="true" />{h.id} 가구 상세로</Link>
      <div className="head">
        <h1>조건 대조·재안내</h1>
        <span className="meta">{h.id} · {place(c)}</span>
        <span className="spacer" />
        <StatusTag c={c} />
        <Tag tone="neutral">제안: {ACTION_LABEL(c.action.outreach)}</Tag>
        {consentParts(c).map((p) => <Tag key={p.text} icon={p.kind === '동의' ? 'ok' : p.kind === '거부' ? 'ban' : 'help'}>{p.text}</Tag>)}
      </div>
      <p className="narrowed">
        <b>{cn.total === 0 ? '확인할 조건 없음' : `확인 필요 ${cn.확인필요}개`}</b>
        {cn.total > 0 && <span>조건 {cn.total}개: 충족 {cn.충족} · 미충족 {cn.미충족} · 확인 필요 {cn.확인필요}</span>}
        {tags.length > 0 && <span className="caption muted">검색 태그: {tags.join(' · ')}{mapped && ' (가설 매핑)'}</span>}
      </p>
      {h.contact_refused && (
        <p className="info-line"><Ban size={18} aria-hidden="true" />문자·방문 모두 거부 — 본인 재안내 없음. <Link to={`/case/${h.id}`}>안전 확인은 가구 상세</Link></p>
      )}
      <div className="guide-grid">
        <div>
          <h2 className="sec">후보 {candidates.length}건 <Hint label="후보 설명">최대 3건 · 자격 판정이 아니며 담당자 확인이 필요합니다.</Hint></h2>
          {candidates.length === 0 ? (
            <EmptyState title="후보 없음" action={<Link className="btn" to={`/case/${h.id}`}>가구 상세로</Link>}>
              다음 확인일 {c.f2.next_check_due} · 조회 {fetchedAt.slice(0, 16)}
            </EmptyState>
          ) : candidates.slice(0, 3).map((cd, n) => <CandidateCard key={cd.serv_id} cd={cd} n={n + 1} />)}
        </div>
        {notice_draft === null
          ? <aside className="card notice"><h2>안내문</h2><p className="muted">{h.contact_refused ? '연락 거부 — 작성 안 함' : '안내할 사업 없음'}</p></aside>
          : <NoticePanel c={c} draft={notice_draft} />}
      </div>
    </>
  )
}

function CandidateCard({ cd, n }: { cd: Candidate; n: number }) {
  const open = cd.checks.filter((k) => k.status !== '충족').length
  return (
    <article className="card cand" aria-labelledby={`cand-${n}`}>
      <h3 id={`cand-${n}`}><small>후보 {n}</small> {cd.name} <Tag>{cd.source}</Tag></h3>
      <p className="muted caption">소관 {cd.org}</p>
      <p className="check-line">
        {!cd.found_by_tag_filter && <Tag tone="info" icon="search">태그 검색 외 발견</Tag>}
        {open > 0 && <Tag tone="warn" icon="help">확인 필요 항목 {open}건</Tag>}
      </p>
      <h4>선정기준 원문</h4>
      <blockquote>“{cd.criteria_quote}”</blockquote>
      <table className="cond">
        <caption className="sr-only">{cd.name} 조건 대조</caption>
        <thead><tr><th scope="col">조건</th><th scope="col">판정</th><th scope="col">근거</th></tr></thead>
        <tbody>
          {cd.checks.map((k) => {
            const [tone, Icon, text] = STATUS[k.status]
            return (
              <tr key={k.condition}>
                <td data-l="조건">{k.condition}</td>
                <td data-l="판정"><span className={`tag tag-${tone}`}><Icon size={16} aria-hidden="true" />{text}</span></td>
                <td data-l="근거">{k.evidence}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <dl className="kv"><dt>신청 방법</dt><dd>{cd.apply_method}</dd>{cd.contact && <><dt>문의처</dt><dd>{cd.contact}</dd></>}</dl>
      <p className="caption muted">조회 {fmtTime(cd.fetched_at)}</p>
    </article>
  )
}

function NoticePanel({ c, draft }: { c: View; draft: string }) {
  const toast = useToast()
  const { 문자 } = c.household.consent
  const saved = c.notice
  const text = saved?.text ?? draft
  const edited = text !== draft
  const [checks, setChecks] = useState([false, false, false])
  const forbidden = FORBIDDEN.test(text)
  const smsRefused = 문자 === '거부'
  const labels = [
    '문자 연락 동의 확인', '개인정보·점수 없음', '문장 확인',
  ]
  const why = saved?.approved ? '승인됨' : smsRefused ? '문자 거부 가구 — 승인 불가'
    : !text.trim() ? '안내문이 비어 있음'
    : forbidden ? '점수·단계·위험 문구 포함 — 승인 불가'
    : !checks.every((x) => !!x) ? '확인 3개를 모두 체크' : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(text) }
    catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select()
      try { document.execCommand('copy') } catch { /* 복사 불가 */ }
      t.remove()
    }
    toast('안내문을 복사했습니다.')
  }
  const toggle = (i: number) => setChecks(checks.map((v, k) => (k === i ? !v : v)))

  return (
    <aside className="card notice" aria-labelledby="h-notice">
      <h2 id="h-notice">안내문 <Hint label="안내문 설명">점수·위험 사유는 넣지 않습니다. 담당자가 고친 뒤 직접 발송합니다.</Hint></h2>
      {saved?.approved ? <Tag tone="done" icon="ok">담당자 확인</Tag>
        : edited ? <Tag tone="draft" icon="pencil">담당자 수정</Tag>
        : null}
      <label className="sr-only" htmlFor="notice-text">쉬운 말 안내문</label>
      <textarea id="notice-text" rows={9} value={text} aria-invalid={forbidden}
        onChange={(e) => { setChecks([false, false, false]); saveNotice(c.household.id, { text: e.target.value, approved: null }) }} />
      {forbidden && <p className="err"><CircleAlert size={16} aria-hidden="true" />오류 점수·단계·위험 문구는 안내문에 쓸 수 없습니다.</p>}
            <fieldset>
        <legend>발송 전 확인</legend>
        {smsRefused
          ? <p className="check-line"><Ban size={16} aria-hidden="true" />문자 연락을 거부한 가구입니다. 문자 안내문은 승인할 수 없습니다.</p>
          : <label><input type="checkbox" checked={checks[0]} onChange={() => toggle(0)} />{labels[0]}{문자 === '미확인' && <Tag tone="warn" icon="help">미확인</Tag>}</label>}
        <label><input type="checkbox" checked={checks[1]} onChange={() => toggle(1)} />{labels[1]}</label>
        <label><input type="checkbox" checked={checks[2]} onChange={() => toggle(2)} />{labels[2]}</label>
      </fieldset>
      <div className="btn-row">
        <button className="btn primary" disabled={!!why || !!saved?.approved}
          onClick={() => { saveNotice(c.household.id, { text, approved: { by: OPERATOR, at: kstNow() } }); toast('안내문을 승인했습니다.') }}>담당자 승인</button>
        <button className="btn" disabled={!edited && !saved?.approved} onClick={() => { setChecks([false, false, false]); saveNotice(c.household.id, { text: draft, approved: null }); toast('AI 초안으로 되돌렸습니다.') }}><RotateCcw size={18} aria-hidden="true" />초안으로 되돌리기</button>
        <button className="btn" onClick={copy}><Copy size={18} aria-hidden="true" />안내문 복사</button>
        <button className="btn" onClick={() => window.print()}><Printer size={18} aria-hidden="true" />인쇄</button>
      </div>
      {why && !saved?.approved && <p className="caption muted" role="status">{why}</p>}
      {saved?.approved && <p className="saved" role="status"><CircleCheck size={18} aria-hidden="true" />승인됨 · {saved.approved.by} · {fmtTime(saved.approved.at)}</p>}
      <div className="print-only"><h1>안내문</h1><p>{text}</p></div>
    </aside>
  )
}
