import { DEMO_DATE, type ImpactItem, type WorkflowStatus } from './demo.ts'

// 화면 시연용 전이 검사다. 실제 원문·인용·권한·최신성 검증을 대신하지 않는다.
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function includesExactValue(text: string, value: string): boolean {
  if (!value) return false
  let index = text.indexOf(value)
  while (index !== -1) {
    const previous = text[index - 1] ?? ''
    const next = text[index + value.length] ?? ''
    const numericPrefix = /^\d/.test(value) && /\d/.test(previous)
    const numericSuffix = /\d$/.test(value) && /\d/.test(next)
    if (!numericPrefix && !numericSuffix) return true
    index = text.indexOf(value, index + 1)
  }
  return false
}

export function approvalBlockReason(
  item: ImpactItem,
  status: WorkflowStatus,
  draft: string,
  confirmed: boolean,
): string | null {
  if (status !== 'PROPOSED') {
    return '이미 처리된 검토 건입니다. 현재 상태와 검토 이력을 확인하세요.'
  }
  if (!isCalendarDate(item.effectiveDate)) {
    return '시행일이 확인되지 않았습니다. 정확한 시행일을 확인하세요.'
  }
  if (item.category === 'upcoming' || item.effectiveDate > DEMO_DATE) {
    return '시행 예정인 변경입니다. 시행일 도래 후 적용 근거를 다시 확인하세요.'
  }
  if (!item.linkConfirmed) {
    return '조례와 복지사업의 연결이 확인되지 않았습니다. 연결 근거를 먼저 검토하세요.'
  }
  if (item.blockReason) return item.blockReason
  if (item.category === 'evidence') {
    return '적용 근거가 충분하지 않습니다. 부칙과 안내 대상 시기를 확인하세요.'
  }
  if ([item.oldText, item.newText, item.guidanceText, item.applicability].some(value => !value.trim())) {
    return '비교 원문 또는 적용 근거가 빠져 있습니다. 근거를 보완하세요.'
  }
  if (!confirmed) {
    return '적용 시점·부칙·정정 범위를 확인한 뒤 확인란을 선택하세요.'
  }

  const text = draft.normalize('NFC').trim()
  const after = item.after.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (!text) return '정정 초안을 입력하세요.'
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(text)) {
    return '정정 초안에 표시할 수 없는 제어문자가 있습니다.'
  }
  const normalizedText = text.replace(/\s+/gu, ' ')
  if (!includesExactValue(normalizedText, after)) {
    return '정정 초안에 개정 후 조건인 “' + item.after + '”을 정확히 포함하세요.'
  }
  const context = normalizedText.replace(after, '').replace(/[\p{P}\p{Z}\s]/gu, '')
  if (context.length < 2) {
    return '변경 값만 적지 말고 안내에 사용할 정정 문장을 입력하세요.'
  }
  // 편집 문구의 의미·추가 수치까지 검증하는 기능은 이 화면 시연에 없다.
  const exampleDraft = item.draft.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (normalizedText !== exampleDraft) {
    return '편집한 문구의 추가 근거 검토가 필요합니다. 화면 시연에서는 예시 초안을 복원한 뒤 승인하세요.'
  }
  return null
}

export function verifyBlockReason(status: WorkflowStatus, reflected: boolean): string | null {
  if (status !== 'APPROVED') {
    return '정정안 승인 후에 수정 결과를 확인할 수 있습니다.'
  }
  if (!reflected) {
    return '승인한 내용의 실제 반영 여부를 확인한 뒤 확인란을 선택하세요.'
  }
  return null
}

export function statusLabel(status: WorkflowStatus): string {
  const labels: Record<WorkflowStatus, string> = {
    PROPOSED: '정정안 검토',
    APPROVED: '정정안 승인',
    VERIFIED: '수정 확인',
    DISMISSED: '검토 제외',
  }
  return labels[status]
}
