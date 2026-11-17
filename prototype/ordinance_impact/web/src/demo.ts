// 화면 흐름을 확인하기 위한 가상 자료다. 실제 조례·사업·수집 원문이 아니다.
export type Category = 'current' | 'upcoming' | 'evidence'
export type WorkflowStatus = 'PROPOSED' | 'APPROVED' | 'VERIFIED' | 'DISMISSED'

export interface ImpactItem {
  id: string
  title: string
  service: string
  department: string
  kind: string
  category: Category
  effectiveDate: string
  promulgatedDate: string
  before: string
  after: string
  article: string
  documents: number
  deltaSummary: string
  oldText: string
  newText: string
  guidanceText: string
  draft: string
  applicability: string
  blockReason?: string
  linkConfirmed: boolean
}

export const DEMO_DATE = '2026-11-17'

export const impacts: ImpactItem[] = [
  {
    id: 'OI-001',
    title: '가상 A구 청년 이사비 지원 조례',
    service: '가상 청년 이사비 지원',
    department: '청년정책과',
    kind: '신청 기한',
    category: 'current',
    effectiveDate: '2026-10-01',
    promulgatedDate: '2026-09-15',
    before: '90일',
    after: '180일',
    article: '제5조 제2항',
    documents: 3,
    deltaSummary: '신청 기한이 전입일부터 90일에서 180일로 연장되었습니다.',
    oldText: '제5조(신청) ② 지원을 받으려는 청년은 가상 A구로 전입한 날부터 90일 이내에 이사비 지원을 신청하여야 한다.',
    newText: '제5조(신청) ② 지원을 받으려는 청년은 가상 A구로 전입한 날부터 180일 이내에 이사비 지원을 신청하여야 한다.',
    guidanceText: '가상 청년 이사비 지원은 가상 A구 전입일부터 90일 이내에 신청할 수 있습니다.',
    draft: '가상 청년 이사비 지원은 가상 A구 전입일부터 180일 이내에 신청할 수 있습니다.',
    applicability: '가상 부칙 제2조: 2026년 10월 1일 이후 신청분부터 적용합니다. 시연에서는 현재 안내의 적용 대상과 일치하는 것으로 설정했습니다.',
    linkConfirmed: true,
  },
  {
    id: 'OI-002',
    title: '가상 A구 한부모가족 생활지원 조례',
    service: '가상 한부모가족 생활지원',
    department: '가족지원과',
    kind: '지원 금액',
    category: 'current',
    effectiveDate: '2026-10-15',
    promulgatedDate: '2026-09-30',
    before: '20만원',
    after: '25만원',
    article: '제6조 제1항',
    documents: 2,
    deltaSummary: '가구당 월 생활지원금이 20만원에서 25만원으로 변경되었습니다.',
    oldText: '제6조(지원금액) ① 가상 A구는 지원 대상 한부모가족에 가구당 월 20만원의 생활지원금을 지급할 수 있다.',
    newText: '제6조(지원금액) ① 가상 A구는 지원 대상 한부모가족에 가구당 월 25만원의 생활지원금을 지급할 수 있다.',
    guidanceText: '가상 한부모가족 생활지원 대상 가구에는 월 20만원을 지원합니다.',
    draft: '가상 한부모가족 생활지원 대상 가구에는 월 25만원을 지원합니다.',
    applicability: '가상 부칙 제2조: 시행일 이후 지급하는 생활지원금부터 적용합니다. 시연의 안내자료는 시행일 이후 지급분을 설명합니다.',
    linkConfirmed: true,
  },
  {
    id: 'OI-003',
    title: '가상 A구 장애인 보조기기 지원 조례',
    service: '가상 장애인 보조기기 지원',
    department: '장애인복지과',
    kind: '거주 기간',
    category: 'current',
    effectiveDate: '2026-11-01',
    promulgatedDate: '2026-10-16',
    before: '6개월 이상',
    after: '3개월 이상',
    article: '제4조 제1항',
    documents: 2,
    deltaSummary: '신청 전 연속 거주 요건이 6개월 이상에서 3개월 이상으로 변경되었습니다.',
    oldText: '제4조(지원 대상) ① 신청일을 기준으로 가상 A구에 연속하여 6개월 이상 주민등록을 두고 거주한 장애인을 지원 대상으로 한다.',
    newText: '제4조(지원 대상) ① 신청일을 기준으로 가상 A구에 연속하여 3개월 이상 주민등록을 두고 거주한 장애인을 지원 대상으로 한다.',
    guidanceText: '가상 장애인 보조기기 지원은 신청일 기준 가상 A구에 연속 6개월 이상 거주한 장애인이 신청할 수 있습니다.',
    draft: '가상 장애인 보조기기 지원은 신청일 기준 가상 A구에 연속 3개월 이상 거주한 장애인이 신청할 수 있습니다.',
    applicability: '가상 부칙 제2조: 2026년 11월 1일 이후 접수하는 신청부터 적용합니다. 시연에서는 다른 거주 요건 예외가 없는 것으로 설정했습니다.',
    linkConfirmed: true,
  },
  {
    id: 'OI-004',
    title: '가상 A구 청년 주거안정 지원 조례',
    service: '가상 청년 주거안정 지원',
    department: '주거지원과',
    kind: '연령 기준',
    category: 'upcoming',
    effectiveDate: '2027-01-01',
    promulgatedDate: '2026-11-10',
    before: '만 39세 이하',
    after: '만 44세 이하',
    article: '제3조 제2항',
    documents: 2,
    deltaSummary: '지원 연령 상한이 만 39세 이하에서 만 44세 이하로 확대될 예정입니다.',
    oldText: '제3조(지원 대상) ② 가상 A구 청년 주거안정 지원의 연령 기준은 신청일 현재 만 39세 이하로 한다.',
    newText: '제3조(지원 대상) ② 가상 A구 청년 주거안정 지원의 연령 기준은 신청일 현재 만 44세 이하로 한다.',
    guidanceText: '가상 청년 주거안정 지원은 신청일 현재 만 39세 이하인 사람이 신청할 수 있습니다.',
    draft: '가상 청년 주거안정 지원은 신청일 현재 만 44세 이하인 사람이 신청할 수 있습니다.',
    applicability: '가상 부칙 제1조: 2027년 1월 1일부터 시행합니다. 기준일에는 개정 전 안내를 현재 오류로 판단하지 않습니다.',
    blockReason: '2027년 1월 1일 시행 예정입니다. 시행일 도래 후 적용 근거를 다시 확인하세요.',
    linkConfirmed: true,
  },
  {
    id: 'OI-005',
    title: '가상 A구 출산가정 지원 조례',
    service: '가상 출산 축하금 지원',
    department: '가족지원과',
    kind: '신청 기한',
    category: 'evidence',
    effectiveDate: '2026-09-01',
    promulgatedDate: '2026-08-20',
    before: '60일',
    after: '90일',
    article: '제7조 제1항',
    documents: 3,
    deltaSummary: '신청 기한은 늘어났지만 부칙이 정한 적용 대상의 확인이 필요합니다.',
    oldText: '제7조(신청 기한) ① 가상 A구 출산 축하금은 출생일부터 60일 이내에 신청하여야 한다.',
    newText: '제7조(신청 기한) ① 가상 A구 출산 축하금은 출생일부터 90일 이내에 신청하여야 한다.',
    guidanceText: '가상 출산 축하금 지원은 자녀 출생일부터 60일 이내에 신청하세요.',
    draft: '가상 출산 축하금 지원은 자녀 출생일부터 90일 이내에 신청하세요.',
    applicability: '가상 부칙 제2조: 시행일 이후 출생한 자녀부터 적용합니다. 등록 안내가 어떤 출생 시기의 신청자를 대상으로 하는지 확인되지 않았습니다.',
    blockReason: '부칙의 적용 대상과 안내자료의 대상 시기가 미확인입니다. 일반화한 정정안을 승인할 수 없습니다.',
    linkConfirmed: true,
  },
  {
    id: 'OI-006',
    title: '가상 A구 청소년 이동지원 조례',
    service: '가상 청소년 교통비 지원',
    department: '청소년정책과',
    kind: '지원 금액',
    category: 'evidence',
    effectiveDate: '2026-11-01',
    promulgatedDate: '2026-10-20',
    before: '30만원',
    after: '40만원',
    article: '제8조 제1항',
    documents: 2,
    deltaSummary: '연간 지원 상한은 변경되었으나 해당 사업의 직접 근거 조례인지 확인이 필요합니다.',
    oldText: '제8조(지원 한도) ① 가상 A구는 청소년 이동지원금을 1인당 연간 30만원의 범위에서 지원할 수 있다.',
    newText: '제8조(지원 한도) ① 가상 A구는 청소년 이동지원금을 1인당 연간 40만원의 범위에서 지원할 수 있다.',
    guidanceText: '가상 청소년 교통비 지원의 연간 지원 상한은 1인당 30만원입니다.',
    draft: '가상 청소년 교통비 지원의 연간 지원 상한은 1인당 40만원입니다.',
    applicability: '사업 설명에는 유사한 조례명만 기재되어 있습니다. 가상 A구의 해당 조례가 이 사업에 직접 적용되는지 연결 근거를 확인해야 합니다.',
    blockReason: '조례와 복지사업의 연결이 확인되지 않았습니다. 연결 근거를 먼저 검토하세요.',
    linkConfirmed: false,
  },
]
