import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, Database, CheckCheck, CheckCircle2, ChevronRight, CircleHelp, Clock3, Download, FileCheck2, FileDiff, FileText, FolderCheck, GitBranch, History, House, Info, Link2, ListFilter, Search, ShieldCheck, SlidersHorizontal, TriangleAlert, X } from 'lucide-react'
import { DEMO_DATE, impacts, type Category, type ImpactItem, type WorkflowStatus } from './demo'
import { approvalBlockReason, statusLabel, verifyBlockReason } from './workflow'
import './styles.css'
import PublicData from './PublicData.tsx'

type CaseState = { status: WorkflowStatus; draft: string; confirmed: boolean; reflected: boolean }
type Audit = { id: number; at: string; itemId: string; title: string; detail: string }
type ModalState = { kind: 'source' | 'dismiss'; item: ImpactItem } | null

const categoryLabel: Record<Category, string> = { current: '우선 검토', upcoming: '시행 예정', evidence: '근거 확인' }
const makeInitialState = () => Object.fromEntries(impacts.map(item => [item.id, { status: 'PROPOSED' as WorkflowStatus, draft: item.draft, confirmed: false, reflected: false }]))
const initialAudit: Audit[] = [{ id: 1, at: '09:40', itemId: 'OI-001', title: '가상 비교 자료 등록', detail: '조례 전후 버전과 안내문을 연결했습니다. 실제 API 수집 기록이 아닙니다.' }]
const nav = [
  { to: '/data', label: '실제 공공데이터', icon: BookOpen, group: '실제 자료' },
  { to: '/impacts', label: '가상 검토 시연', icon: FileDiff, group: '가상 시연' },
  { to: '/links', label: '연결 관리', icon: GitBranch },
  { to: '/sources', label: '출처·수집', icon: Database },
  { to: '/history', label: '검토 이력', icon: History },
]

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>
}
function CategoryBadge({ category }: { category: Category }) {
  return <Badge tone={category === 'current' ? 'blue' : category === 'upcoming' ? 'neutral' : 'amber'}>{category === 'evidence' && <TriangleAlert size={12} />}{categoryLabel[category]}</Badge>
}
function MarkedText({ text, value, variant }: { text: string; value: string; variant: string }) {
  return <>{text.split(value).map((part, i) => <span key={i}>{i > 0 && <mark className={variant}>{value}</mark>}{part}</span>)}</>
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) ref.current?.close() }} aria-labelledby="dialog-title">
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="대화상자 닫기" onClick={() => ref.current?.close()}><X size={20} /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>
}
function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [states, setStates] = useState<Record<string, CaseState>>(makeInitialState)
  const [audit, setAudit] = useState<Audit[]>(initialAudit)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [dismissReason, setDismissReason] = useState('')
  const currentNav = nav.find(item => location.pathname.startsWith(item.to)) ?? nav[0]
  const isPublicData = location.pathname === '/' || location.pathname.startsWith('/data')
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4500); return () => clearTimeout(id) }, [toast])
  useEffect(() => { document.getElementById('main-content')?.focus({ preventScroll: true }); window.scrollTo(0, 0) }, [location.pathname])

  const update = (id: string, patch: Partial<CaseState>) => setStates(previous => ({ ...previous, [id]: { ...previous[id], ...patch } }))
  const record = (item: ImpactItem, title: string, detail: string) => setAudit(previous => [{ id: Date.now(), at: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }), itemId: item.id, title, detail }, ...previous])
  const approve = (item: ImpactItem) => {
    const state = states[item.id]
    const reason = approvalBlockReason(item, state.status, state.draft, state.confirmed)
    if (reason) { setToast(reason); return }
    update(item.id, { status: 'APPROVED' })
    record(item, '가상 정정안 승인', '적용 시점과 정정 초안을 확인했습니다. 안내자료의 실제 수정과는 별개입니다.')
    setToast('정정안을 승인했습니다. 다음 단계에서 수정 결과를 확인하세요.')
  }
  const verify = (item: ImpactItem) => {
    const state = states[item.id]
    const reason = verifyBlockReason(state.status, state.reflected)
    if (reason) { setToast(reason); return }
    update(item.id, { status: 'VERIFIED' })
    record(item, '가상 수정 결과 확인', '승인한 변경이 반영된 후속 안내문을 확인하는 흐름을 시연했습니다.')
    setToast('가상 안내자료의 수정 확인을 마쳤습니다.')
  }
  const exportReport = () => {
    const text = '# 조례 변경 영향 검토 — 가상 시연 보고서\n\n모든 사례는 가상입니다. 실제 조례·사업의 오류나 정정 결과를 뜻하지 않습니다.\n기준일: ' + DEMO_DATE + '\n\n' + impacts.map(item => '## ' + item.id + ' ' + item.title + '\n사업: ' + item.service + '\n변경: ' + item.before + ' → ' + item.after + '\n상태: ' + statusLabel(states[item.id].status) + '\n정정 초안: ' + states[item.id].draft + '\n').join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '가상-조례변경-검토보고서.md'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast('가상 검토 보고서를 저장했습니다.')
  }
  const props = { states, update, showSource: (item: ImpactItem) => setModal({ kind: 'source', item }), approve, verify, showDismiss: (item: ImpactItem) => { setDismissReason(''); setModal({ kind: 'dismiss', item }) }, record, notify: setToast }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">본문으로 이동</a>
    <div className="masthead"><div className="inner"><Info size={16} aria-hidden="true" />공모전 출품용 화면 시제품입니다. 정부 공식 누리집이 아닙니다.</div></div>
    <header className="site-header">
      <div className="inner header-top">
        <Link to="/data" className="brand" aria-label="조례 변경 영향 검토 홈"><span className="brand-symbol"><FileDiff size={24} strokeWidth={1.7} /></span><span>조례 변경 영향 검토</span></Link>
        <div className="header-right">
          <div className="header-utility"><span className={'demo-tag' + (isPublicData ? '' : ' synthetic')}><span />{isPublicData ? '실제 자료 · 읽기 전용' : '가상 화면 시연'}</span>{!isPublicData && <span className="date-label">판단 기준일 <strong>{DEMO_DATE.replaceAll('-', '.')}</strong></span>}<span className="role-label">{isPublicData ? '자료 열람' : '시연 역할 · 업무 검토자'}</span><button aria-label={isPublicData ? '자료 열람 안내' : '화면 시연 안내'} onClick={() => setToast(isPublicData ? '실제 수집한 공개 자료를 읽기 전용으로 열람합니다. 각 자료의 출처와 원수집일을 확인하세요.' : '이 검토 시연의 모든 자료는 가상입니다. 새로고침하면 시연 상태가 초기화됩니다.')}><CircleHelp size={16} />이용 안내</button></div>
          <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); const query = String(new FormData(event.currentTarget).get('q') ?? '').trim(); navigate('/data' + (query ? '?query=' + encodeURIComponent(query) : '')); event.currentTarget.reset() }}><input name="q" aria-label="실제 복지사업 빠른 찾기" placeholder="사업명 또는 근거법령" /><button type="submit" aria-label="실제 복지사업에서 찾기"><Search size={22} /></button></form>
        </div>
      </div>
      <nav className="gnb" aria-label="주 메뉴"><div className="inner">{nav.map(item => <Fragment key={item.to}>{'group' in item && <span className="nav-group">{item.group}</span>}<NavLink to={item.to}>{item.label}{item.to === '/impacts' && <span className="nav-count">{impacts.length}</span>}</NavLink></Fragment>)}</div></nav>
    </header>
    {!isPublicData && <div className="demo-notice"><div className="inner"><Info size={16} /><span><strong>가상 예시로 구성한 화면입니다.</strong> 실제 조례·사업·수집 결과가 아닙니다.</span></div></div>}
      <main id="main-content" tabIndex={-1}>
        <div className="breadcrumb"><Link to="/data"><House size={15} aria-hidden="true" />홈</Link><ChevronRight size={14} aria-hidden="true" />{isPublicData ? '실제 자료' : '가상 시연'}<ChevronRight size={14} aria-hidden="true" /><span>{currentNav.label}</span></div>
        <Routes>
          <Route path="/" element={<Navigate to="/data" replace />} />
          <Route path="/data/*" element={<PublicData />} />
          <Route path="/impacts" element={<Queue states={states} exportReport={exportReport} />} />
          <Route path="/impacts/:id" element={<Detail {...props} />} />
          <Route path="/links" element={<LinksPage showSource={props.showSource} />} />
          <Route path="/sources" element={<SourcesPage notify={setToast} />} />
          <Route path="/history" element={<HistoryPage audit={audit} />} />
          <Route path="*" element={<Navigate to="/data" replace />} />
        </Routes>
      </main>
      <footer className="app-footer"><div className="inner"><div><strong>조례 변경 영향 추적 및 안내 오류 예방 AI</strong><p>근거를 확인하고 담당자가 결정합니다. AI는 후보와 초안만 제안합니다.</p></div><p>{isPublicData ? '실제 공개 자료 · 원문과 수집 범위 열람' : '가상 자료 · 로컬 화면 시제품'}<br />공모전 출품용 시제품 · 정부 공식 누리집 아님</p></div></footer>
    {toast && <div className="toast" role="status"><Info size={18} />{toast}<button aria-label="알림 닫기" onClick={() => setToast('')}><X size={16} /></button></div>}
    {modal?.kind === 'source' && <Modal title="가상 원문과 적용 근거" onClose={() => setModal(null)}>
      <Badge tone="amber">가상 예시 · 공식 원문 아님</Badge><h3>{modal.item.title}</h3>
      <dl className="source-meta"><div><dt>자료 구분</dt><dd>화면 시연을 위해 작성한 예시 문서</dd></div><div><dt>시행일</dt><dd>{modal.item.effectiveDate}</dd></div><div><dt>비교 위치</dt><dd>{modal.item.article}</dd></div></dl>
      <h4>개정 전</h4><blockquote>{modal.item.oldText}</blockquote><h4>개정 후</h4><blockquote>{modal.item.newText}</blockquote>
      <h4>현재 안내문</h4><blockquote>{modal.item.guidanceText}</blockquote>
      <h4>부칙·적용 시점 검토</h4><p className="body-copy">{modal.item.applicability}</p>
      {modal.item.blockReason && <div className="callout amber"><TriangleAlert size={18} />{modal.item.blockReason}</div>}
    </Modal>}
    {modal?.kind === 'dismiss' && <Modal title="검토 제외 사유 기록" onClose={() => setModal(null)}>
      <p className="body-copy">이 건에 정정이 필요하지 않다고 판단한 근거를 남겨 주세요. 근거가 불명확한 건은 제외하지 않고 확인 대상으로 유지합니다.</p>
      <label className="field-label" htmlFor="dismiss-reason">제외 사유</label><textarea id="dismiss-reason" rows={4} value={dismissReason} onChange={e => setDismissReason(e.target.value)} placeholder="미적용 또는 실질 변화가 없다고 판단한 근거" />
      <button className="button primary full-width" disabled={dismissReason.trim().length < 8} onClick={() => { const item = modal.item; if (dismissReason.trim().length < 8 || item.category !== 'current' || states[item.id].status !== 'PROPOSED') return; update(item.id, { status: 'DISMISSED' }); record(item, '가상 검토 제외', dismissReason.trim()); setModal(null); setToast('제외 사유를 검토 이력에 남겼습니다.') }}>사유를 남기고 제외</button>
    </Modal>}
  </div>
}

