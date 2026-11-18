import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_DATE, impacts, type ImpactItem, type WorkflowStatus } from './demo.ts'
import { approvalBlockReason, statusLabel, verifyBlockReason } from './workflow.ts'
import { diffLines } from './publicData.ts'

const current = (): ImpactItem => ({ ...impacts[0] })

test('시행 중이며 연결·검토·초안이 확인된 경우에만 승인할 수 있다', () => {
  const item = current()
  assert.equal(approvalBlockReason(item, 'PROPOSED', item.draft, true), null)
})

test('시행 예정 분류와 미래 시행일은 각각 현재 승인을 막는다', () => {
  const item = current()
  assert.match(approvalBlockReason({ ...item, category: 'upcoming' }, 'PROPOSED', item.draft, true)!, /시행/)
  assert.match(approvalBlockReason({ ...item, effectiveDate: '2027-01-01' }, 'PROPOSED', item.draft, true)!, /시행/)
})

test('존재하지 않거나 빠진 시행일은 시행 중으로 취급하지 않는다', () => {
  const item = current()
  for (const effectiveDate of ['', '2026-02-30', '2026-2-1']) {
    assert.match(approvalBlockReason({ ...item, effectiveDate }, 'PROPOSED', item.draft, true)!, /시행일/)
  }
  assert.equal(approvalBlockReason({ ...item, effectiveDate: DEMO_DATE }, 'PROPOSED', item.draft, true), null)
})

test('조례–사업 연결 미확인은 담당자가 검토 표시해도 승인할 수 없다', () => {
  const item = current()
  assert.match(approvalBlockReason({ ...item, linkConfirmed: false }, 'PROPOSED', item.draft, true)!, /연결/)
})

test('부칙 미확인과 명시된 차단 사유는 승인보다 우선한다', () => {
  const item = current()
  assert.match(approvalBlockReason({ ...item, category: 'evidence' }, 'PROPOSED', item.draft, true)!, /근거/)
  assert.equal(approvalBlockReason({ ...item, blockReason: '부칙 적용 대상을 확인하세요.' }, 'PROPOSED', item.draft, true), '부칙 적용 대상을 확인하세요.')
  for (const field of ['oldText', 'newText', 'guidanceText', 'applicability'] as const) {
    assert.match(approvalBlockReason({ ...item, [field]: ' ' }, 'PROPOSED', item.draft, true)!, /근거/)
  }
})

test('적용 시점·예외 확인 체크가 없으면 승인할 수 없다', () => {
  const item = current()
  assert.match(approvalBlockReason(item, 'PROPOSED', item.draft, false)!, /확인/)
})

test('빈 초안·값 누락·제어문자·숫자 일부 일치는 유효한 정정안이 아니다', () => {
  const item = current()
  for (const draft of ['', '   ', '신청 기한은 기존 안내와 같습니다.', '신청 기한은 180일입니다.\u0000', '신청 기한은 1180일입니다.', item.after]) {
    assert.notEqual(approvalBlockReason(item, 'PROPOSED', draft, true), null, JSON.stringify(draft))
  }
  assert.equal(approvalBlockReason(item, 'PROPOSED', item.draft.replace('이내에', '이내에\n'), true), null)
})

test('예시 초안에 없는 금액은 변경 값이 있어도 승인하지 않는다', () => {
  const item = current()
  const reason = '편집한 문구의 추가 근거 검토가 필요합니다. 화면 시연에서는 예시 초안을 복원한 뒤 승인하세요.'
  assert.equal(approvalBlockReason(item, 'PROPOSED', '180일 이내 신청하면 999만원 지급', true), reason)
})

test('신청 가능 여부를 뒤집은 부정 표현은 변경 값이 있어도 승인하지 않는다', () => {
  const item = current()
  const reason = '편집한 문구의 추가 근거 검토가 필요합니다. 화면 시연에서는 예시 초안을 복원한 뒤 승인하세요.'
  assert.equal(approvalBlockReason(item, 'PROPOSED', '180일 이내 신청할 수 없습니다', true), reason)
})

test('NFC와 연속 공백 정규화 후 예시 초안과 같은 문장은 승인할 수 있다', () => {
  const item = current()
  const draft = '  ' + item.draft.normalize('NFD').replaceAll(' ', ' \n\t ') + '  '
  assert.equal(approvalBlockReason(item, 'PROPOSED', draft, true), null)
})

test('이미 승인·수정 확인·검토 제외된 건을 다시 승인하지 않는다', () => {
  const item = current()
  for (const status of ['APPROVED', 'VERIFIED', 'DISMISSED'] as WorkflowStatus[]) {
    assert.notEqual(approvalBlockReason(item, status, item.draft, true), null)
  }
})

test('정정안 승인만으로 수정 확인이 되지 않으며 별도의 반영 확인이 필요하다', () => {
  assert.match(verifyBlockReason('APPROVED', false)!, /반영/)
  assert.equal(verifyBlockReason('APPROVED', true), null)
})

test('미승인·완료·제외 건에서는 수정 확인으로 전이할 수 없다', () => {
  for (const status of ['PROPOSED', 'VERIFIED', 'DISMISSED'] as WorkflowStatus[]) {
    assert.notEqual(verifyBlockReason(status, true), null)
  }
})

test('업무 상태 문구는 승인과 실제 수정 확인을 구분한다', () => {
  assert.equal(statusLabel('PROPOSED'), '정정안 검토')
  assert.equal(statusLabel('APPROVED'), '정정안 승인')
  assert.equal(statusLabel('VERIFIED'), '수정 확인')
  assert.equal(statusLabel('DISMISSED'), '검토 제외')
})

test('시연 자료는 전부 가상으로 표시하고 세 분류를 갖춘다', () => {
  assert.equal(impacts.length, 6)
  assert.deepEqual(impacts.map(item => item.id), ['OI-001', 'OI-002', 'OI-003', 'OI-004', 'OI-005', 'OI-006'])
  assert.deepEqual(['current', 'upcoming', 'evidence'].map(category => impacts.filter(item => item.category === category).length), [3, 1, 2])
  for (const item of impacts) {
    assert.match(item.title, /가상/)
    assert.match(item.service, /가상/)
    assert.ok(item.newText.includes(item.after))
    assert.ok(item.oldText.includes(item.before))
  }
})

test('연혁 비교는 달라진 줄만 표시하고 원문 줄을 빠뜨리지 않는다', () => {
  const result = diffLines('제1조 목적\n신청 기한 90일\n제3조 삭제될 조문\n부칙', '제1조 목적\n신청 기한 180일\n부칙\n제4조 신설')
  assert.deepEqual(result.before.filter(line => line.changed).map(line => line.text), ['신청 기한 90일', '제3조 삭제될 조문'])
  assert.deepEqual(result.after.filter(line => line.changed).map(line => line.text), ['신청 기한 180일', '제4조 신설'])
  assert.equal(result.before.map(line => line.text).join('\n'), '제1조 목적\n신청 기한 90일\n제3조 삭제될 조문\n부칙')
  assert.equal(diffLines('같은 본문', '같은 본문').after.some(line => line.changed), false)
})
