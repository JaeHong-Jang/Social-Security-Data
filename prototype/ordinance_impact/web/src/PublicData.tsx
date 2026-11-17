import { useEffect, useState, type ReactNode } from 'react'
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Database, FileText, Info, RefreshCw, Search, ShieldCheck, TriangleAlert } from 'lucide-react'
import { documentKind, observedAt, publicUrl, readPublicData, sourceStatus, type PublicCatalog, type PublicDocument, type PublicSnapshot, type PublicSource, type PublicStatistic, type ServiceDetail, type ServicePage } from './publicData.ts'
import './public-data.css'

type Remote<T> = { data: T | null; error: string; loading: boolean; retry: () => void }
function usePublicData<T>(path: string | null): Remote<T> {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Omit<Remote<T>, 'retry'>>({ data: null, error: '', loading: !!path })
  useEffect(() => {
    if (!path) { setState({ data: null, error: '', loading: false }); return }
    const controller = new AbortController()
    setState({ data: null, error: '', loading: true })
    readPublicData<T>(path, controller.signal).then(data => setState({ data, error: '', loading: false })).catch(error => {
      if (!controller.signal.aborted) setState({ data: null, error: error instanceof Error && error.message !== 'Failed to fetch' ? error.message : '자료 서버에 연결하지 못했습니다.', loading: false })
    })
    return () => controller.abort()
  }, [path, attempt])
  return { ...state, retry: () => setAttempt(value => value + 1) }
}
function External({ url, children }: { url?: string | null; children: ReactNode }) {
  const safeUrl = publicUrl(url)
  return safeUrl ? <a className="public-external" href={safeUrl} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (새 창)</span></a> : <span className="public-muted">출처 URL 미확보</span>
}
function DataStatus({ remote, children }: { remote: Remote<unknown>; children: ReactNode }) {
  if (remote.loading) return <div className="public-state" role="status"><RefreshCw size={22} /><p>보존된 실제 자료를 불러오고 있습니다.</p></div>
  if (remote.error) return <div className="public-state public-error" role="alert"><TriangleAlert size={26} /><h2>자료를 불러오지 못했습니다</h2><p>{remote.error}</p><p>자료 서버 연결과 수집 상태를 확인한 뒤 다시 시도하세요.</p><button className="button" onClick={remote.retry}><RefreshCw size={15} />다시 시도</button></div>
  return <>{children}</>
}
function Empty({ title, text }: { title: string; text: string }) {
  return <div className="public-state"><Database size={27} /><h2>{title}</h2><p>{text}</p></div>
}
function SourceBadge({ source }: { source: PublicSource }) {
  const status = sourceStatus[source.status]
  return <span className={'badge ' + status.tone}>{status.label}</span>
}
function SnapshotEvidence({ id }: { id: string | null }) {
  const remote = usePublicData<PublicSnapshot>(id ? '/snapshots/' + encodeURIComponent(id) : null)
  if (!id) return <p className="public-note"><TriangleAlert size={16} />이 자료의 원문 스냅샷은 확보되지 않았습니다.</p>
  return <section className="public-panel public-snapshot" aria-label="보존 자료 확인"><h2><ShieldCheck size={19} />보존 자료 확인</h2><DataStatus remote={remote}>{remote.data && <>
    <p>보존한 자료와 추출문을 각각 고정 해시로 식별합니다. 추출 시각은 원수집일과 다릅니다.</p>
    <dl className="public-metadata"><div><dt>원수집일</dt><dd>{observedAt(remote.data.fetchedAt)}</dd></div><div><dt>텍스트 추출일</dt><dd>{observedAt(remote.data.extractedAt)}</dd></div><div><dt>보존본 SHA-256</dt><dd><code data-testid="raw-hash">{remote.data.rawSha256}</code></dd></div><div><dt>추출문 SHA-256</dt><dd><code>{remote.data.textSha256}</code></dd></div><div><dt>보존 형식</dt><dd>{remote.data.contentType} · 보존본 {remote.data.rawBytes.toLocaleString()} bytes</dd></div><div><dt>출처</dt><dd><External url={remote.data.sourceUrl}>공식 출처 열기</External></dd></div></dl>
    <details><summary>보존한 추출문 확인</summary><pre className="public-raw-text" tabIndex={0} aria-label="보존한 추출문">{remote.data.text || '추출한 텍스트가 없습니다.'}</pre></details>
  </>}</DataStatus></section>
}
function DocumentList({ documents, serviceId }: { documents: PublicDocument[]; serviceId?: string }) {
  if (!documents.length) return <Empty title="확보한 관련 원문이 없습니다" text="사업의 근거법령 문구와 연결할 법규·안내문 원문을 아직 확보하지 못했습니다." />
  return <div className="public-document-list">{documents.map(document => <article key={document.id}>
    <div className="public-row-heading"><span className="badge">{documentKind[document.kind]}</span><span className="public-muted">{document.jurisdiction || '관할 미확인'}</span></div>
    <Link to={'/data/documents/' + encodeURIComponent(document.id)} className="public-item-title">{document.title}<ArrowUpRight size={15} /></Link>
    <p className="public-muted">{document.version?.promulgatedDate ? '공포 ' + document.version.promulgatedDate + ' · ' : ''}{document.version?.effectiveDate ? '시행 ' + document.version.effectiveDate + ' · ' : ''}원수집일 {observedAt(document.fetchedAt)}</p><div className="public-row-heading"><span className="badge amber">연결 후보 · 미확정</span><span className="public-muted">{document.historyStatus === 'paired' ? '동일 법규의 연혁쌍 확보' : document.kind === 'guidance' ? '안내문 이전 버전 미확보' : '이전·개정 연혁쌍 미확보'}</span></div>
    {document.historyStatus === 'paired' && !!document.pairedDocumentIds?.length && <Link className="public-compare-link" to={'/data/compare/' + encodeURIComponent(document.id) + (serviceId ? '?service=' + encodeURIComponent(serviceId) : '')}>연혁 원문 나란히 보기<ChevronRight size={15} /></Link>}
  </article>)}</div>
}
function ServiceDetailPage() {
  const { id } = useParams()
  const remote = usePublicData<ServiceDetail>(id ? '/services/' + encodeURIComponent(id) : null)
  const service = remote.data
  return <div className="public-data"><Link className="back-link" to="/data"><ArrowLeft size={15} />실제 복지사업 목록</Link><DataStatus remote={remote}>{service && <>
    <div className="public-detail-heading"><span className="badge blue">실제 공개 자료 · 읽기 전용</span><h1>{service.name}</h1><p>{service.kind === 'local' ? '지자체 사업' : '중앙부처 사업'} · {service.region || '지역 미확인'} · {service.department || '담당 부서 미확인'}</p></div>
    <div className="public-note"><Info size={17} /><p>사업·법규 연결은 검토 후보입니다. 확보한 원문만으로 적용 관계나 안내 오류가 확정되지 않습니다.</p></div>
    <section className="public-panel"><div className="public-section-heading"><h2>사업 설명</h2><span className={'badge ' + (service.detailStatus === 'collected' ? 'green' : 'amber')}>{service.detailStatus === 'collected' ? '상세 확보' : service.detailStatus === 'error' ? '상세 수집 실패 · 목록만 확보' : '목록만 확보'}</span></div>
      <p className="public-body-copy">{service.summary || '사업 요약 미확보'}</p>
      {service.detailStatus !== 'collected' && <p className="public-warning">이 사업의 상세 내용은 확보되지 않았습니다. 목록 확보를 상세 수집 완료로 계산하지 않습니다.</p>}
      <dl className="public-service-fields">{[{ label: '지원 내용', value: service.support }, { label: '지원 대상', value: service.target }, { label: '선정 기준', value: service.criteria }, { label: '신청 방법', value: service.application }].map(field => <div key={field.label}><dt>{field.label}</dt><dd>{field.value || '상세 미확보'}</dd></div>)}</dl>
      {(service.serviceStartDate || service.serviceEndDate || service.modifiedAt) && <dl className="public-metadata"><div><dt>사업 운영 기간</dt><dd>{service.serviceStartDate || '시작일 미확인'} ~ {service.serviceEndDate || '종료일 미확인'}</dd></div><div><dt>제공기관 수정일</dt><dd>{service.modifiedAt || '미확인'} · 조례 시행일과 구분</dd></div></dl>}
      <div className="public-detail-links"><External url={service.homepageUrl}>사업 안내 페이지</External><External url={service.sourceUrl}>수집 출처</External><span>원수집일 {observedAt(service.fetchedAt)}</span></div>
    </section>
    {!!(service.attachments?.length || service.relatedLinks?.length) && <section className="public-panel"><h2>공식 첨부·관련 링크</h2><p>제공기관이 안내한 링크입니다. 링크 표시가 해당 첨부의 본문 수집 완료를 뜻하지 않습니다.</p>{service.attachments?.length ? <><h3>첨부 원문</h3><ul className="public-related">{service.attachments.map((attachment, index) => <li key={index}><External url={attachment.url}>{attachment.name || '첨부 원문'}</External></li>)}</ul></> : null}{service.relatedLinks?.length ? <><h3>관련 공식 링크</h3><ul className="public-related">{service.relatedLinks.map((link, index) => <li key={index}><External url={link.url}>{link.name || '관련 페이지'}</External></li>)}</ul></> : null}</section>}
    <section className="public-panel"><h2><BookOpen size={19} />사업 API의 근거법령 문구</h2><p>제공된 명칭·내용·코드를 보존합니다. 사업 상세 코드를 법규 ID로 해석하지 않습니다.</p>{service.legalBases?.length ? <ul className="public-bases">{service.legalBases.map((basis, index) => <li key={index}><h3>{basis.name || '근거 명칭 미확보'}</h3>{basis.content && <p>{basis.content}</p>}{basis.code && <span className="public-muted">제공 코드: {basis.code} · 법규 ID 확인 전</span>}</li>)}</ul> : <p className="public-warning">근거법령 문구를 확보하지 못했습니다.</p>}</section>
    <section className="public-panel"><h2><FileText size={19} />관련 법규·안내문 후보</h2><p>수집 문서와의 연결 후보이며 담당자가 확정한 법적 적용 관계가 아닙니다.</p><DocumentList documents={service.documents ?? []} serviceId={service.id} /></section>
    <SnapshotEvidence id={service.snapshotId} />
  </>}</DataStatus></div>
}
function DocumentDetailPage() {
  const { id } = useParams()
  const remote = usePublicData<PublicDocument>(id ? '/documents/' + encodeURIComponent(id) : null)
  const document = remote.data
  return <div className="public-data"><Link className="back-link" to="/data?view=documents"><ArrowLeft size={15} />법규·안내문 목록</Link><DataStatus remote={remote}>{document && <>
    <div className="public-detail-heading"><span className="badge">{documentKind[document.kind]}</span><h1>{document.title}</h1><p>{document.jurisdiction || '관할 미확인'} · 실제 공개 원문</p></div>
    <div className="public-note"><Info size={17} /><p>{document.historyStatus === 'paired' ? '동일 법규의 연혁쌍을 확보했습니다. 적용 시점과 사업 연결은 별도 검토가 필요합니다.' : document.kind === 'guidance' ? '이전 안내문 버전을 확보하지 못했습니다. 전후 변경 비교는 완료되지 않았습니다.' : '이전·개정 연혁쌍을 확보하지 못했습니다. 개정 전후 비교는 완료되지 않았습니다.'}</p></div>
    {document.representation === 'public-field-projection' && <section className="public-note"><Info size={17} /><div><p><strong>공개 안내 필드 추출본 · 원 HTML은 보존하지 않음</strong>수신한 안내 페이지에서 공개 사업 안내 필드만 보존했습니다. 아래 보존본 해시는 추출한 공개 필드 JSON의 해시입니다.</p>{document.responseSha256 && <p className="public-response-hash">수신 HTML SHA-256 <code>{document.responseSha256}</code></p>}</div></section>}
    <section className="public-panel"><h2>문서 시점과 출처</h2><dl className="public-metadata"><div><dt>공포일</dt><dd>{document.version?.promulgatedDate || '미확인'}</dd></div><div><dt>시행일</dt><dd>{document.version?.effectiveDate || '미확인'}</dd></div><div><dt>원수집일</dt><dd>{observedAt(document.fetchedAt)}</dd></div><div><dt>공식 원문</dt><dd><External url={document.sourceUrl}>출처에서 원문 확인</External></dd></div></dl></section>
    {document.historyStatus === 'paired' && !!document.pairedDocumentIds?.length && <Link className="button public-compare-link" to={'/data/compare/' + encodeURIComponent(document.id)}>연혁 원문 나란히 보기<ChevronRight size={16} /></Link>}
    <section className="public-panel"><h2>수집한 본문</h2><pre className="public-raw-text" tabIndex={0} aria-label="수집한 문서 본문">{document.text || '문서 본문을 확보하지 못했습니다.'}</pre></section>
    <section className="public-panel"><h2>연결 사업 후보</h2><p>연결 후보 · 적용 관계 미확정</p>{document.relatedServiceIds?.length ? <ul className="public-related">{document.relatedServiceIds.map(serviceId => <li key={serviceId}><Link to={'/data/services/' + encodeURIComponent(serviceId)}>{serviceId} 사업 확인<ArrowUpRight size={14} /></Link></li>)}</ul> : <p className="public-warning">연결할 사업 후보가 없습니다.</p>}</section>
    <SnapshotEvidence id={document.snapshotId} />
  </>}</DataStatus></div>
}
function ComparisonDocument({ document, label }: { document: PublicDocument; label: string }) {
  return <article className="public-comparison-document"><div className="public-comparison-label">{label}</div><div className="public-comparison-content"><h2>{document.title}</h2><dl className="public-metadata"><div><dt>공포일</dt><dd>{document.version?.promulgatedDate || '미확인'}</dd></div><div><dt>시행일</dt><dd>{document.version?.effectiveDate || '미확인'}</dd></div><div><dt>원수집일</dt><dd>{observedAt(document.fetchedAt)}</dd></div></dl>{document.representation === 'public-field-projection' && <p className="public-warning">공개 안내 필드 추출본 · 원 HTML은 보존하지 않음</p>}<pre className="public-raw-text" tabIndex={0} aria-label={label + ' 본문'}>{document.text || '문서 본문 미확보'}</pre><div className="public-detail-links"><External url={document.sourceUrl}>공식 출처 확인</External><Link to={'/data/documents/' + encodeURIComponent(document.id)}>문서 상세·수신본 정보</Link></div><SnapshotEvidence id={document.snapshotId} /></div></article>
}
function DocumentComparisonPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const primary = usePublicData<PublicDocument>(id ? '/documents/' + encodeURIComponent(id) : null)
  const pairedId = primary.data?.historyStatus === 'paired' ? primary.data.pairedDocumentIds?.[0] : null
  const secondary = usePublicData<PublicDocument>(pairedId ? '/documents/' + encodeURIComponent(pairedId) : null)
  const catalog = usePublicData<PublicCatalog>('/catalog')
  const document = primary.data, pair = secondary.data
  const pairConfirmed = !!(document && pair && document.legalInstrumentId && document.legalInstrumentId === pair.legalInstrumentId && pair.historyStatus === 'paired' && pair.pairedDocumentIds?.includes(document.id) && document.versionRole && pair.versionRole && document.versionRole !== pair.versionRole)
  const before = document?.versionRole === 'before' ? document : pair
  const after = document?.versionRole === 'after' ? document : pair
  const selectedService = params.get('service')
  const serviceIds = selectedService && document?.relatedServiceIds.includes(selectedService) ? [selectedService] : document?.relatedServiceIds ?? []
  const guidance = catalog.data?.documents.filter(item => item.kind === 'guidance' && item.relatedServiceIds.some(serviceId => serviceIds.includes(serviceId))) ?? []
  return <div className="public-data public-comparison-page"><Link className="back-link" to={selectedService ? '/data/services/' + encodeURIComponent(selectedService) : '/data?view=documents'}><ArrowLeft size={15} />{selectedService ? '복지사업 상세' : '법규·안내문 목록'}</Link><div className="public-detail-heading"><span className="badge blue">실제 보존 자료 · 읽기 전용</span><h1>연혁 원문과 현재 안내</h1><p>수집 과정에서 동일 법규로 확인한 전후 버전과 사업 안내문 후보를 함께 읽습니다.</p></div><div className="public-note"><Info size={18} /><p><strong>원문 열람 단계입니다.</strong>AI 변경 분석이나 현재 안내의 오류 판단을 수행하지 않았습니다. 사업 연결과 적용 시점은 담당자의 별도 검토가 필요합니다.</p></div><DataStatus remote={primary}>{document && (!pairedId ? <Empty title="비교할 연혁쌍이 없습니다" text="동일 법규로 확인한 이전·개정 원문을 아직 확보하지 못했습니다." /> : <DataStatus remote={secondary}>{pair && (pairConfirmed && before && after ? <><div className="public-comparison-grid"><ComparisonDocument document={before} label="이전 법규 원문" /><ComparisonDocument document={after} label="개정 법규 원문" /><section className="public-comparison-guidance" aria-label="현재 사업 안내문 후보"><div className="public-comparison-label">현재 사업 안내문 후보 · 연결 미확정</div><DataStatus remote={catalog}>{guidance.length ? guidance.map(item => <ComparisonDocument key={item.id} document={item} label="수집한 사업 안내" />) : <Empty title="관련 안내문 미확보" text="이 법규와 연결된 사업의 공개 안내문 후보를 확보하지 못했습니다." />}</DataStatus></section></div>{document.historySnapshotId && <section className="public-panel"><h2>동일 법규의 연혁 확인 자료</h2><p>제공기관의 연혁 원문을 보존한 자료입니다. 법규명 유사도로 전후 관계를 추정하지 않습니다.</p><SnapshotEvidence id={document.historySnapshotId} /></section>}</> : <Empty title="연혁 연결 정보를 확인할 수 없습니다" text="동일 법규 식별자와 서로 연결된 전후 버전이 확인되어야 원문을 나란히 표시합니다." />)}</DataStatus>)}</DataStatus></div>
}
function Sources({ sources }: { sources: PublicSource[] }) {
  return <section aria-label="실제 출처와 수집 상태"><div className="public-section-heading"><h2>출처·수집 상태</h2></div><p className="public-section-description">실수집, 보존 자료 수입, 일부 확보, 수집 제한, 인증 미설정을 구분합니다. 원수집일 미확인은 수입일로 대체하지 않습니다.</p>{sources.length ? <div className="public-source-list">{sources.map(source => <article key={source.id}><div className="public-section-heading"><div><h3>{source.name}</h3><p>{source.provider}</p></div><SourceBadge source={source} /></div><p className="public-source-message">{source.message || '추가 수집 설명 없음'}</p><dl className="public-metadata"><div><dt>확보 범위</dt><dd>{source.recordCount.toLocaleString()}건{source.totalCount != null ? ' / 제공 목록 ' + source.totalCount.toLocaleString() + '건' : ' · 제공 전체 건수 미확인'}</dd></div><div><dt>원수집일</dt><dd>{observedAt(source.fetchedAt)}</dd></div><div><dt>최근 시도</dt><dd>{source.lastAttemptAt ? observedAt(source.lastAttemptAt) : '시도 기록 없음'}</dd></div></dl><External url={source.homepageUrl}>공식 제공 페이지</External></article>)}</div> : <Empty title="등록한 출처가 없습니다" text="자료를 수집하면 성공·실패 범위와 원수집일을 이곳에 표시합니다." />}</section>
}
function Statistics({ statistics }: { statistics: PublicStatistic[] }) {
  return <section aria-label="사회보장 참고 통계"><h2>사회보장 참고 통계</h2><p className="public-section-description">지역·사업 분포를 이해하는 참고 자료입니다. 특정 사업 안내의 오류나 조례 적용 관계를 입증하는 근거가 아닙니다.</p>{statistics.length ? statistics.map(statistic => <article className="public-panel" key={statistic.id}><div className="public-section-heading"><div><h3>{statistic.title}</h3><p>{statistic.provider} · {statistic.recordCount.toLocaleString()}행</p></div><span className="badge">참고 통계</span></div><p>{statistic.purpose}</p><p className="public-muted">자료 범위: {statistic.scope || '미확인'} · 원수집일 {observedAt(statistic.fetchedAt)}</p><External url={statistic.sourceUrl}>통계 제공 출처</External><div className="public-table-wrap"><table className="public-stat-table"><caption>확보한 통계 미리보기 · 최대 10행</caption><thead><tr>{statistic.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{statistic.previewRows.slice(0, 10).map((row, index) => <tr key={index}>{statistic.columns.map((column, columnIndex) => <td key={column}>{String((Array.isArray(row) ? row[columnIndex] : row[column]) ?? '—')}</td>)}</tr>)}</tbody></table></div><SnapshotEvidence id={statistic.snapshotId} /></article>) : <Empty title="확보한 통계가 없습니다" text="등록된 실제 통계가 있을 때 미리보기를 표시합니다." />}</section>
}
function Services({ summary, sources }: { summary: PublicCatalog['summary']; sources: PublicSource[] }) {
  const [params, setParams] = useSearchParams()
  const query = params.get('query') ?? ''
  const kind = ['local', 'central'].includes(params.get('kind') ?? '') ? params.get('kind')! : 'all'
  const region = params.get('region') ?? ''
  const legalOnly = params.get('legalOnly') === 'true'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [queryDraft, setQueryDraft] = useState(query)
  const [regionDraft, setRegionDraft] = useState(region)
  const [kindDraft, setKindDraft] = useState(kind)
  const [legalDraft, setLegalDraft] = useState(legalOnly)
  useEffect(() => { setQueryDraft(query); setRegionDraft(region); setKindDraft(kind); setLegalDraft(legalOnly) }, [query, region, kind, legalOnly])
  const search = new URLSearchParams({ query, kind, region, legalOnly: String(legalOnly), page: String(page), pageSize: '20' })
  const remote = usePublicData<ServicePage>('/services?' + search.toString())
  const result = remote.data
  const changePage = (nextPage: number) => { const next = new URLSearchParams(params); next.set('page', String(nextPage)); setParams(next) }
  return <section aria-label="실제 복지사업"><div className="public-section-heading"><h2>복지사업 탐색</h2><span className="public-muted">목록 {summary.services.toLocaleString()}건 · 상세 {summary.detailedServices.toLocaleString()}건</span></div>
    <form className="public-filters" onSubmit={event => { event.preventDefault(); const next = new URLSearchParams({ query: queryDraft.trim(), kind: kindDraft, region: regionDraft.trim(), legalOnly: String(legalDraft) }); setParams(next) }}>
      <label className="public-search-label">사업·지역·근거법령 검색<div><Search size={16} aria-hidden="true" /><input name="query" value={queryDraft} onChange={event => setQueryDraft(event.target.value)} placeholder="사업명 또는 근거법령" /></div></label>
      <label>사업 유형<select value={kindDraft} onChange={event => setKindDraft(event.target.value)}><option value="all">모든 유형</option><option value="local">지자체</option><option value="central">중앙부처</option></select></label>
      <label>지역<input name="region" value={regionDraft} onChange={event => setRegionDraft(event.target.value)} placeholder="예: 서울" /></label>
      <label className="public-checkbox"><input type="checkbox" checked={legalDraft} onChange={event => setLegalDraft(event.target.checked)} />근거 문구 보유</label><button className="button primary" type="submit">검색</button>
      {(query || region || kind !== 'all' || legalOnly) && <button className="text-button" type="button" onClick={() => setParams({})}>필터 초기화</button>}
    </form>
    <DataStatus remote={remote}>{result && <>
      <p className="public-result-count" role="status">검색 결과 {result.total.toLocaleString()}건 · {result.page}페이지</p>
      {result.items.length ? <div className="public-service-list">{result.items.map(service => <article key={service.id}><div className="public-service-name"><div className="public-row-heading"><span className="badge">{service.kind === 'local' ? '지자체' : '중앙부처'}</span><span>{service.region || '지역 미확인'}</span></div><Link className="public-item-title" to={'/data/services/' + encodeURIComponent(service.id)}>{service.name}<ArrowUpRight size={15} /></Link><p className="public-muted">{service.department || '담당 부서 미확인'}</p></div><div className="public-service-summary"><p>{service.summary || '요약 미확보 · 상세에서 수집 범위를 확인하세요.'}</p><span className={'badge ' + (service.detailStatus === 'collected' ? 'green' : 'amber')}>{service.detailStatus === 'collected' ? '상세 확보' : service.detailStatus === 'error' ? '상세 수집 실패' : '목록만 확보'}</span><span className="public-muted">근거 문구 {service.legalBases?.length ?? 0}건</span></div><div className="public-service-provenance"><p>{sources.find(source => source.id === service.sourceId)?.name || '출처 정보 미확인'}</p><span>원수집일 {observedAt(service.fetchedAt)}</span></div></article>)}</div> : <Empty title={summary.services ? '조건에 맞는 사업이 없습니다' : '확보한 복지사업이 없습니다'} text={summary.services ? '검색어나 유형·지역·근거 문구 조건을 바꿔 보세요.' : '출처·수집 상태에서 등록 범위와 수집 제한을 확인하세요.'} />}
      <div className="public-pagination" aria-label="사업 목록 페이지"><button className="button" disabled={page <= 1} onClick={() => changePage(page - 1)}><ChevronLeft size={16} />이전</button><span>{result.page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 페이지</span><button className="button" disabled={result.page * result.pageSize >= result.total} onClick={() => changePage(page + 1)}>다음<ChevronRight size={16} /></button></div>
    </>}</DataStatus>
  </section>
}
function CatalogPage() {
  const catalog = usePublicData<PublicCatalog>('/catalog')
  const [params, setParams] = useSearchParams()
  const view = params.get('view') ?? 'services'
  const [documentQuery, setDocumentQuery] = useState('')
  const [kind, setKind] = useState('all')
  const data = catalog.data
  const documents = data?.documents.filter(document => (kind === 'all' || (kind === 'statute' ? document.kind !== 'guidance' : document.kind === kind)) && (document.title + ' ' + document.jurisdiction + ' ' + document.text).includes(documentQuery.trim())) ?? []
  return <div className="public-data"><div className="page-heading"><div><h1>실제 공공데이터</h1><p>복지사업과 근거 원문, 공개 안내문, 사회보장 통계를 출처와 함께 확인합니다.</p></div><button className="button" onClick={catalog.retry}><RefreshCw size={15} />자료 새로고침</button></div>
    <div className="public-note"><ShieldCheck size={18} /><p><strong>실제 공개 자료 · 읽기 전용</strong> 수집한 범위를 보여줍니다. AI 영향 분석과 업무 승인에는 연결하지 않았습니다.</p></div>
    <DataStatus remote={catalog}>{data && <>
      <div className="public-summary" aria-label="자료 확보 요약"><div><span>복지사업 목록</span><strong>{data.summary.services.toLocaleString()}<small>건</small></strong><p>지자체 {data.summary.localServices.toLocaleString()} · 중앙 {data.summary.centralServices.toLocaleString()}</p></div><div><span>사업 상세 확보</span><strong>{data.summary.detailedServices.toLocaleString()}<small>건</small></strong><p>목록만 확보한 사업과 구분</p></div><div><span>근거법령 문구</span><strong>{data.summary.legalBases.toLocaleString()}<small>건</small></strong><p>법규 연결 확정 전</p></div><div><span>원문 / 참고 통계</span><strong>{data.summary.documents.toLocaleString()}<small> / {data.summary.statistics.toLocaleString()}</small></strong><p>이전·개정 연혁 확보는 별도</p></div></div>
      <p className="public-catalog-time">목록 구성일 {data.generatedAt ? observedAt(data.generatedAt) : '미확인'} · 각 자료의 원수집일과 구분합니다.</p>
      <nav className="public-tabs" aria-label="실제 자료 분류">{[{ id: 'services', label: '복지사업' }, { id: 'documents', label: '법규·안내문' }, { id: 'statistics', label: '참고 통계' }, { id: 'sources', label: '출처·수집 상태' }].map(tab => <button key={tab.id} aria-current={view === tab.id ? 'page' : undefined} onClick={() => setParams(tab.id === 'services' ? {} : { view: tab.id })}>{tab.label}</button>)}</nav>
      {view === 'documents' ? <section aria-label="실제 법규와 안내문"><h2>법규·안내문</h2><p className="public-section-description">사업 연결은 후보이며 미확정입니다. 연혁쌍이 없으면 변경 비교를 완료한 것으로 표시하지 않습니다.</p><div className="public-document-filters"><label>문서 검색<input value={documentQuery} onChange={event => setDocumentQuery(event.target.value)} placeholder="문서명·관할·본문" /></label><label>문서 유형<select value={kind} onChange={event => setKind(event.target.value)}><option value="all">전체 문서</option><option value="statute">법규 (조례·법령)</option><option value="guidance">사업 안내문</option></select></label></div><p className="public-result-count">확보 문서 {data.documents.length}건 중 {documents.length}건 표시</p><DocumentList documents={documents} /></section> : view === 'sources' ? <Sources sources={data.sources} /> : view === 'statistics' ? <Statistics statistics={data.statistics} /> : <Services summary={data.summary} sources={data.sources} />}
      <div className="public-boundary"><Info size={18} /><p>실제 수집 자료의 열람 화면입니다. 승인·수정 확인 흐름은 <Link to="/impacts">가상 검토 시연</Link>에서 별도로 살펴볼 수 있습니다.</p></div>
    </>}</DataStatus>
  </div>
}
export default function PublicData() {
  return <Routes><Route index element={<CatalogPage />} /><Route path="services/:id" element={<ServiceDetailPage />} /><Route path="documents/:id" element={<DocumentDetailPage />} /><Route path="compare/:id" element={<DocumentComparisonPage />} /><Route path="*" element={<Empty title="자료 경로를 찾을 수 없습니다" text="실제 공공데이터 목록에서 자료를 다시 선택하세요." />} /></Routes>
}