function Queue({ states, exportReport }: { states: Record<string, CaseState>; exportReport: () => void }) {
  const [tab, setTab] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('all')
  const filtered = impacts.filter(item => (tab === 'all' || item.category === tab) && (department === 'all' || item.department === department) && (item.title + item.service + item.kind).includes(query.trim()))
  const registered = impacts.reduce((sum, item) => sum + item.documents, 0)
  return <>
    <PageHeading title="변경 영향 검토" description="바뀐 조례가 연결된 사업과 안내자료에 어떻게 영향을 주는지 확인하세요." action={<button className="button" onClick={exportReport}><Download size={16} />검토 보고서</button>} />
    <div className="overview-line"><div><span className="summary-label">검토할 변경</span><strong>{impacts.length}<small>건</small></strong></div><span className="overview-divider" /><div><span className="summary-label">연결된 사업</span><strong>{impacts.length}<small>개</small></strong></div><div><span className="summary-label">등록 안내자료</span><strong>{registered}<small>개</small></strong></div><div className="overview-warning"><TriangleAlert size={16} /><span>수집 실패 <strong>1건</strong><Link to="/sources">범위 확인<ChevronRight size={13} /></Link></span></div></div>
    <div className="queue-layout"><section className="queue-panel" aria-label="변경 검토 목록">
      <div className="tab-bar" role="tablist" aria-label="검토 분류">{(['all', 'current', 'upcoming', 'evidence'] as const).map(value => <button role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)} className={tab === value ? 'active' : ''}>{value === 'all' ? '전체' : categoryLabel[value]}<span>{value === 'all' ? impacts.length : impacts.filter(item => item.category === value).length}</span></button>)}</div>
      <div className="table-tools"><div className="search-field"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label="조례 또는 사업 검색" placeholder="조례·사업명 검색" />{query && <button aria-label="검색 초기화" onClick={() => setQuery('')}><X size={14} /></button>}</div><label className="select-field"><SlidersHorizontal size={15} /><select value={department} onChange={e => setDepartment(e.target.value)} aria-label="담당 부서"><option value="all">모든 부서</option>{Array.from(new Set(impacts.map(item => item.department))).map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      <div className="table-scroll"><table className="impact-table"><thead><tr><th>조례·연결 사업</th><th>주요 변경</th><th>시행일</th><th>검토 구분</th><th><span className="sr-only">검토 열기</span></th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><Link className="case-title" to={'/impacts/' + item.id}>{item.service.replace('가상 ', '')}<ArrowUpRight size={14} /></Link><span className="table-sub">{item.department} · 안내자료 {item.documents}개</span><span className="mobile-date">시행 {item.effectiveDate}</span></td><td><span className="change-kind">{item.kind}</span><span className="inline-change"><span>{item.before}</span><ArrowRight size={13} /><strong>{item.after}</strong></span></td><td className="date-cell">{item.effectiveDate.replaceAll('-', '.')}</td><td>{states[item.id].status !== 'PROPOSED' ? <Badge tone={states[item.id].status === 'DISMISSED' ? 'neutral' : 'green'}>{statusLabel(states[item.id].status)}</Badge> : <CategoryBadge category={item.category} />}</td><td><Link to={'/impacts/' + item.id} className="row-open" aria-label={item.service + ' 검토 열기'}><ChevronRight size={18} /></Link></td></tr>)}</tbody></table></div>
      {filtered.length === 0 && <div className="empty-state"><Search size={28} /><h3>조건에 맞는 변경이 없습니다</h3><p>검색어 또는 담당 부서 조건을 바꿔 보세요.</p><button className="button" onClick={() => { setQuery(''); setDepartment('all'); setTab('all') }}>필터 초기화</button></div>}
      <div className="table-foot"><span>총 {impacts.length}건 중 {filtered.length}건 표시</span><span><ListFilter size={13} />시행일·적용 근거를 함께 검토합니다</span></div>
    </section>
    <aside className="review-guide"><div className="guide-heading"><Link2 size={17} /><h2>변경의 영향을 따라갑니다</h2></div><div className="trace-flow"><div><span className="trace-icon"><BookOpen size={18} /></span><span>조례 개정<strong>이전·개정 원문</strong></span></div><ArrowDown size={16} /><div><span className="trace-icon"><FolderCheck size={18} /></span><span>복지사업<strong>확인된 근거 연결</strong></span></div><ArrowDown size={16} /><div><span className="trace-icon"><FileText size={18} /></span><span>안내자료<strong>변경 내용 반영 여부</strong></span></div></div><p>조건이 달라졌어도 시행일과 부칙을 확인한 뒤 정정 여부를 결정합니다.</p><Link to="/impacts/OI-001" className="guide-cta">첫 번째 변경 검토하기<ArrowRight size={15} /></Link><div className="guide-tip"><Info size={16} /><span>정정안 승인과 실제 안내자료의 수정 확인은 별도 단계입니다.</span></div></aside></div>
    <div className="queue-bottom"><ShieldCheck size={17} /><span>AI의 제안은 검토를 돕습니다. 적용 판단과 정정 승인은 담당자가 결정합니다.</span><Badge>가상 A구</Badge></div>
  </>
}

