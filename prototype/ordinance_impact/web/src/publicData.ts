export const PUBLIC_API = '/api/ordinance-impact'

export type SourceStatus = 'live' | 'cache' | 'partial' | 'blocked' | 'unconfigured'
export type PublicSource = {
  id: string; name: string; provider: string; kind: string; homepageUrl: string
  status: SourceStatus; fetchedAt: string | null; lastAttemptAt: string | null
  recordCount: number; totalCount: number | null; message: string; snapshotIds: string[]
}
export type PublicService = {
  id: string; kind: 'local' | 'central'; name: string; region: string; department: string
  summary: string; target: string; criteria: string; application: string
  support?: string; attachments?: { name: string; url: string }[]; relatedLinks?: { name: string; url: string }[]
  modifiedAt?: string | null; serviceStartDate?: string | null; serviceEndDate?: string | null
  legalBases: { name: string; content: string; code: string }[]
  homepageUrl: string; sourceUrl: string; fetchedAt: string | null
  sourceId: string; snapshotId: string | null; detailStatus: 'collected' | 'missing' | 'error'
}
export type PublicDocument = {
  id: string; kind: 'ordinance' | 'law' | 'guidance'; title: string; jurisdiction: string
  sourceUrl: string; fetchedAt: string | null; snapshotId: string | null; text: string
  relatedServiceIds: string[]; relationStatus: 'candidate'
  historyStatus: 'current-only' | 'paired' | 'missing'
  representation?: string; responseSha256?: string
  pairedDocumentIds?: string[]; legalInstrumentId?: string; versionRole?: 'before' | 'after'; historySnapshotId?: string
  version: { promulgatedDate: string | null; effectiveDate: string | null; ordinSeq: string | null }
}
export type PublicStatistic = {
  id: string; title: string; provider: string; sourceUrl: string; fetchedAt: string | null
  snapshotId: string | null; recordCount: number; columns: string[]
  previewRows: (Record<string, unknown> | unknown[])[]; purpose: string; scope: string
}
export type PublicCatalog = {
  schemaVersion: number; generatedAt: string | null; sources: PublicSource[]
  documents: PublicDocument[]; statistics: PublicStatistic[]
  summary: { services: number; localServices: number; centralServices: number; detailedServices: number; legalBases: number; documents: number; statistics: number }
}
export type ServicePage = { items: PublicService[]; total: number; page: number; pageSize: number }
export type ServiceDetail = PublicService & { documents: PublicDocument[] }
export type PublicSnapshot = {
  id: string; sourceId: string; sourceUrl: string; fetchedAt: string | null; extractedAt: string
  rawSha256: string; textSha256: string; rawBytes: number; textBytes: number
  contentType: string; parserVersion: string; text: string
}
export const sourceStatus: Record<SourceStatus, { label: string; tone: string }> = {
  live: { label: '실수집', tone: 'green' }, cache: { label: '보존 자료', tone: 'blue' },
  partial: { label: '일부 확보', tone: 'amber' }, blocked: { label: '수집 제한', tone: 'amber' },
  unconfigured: { label: '인증 미설정', tone: 'neutral' },
}
export const documentKind = { ordinance: '조례', law: '법령', guidance: '사업 안내문' }
export function observedAt(value: string | null | undefined) {
  if (!value) return '원수집일 미확인'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' KST'
}
export function publicUrl(value: string | null | undefined) {
  if (!value) return null
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
export async function readPublicData<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(PUBLIC_API + path, { headers: { Accept: 'application/json' }, cache: 'no-store', signal })
  if (!response.ok) throw new Error(response.status === 404 ? '요청한 자료를 찾을 수 없습니다. (404)' : `자료 서버가 응답하지 못했습니다. (${response.status})`)
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('자료 서버의 JSON 응답을 확인하지 못했습니다.')
  return response.json() as Promise<T>
}
