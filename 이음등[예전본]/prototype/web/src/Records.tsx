import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleAlert, Download, FlaskConical } from 'lucide-react'
import { ACTION_LABEL, OPERATOR, decisionRecords, fmtTime, useData, weekRecords, type Decision } from './data'
import { EmptyState, Skeleton, Stamp, Tag, useToast } from './ui'

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`

export default function Records() {
  const { meta, cases, log, error, retry } = useData()
  const [params, setParams] = useSearchParams()
  const week = params.get('week') === '1'
  const toast = useToast()
  const [kind, setKind] = useState('')
  const [agree, setAgree] = useState('')
  const [q, setQ] = useState('')
  if (error) return <p className="err"><CircleAlert size={18} aria-hidden="true" />오류 기록을 불러오지 못했습니다. <button className="linkbtn" onClick={retry}>다시 시도</button></p>
  if (!cases) return <Skeleton label="불러오는 중입니다." />

  const all = decisionRecords(cases, log)
  const live = all.filter((r) => r.state === 'current') // KPI는 각 가구의 현재 판단만 센다
  const weekIds = new Set(weekRecords(all, meta?.reference_date ?? '2026-11-13').map((r) => `${r.caseId}|${r.at}`))
  const rows = all.filter((r) => (!week || weekIds.has(`${r.caseId}|${r.at}`)) && (!kind || r.status === kind) && (!agree || (agree === '일치' ? r.agrees === true : r.agrees === false)) && (!q || `${r.caseId} ${r.reason ?? ''}`.includes(q.trim())))
  const judged = live.filter((r) => r.agrees !== null)
  const diff = judged.filter((r) => r.agrees === false).length
  const contacts = live.filter((r) => r.status !== '재확인 예약').length
  const accompany = live.filter((r) => r.status.startsWith('동행')).length
  const notices = cases.filter((c) => c.notice?.approved).length
  const assigns = log.filter((e) => e.kind === 'assign').length
  const statuses = [...new Set(all.map((r) => r.status))]

  const exportCsv = () => {
    const head = ['가구', '결정 시각', '담당자', '결정', '제안', '제안과 일치', '사유', '상태']
    const body = rows.map((r) => [r.caseId, r.at, r.by, r.state === 'cancel' ? '판단 취소' : r.status, r.ai, r.agrees === null ? '' : r.agrees ? '일치' : '불일치', r.reason ?? '', r.state === 'current' ? '현재' : r.state === 'prev' ? '이전 판단' : '취소'])
    const text = '﻿' + [head, ...body].map((l) => l.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = '이음등_처리기록(가상).csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`처리 기록 ${rows.length}건을 CSV로 내려받았습니다.`)
  }

  return (
    <>
      <h1>처리 기록·성과</h1>

      <div className="kpis">
        <div className="card kpi"><span className="kpi-l">판단 기록</span><span className="kpi-v"><b>{live.length}</b>건</span><span className="caption muted">현재 판단 (변경·취소 {all.length - live.length}건 제외)</span></div>
        <div className="card kpi"><span className="kpi-l">제안과 다르게 결정</span><span className="kpi-v"><b>{judged.length ? Math.round((diff / judged.length) * 100) : 0}</b>%</span><span className="caption muted">{diff} / {judged.length}건</span></div>
        <div className="card kpi"><span className="kpi-l">재접촉 결정</span><span className="kpi-v"><b>{contacts}</b>건</span><span className="caption muted">재확인 예약 제외</span></div>
        <div className="card kpi"><span className="kpi-l">연계 준비</span><span className="kpi-v"><b>{accompany + notices}</b>건</span><span className="caption muted">동행 {accompany} + 안내문 {notices}</span></div>
      </div>
      <p className="caption muted"><FlaskConical size={14} aria-hidden="true" /> 가상 시연 지표 · 담당자 배정 {assigns}건</p>

      <div className="toolbar">
        <label className="search"><span className="sr-only">가구 번호·사유 검색</span>
          <input type="search" value={q} placeholder="가구 번호, 사유 검색" onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="inline">결정<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">전체</option>{statuses.map((s) => <option key={s} value={s}>{ACTION_LABEL(s as Decision['status'])}</option>)}</select></label>
        <label className="inline">제안과<select value={agree} onChange={(e) => setAgree(e.target.value)}><option value="">전체</option><option>일치</option><option>불일치</option></select></label>
        {week && <button className="fchip on" aria-pressed="true" onClick={() => setParams({}, { replace: true })}>최근 7일만 ✕</button>}
      </div>
      <div className="sec-head"><h2>판단 기록 <small>({rows.length}건)</small></h2>
        <button className="btn" onClick={exportCsv} disabled={rows.length === 0}><Download size={18} aria-hidden="true" />CSV 내려받기</button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={all.length ? '조건에 맞는 기록 없음' : '기록 없음'}
          action={<Link className="btn primary" to="/queue">대기열에서 가구 열기</Link>}>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="queue rec">
            <caption className="sr-only">처리 기록</caption>
            <thead><tr><th scope="col" className="c-rid">가구</th><th scope="col" className="c-rt">언제</th><th scope="col" className="c-rw">누가</th><th scope="col">무엇을</th><th scope="col">제안과</th><th scope="col" className="c-rr">사유</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.caseId}-${r.at}-${i}`} className={r.state === 'current' ? '' : 'old'}>
                  <td data-l="가구" className="nowrap id-cell"><Link to={`/case/${r.caseId}`}>{r.caseId}</Link></td>
                  <td data-l="언제">{fmtTime(r.at)}</td>
                  <td data-l="누가">{r.by || OPERATOR}</td>
                  <td data-l="무엇을">{r.state === 'cancel' ? <b>판단 취소 <small className="muted">(미검토로 되돌림)</small></b> : <>{r.state === 'prev' ? <><b className="strike">{ACTION_LABEL(r.status as Decision['status'])}</b><small className="muted"> 이전 판단</small></> : <Stamp>{ACTION_LABEL(r.status as Decision['status'])}</Stamp>}</>}</td>
                  <td data-l="제안과">{r.state === 'cancel' ? '—' : r.agrees === null ? '—' : r.agrees ? <Tag tone="done" icon="ok">일치</Tag> : <Tag tone="warn" icon="help">다름 · 제안 {ACTION_LABEL(r.ai as Decision['status'])}</Tag>}</td>
                  <td data-l="사유">{r.reason ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