type DetailProps = { states: Record<string, CaseState>; update: (id: string, patch: Partial<CaseState>) => void; showSource: (item: ImpactItem) => void; approve: (item: ImpactItem) => void; verify: (item: ImpactItem) => void; showDismiss: (item: ImpactItem) => void; record: (item: ImpactItem, title: string, detail: string) => void; notify: (text: string) => void }
function Detail(props: DetailProps) {
  const { id } = useParams()
  const item = impacts.find(value => value.id === id)
  const [detailTab, setDetailTab] = useState<'evidence' | 'draft'>('evidence')
  useEffect(() => setDetailTab('evidence'), [id])
  if (!item) return <div className="empty-state"><h1>검토 건을 찾을 수 없습니다</h1><Link to="/impacts" className="button">목록으로</Link></div>
  const state = props.states[item.id]
  const blocked = approvalBlockReason(item, state.status, state.draft, state.confirmed)
  const verifyBlocked = verifyBlockReason(state.status, state.reflected)
  const completed = state.status === 'VERIFIED'
  return <>
    <Link to="/impacts" className="back-link"><ArrowLeft size={15} />변경 검토 목록</Link>
    <div className="detail-heading"><div className="detail-eyebrow"><span>{item.id}</span><CategoryBadge category={item.category} /><span>{item.department}</span></div><h1>{item.service.replace('가상 ', '')}</h1><p>{item.title} <Badge>가상 예시</Badge></p><div className="detail-status"><Badge tone={state.status === 'PROPOSED' ? 'blue' : 'green'}>{statusLabel(state.status)}</Badge><span>분석 회차 1</span></div></div>
    <div className="change-summary"><div className="change-summary-icon"><FileDiff size={23} strokeWidth={1.6} /></div><div><span>{item.kind} 변경</span><h2><span>{item.before}</span><ArrowRight size={22} /><strong>{item.after}</strong></h2></div><p>{item.deltaSummary}</p><button className="text-button" onClick={() => props.showSource(item)}>변경 근거 보기<ArrowUpRight size={15} /></button></div>
    <section className={'applicability-panel ' + (item.category === 'evidence' ? 'needs-evidence' : '')} aria-label="적용 시점">
      <div className="applicability-title">{item.category === 'evidence' ? <TriangleAlert size={18} /> : item.category === 'upcoming' ? <Clock3 size={18} /> : <CheckCircle2 size={18} />}<strong>{item.category === 'current' ? '현재 적용 여부 확인됨' : item.category === 'upcoming' ? '시행 예정인 변경입니다' : '적용 근거를 더 확인해야 합니다'}</strong></div><div className="date-grid"><div><span>공포일</span><strong>{item.promulgatedDate}</strong></div><div><span>시행일</span><strong>{item.effectiveDate}</strong></div><div><span>판단 기준일</span><strong>{DEMO_DATE}</strong></div><div><span>사업 연결</span><strong>{item.linkConfirmed ? '확인됨' : '확인 필요'}</strong></div></div><p>{item.applicability}</p>
    </section>
    <div className="detail-tabs" role="tablist" aria-label="검토 내용"><button role="tab" aria-selected={detailTab === 'evidence'} className={detailTab === 'evidence' ? 'active' : ''} onClick={() => setDetailTab('evidence')}><BookOpen size={16} />근거 비교</button><button role="tab" aria-selected={detailTab === 'draft'} className={detailTab === 'draft' ? 'active' : ''} onClick={() => setDetailTab('draft')}><FileCheck2 size={16} />정정안 검토</button><span>원문 인용과 적용 시점을 함께 확인하세요</span></div>
    {detailTab === 'evidence' ? <section className="comparison-grid" aria-label="조례 전후와 안내자료 비교">
      {[{ label: '개정 전 조례', tag: '이전 기준', text: item.oldText, value: item.before, style: 'old', title: item.article }, { label: '개정 후 조례', tag: '개정 기준', text: item.newText, value: item.after, style: 'new', title: item.article }, { label: '현재 안내자료', tag: '비교 대상', text: item.guidanceText, value: item.before, style: item.category === 'upcoming' ? 'neutral-value' : 'warning', title: '사업 안내 · 신청 및 지원' }].map(column => <article className={'evidence-card ' + column.style} key={column.label}><div className="evidence-head"><h3>{column.label}</h3><span>{column.tag}</span></div><div className="evidence-body"><div className="doc-icon"><FileText size={17} />가상 원문</div><h4>{column.title}</h4><p><MarkedText text={column.text} value={column.value} variant={column.style} /></p>{column.label === '현재 안내자료' && <div className="mismatch-note"><Info size={14} />{item.category === 'upcoming' ? '시행 전 기준으로 안내 중입니다' : item.category === 'evidence' ? '적용 여부를 먼저 확인해야 합니다' : '개정 내용과 다른 표현이 있습니다'}</div>}</div><button className="evidence-foot" onClick={() => props.showSource(item)}><span>원문과 부칙 보기</span><ArrowUpRight size={14} /></button></article>)}
    </section> : <section className="draft-panel"><div className="section-heading"><div><Badge tone="blue">가상 정정 초안</Badge><h2>안내문을 이렇게 정정할 수 있습니다</h2></div><FileCheck2 size={24} strokeWidth={1.5} /></div><label className="field-label" htmlFor="draft-text">정정할 안내 문구</label><textarea id="draft-text" rows={5} value={state.draft} readOnly={state.status !== 'PROPOSED'} onChange={e => props.update(item.id, { draft: e.target.value, confirmed: false })} /><div className="draft-evidence"><Link2 size={15} /><span>근거: 개정 후 {item.article} · 변경 값 <strong>{item.after}</strong></span><button className="text-button" onClick={() => props.showSource(item)}>인용 확인</button></div><div className="draft-help-row"><p className="field-help">문구를 편집하면 추가 근거 검토가 필요합니다. 화면 시연에서는 예시 초안으로 승인 흐름을 확인할 수 있습니다.</p>{state.status === 'PROPOSED' && <button className="text-button" onClick={() => props.update(item.id, { draft: item.draft, confirmed: false })}>예시 초안 복원</button>}</div></section>}
    <div className="review-action-panel">
      {state.status === 'PROPOSED' && <>{detailTab === 'draft' ? <div className="review-check"><label><input type="checkbox" checked={state.confirmed} onChange={e => props.update(item.id, { confirmed: e.target.checked })} /><span>변경 근거와 적용 시점, 정정 초안을 확인했습니다.</span></label><p>{blocked ?? '필수 확인을 마쳤습니다. 승인 기록을 남길 수 있습니다.'}</p></div> : <div className="review-check"><strong className="review-step-label">근거 비교 후, 정정 초안을 검토하세요.</strong><p className="review-step-help">초안의 문구와 적용 대상을 확인한 뒤 승인할 수 있습니다.</p></div>}<div className="review-buttons">{item.category === 'current' && <button className="button" onClick={() => props.showDismiss(item)}>검토 제외</button>}{detailTab === 'evidence' ? <button className="button primary" onClick={() => setDetailTab('draft')}>정정 초안 보기<ArrowRight size={15} /></button> : <button className="button primary" disabled={blocked !== null} onClick={() => props.approve(item)}><Check size={16} />정정안 승인</button>}</div></>}
      {state.status === 'APPROVED' && <div className="approved-workflow"><div className="approved-heading"><CheckCircle2 size={22} /><div><h2>정정안을 승인했습니다</h2><p>승인은 안내문이 수정되었다는 뜻이 아닙니다. 후속 자료를 별도로 확인하세요.</p></div></div><div className="verification-demo"><Badge>가상 후속 안내문</Badge><p>{state.draft}</p><label><input type="checkbox" checked={state.reflected} onChange={e => props.update(item.id, { reflected: e.target.checked })} />승인 내용이 반영되고 다른 적용 근거는 바뀌지 않은 가상 결과를 확인했습니다.</label><p className="field-help">{verifyBlocked ?? '수정 확인 기록을 남길 수 있습니다.'}</p><button className="button primary" disabled={verifyBlocked !== null} onClick={() => props.verify(item)}><CheckCheck size={17} />수정 확인</button></div></div>}
      {completed && <div className="completion-message"><CheckCheck size={28} /><div><h2>수정 확인을 마쳤습니다</h2><p>가상 정정안 승인과 후속 안내자료 확인을 각각 기록했습니다.</p></div><Link to="/history" className="button">검토 이력 보기<ArrowRight size={15} /></Link></div>}
      {state.status === 'DISMISSED' && <div className="completion-message"><FolderCheck size={25} /><div><h2>검토 제외 사유를 기록했습니다</h2><p>제외 근거는 검토 이력에서 확인할 수 있습니다.</p></div><Link to="/history" className="button">검토 이력 보기</Link></div>}
    </div>
    {item.category === 'evidence' && state.status === 'PROPOSED' && <div className="callout amber"><TriangleAlert size={18} /><div><strong>{item.blockReason}</strong><p>확인할 항목을 기록하고 필요한 근거를 확보한 뒤 다시 검토하세요.</p></div><button className="button" onClick={() => { props.record(item, '가상 근거 확인 항목 기록', item.blockReason ?? item.applicability); props.notify('확인할 항목을 검토 이력에 기록했습니다.') }}>확인 항목 기록</button></div>}
  </>
}

function LinksPage({ showSource }: { showSource: (item: ImpactItem) => void }) {
  return <><PageHeading title="사업·안내자료 연결" description="조례의 개정 영향을 추적할 수 있도록 연결 근거를 확인합니다." /><div className="section-note"><Link2 size={18} /><span>조례명만 같아도 같은 근거로 연결하지 않습니다. 관할과 사업의 근거 문구를 함께 확인합니다.</span></div><div className="connection-list">{impacts.map(item => <article className="connection-row" key={item.id}><div className="connection-source"><BookOpen size={20} /><div><span>가상 A구 조례</span><strong>{item.title}</strong></div></div><ArrowRight className="connection-arrow" size={18} /><div className="connection-target"><FolderCheck size={19} /><div><span>복지사업 · 안내자료 {item.documents}개</span><strong>{item.service}</strong></div></div><Badge tone={item.linkConfirmed ? 'green' : 'amber'}>{item.linkConfirmed ? '연결 확인됨' : '연결 확인 필요'}</Badge><button className="button small" onClick={() => showSource(item)}>근거 보기</button><Link to={'/impacts/' + item.id} className="icon-button" aria-label={item.service + ' 검토 열기'}><ArrowUpRight size={18} /></Link></article>)}</div><p className="under-note">연결 정보 역시 가상 예시입니다. 실제 API의 조례 ID 자동 연결을 검증한 자료가 아닙니다.</p></>
}
function SourcesPage({ notify }: { notify: (text: string) => void }) {
  const total = impacts.reduce((sum, item) => sum + item.documents, 0)
  return <><PageHeading title="출처·수집 범위" description="확인한 자료와 수집하지 못한 자료를 구분해 검토 범위를 파악합니다." /><div className="callout amber"><TriangleAlert size={19} /><div><strong>가상 안내자료 1건이 수집 실패 상태입니다.</strong><p>검사하지 못한 자료를 영향 없음으로 처리하지 않습니다.</p></div></div><section className="source-list"><article><span className="source-icon"><BookOpen size={22} /></span><div className="source-info"><h2>조례 이전·개정 원문</h2><p>가상 A구 · 조문 및 부칙 예시</p><span>기준일 {DEMO_DATE} · 화면 시연용 등록 자료</span></div><div className="source-count"><strong>6<small>쌍</small></strong><Badge tone="green">예시 등록</Badge></div></article><article><span className="source-icon"><FolderCheck size={22} /></span><div className="source-info"><h2>복지사업 설명과 근거</h2><p>가상 사업 6개 · 연결 확인 필요 1건</p><span>서비스 설명 · 신청방법 · 근거 문구</span></div><div className="source-count"><strong>6<small>개</small></strong><Badge tone="amber">연결 확인 1건</Badge></div></article><article><span className="source-icon"><FileText size={22} /></span><div className="source-info"><h2>사업 안내자료</h2><p>등록 {total}개 · 예시 확인 {total - 1}개 · 실패 1개</p><span>가상 웹 안내 · 신청 안내문</span></div><div className="source-count"><strong>{total - 1}<small>/{total}</small></strong><Badge tone="amber">일부 실패</Badge></div></article></section><div className="failure-row"><TriangleAlert size={18} /><div><strong>가상 출산축하금 안내 첨부자료</strong><p>예시 실패 사유: 원문 연결 응답 없음. 기존 근거만으로 전체 검사를 완료했다고 표시하지 않습니다.</p></div><button className="button" onClick={() => notify('실제 수집은 연동 전입니다. 이 화면에서는 가상 실패 자료와 영향 범위를 확인할 수 있습니다.')}>실패 상세 확인</button></div><div className="source-explainer"><ShieldCheck size={22} /><div><h2>원문과 판단의 시점을 남깁니다</h2><p>실제 연동 시 원문 URL, 수집 시각, 버전과 인용을 보존합니다. 현재 화면의 등록·실패 건수는 실제 수집 결과가 아닌 가상 시나리오입니다.</p></div></div></>
}
function HistoryPage({ audit }: { audit: Audit[] }) {
  return <><PageHeading title="검토 이력" description="어떤 근거를 확인하고 어떤 결정을 남겼는지 살펴봅니다." /><div className="history-notice"><History size={17} />이번 화면 시연에서 남긴 기록입니다. 새로고침하면 초기화됩니다.</div><section className="history-list">{audit.map(event => <article key={event.id}><div className="history-time"><span>{DEMO_DATE}</span><strong>{event.at}</strong></div><span className="history-dot"><Check size={13} /></span><div className="history-content"><h2>{event.title}</h2><p>{event.detail}</p><Link to={'/impacts/' + event.itemId}>{event.itemId} 검토 열기<ArrowUpRight size={13} /></Link></div><Badge>시연 검토자</Badge></article>)}</section></>
}

export default function App() { return <BrowserRouter><AppShell /></BrowserRouter> }
