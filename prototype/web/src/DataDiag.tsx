import { useState } from 'react'
import { Database } from 'lucide-react'
import { HBar, Hint, SubNav, type BarRow } from './ui'
import { by_sido, national, finance_words, source, fetched_at, total } from '../../../eval/results/2026-11-13_metadata_quality.json'
import { denominator, metric, seoul, units_national, units_with_le3_services } from '../../../eval/results/2026-11-13_sgg_services.json'

type Metric = { key: 'fin_tag_pct' | 'theme_empty_pct' | 'life_empty_pct' | 'target_empty_pct'; label: string; desc: string }
const METRICS: Metric[] = [
  { key: 'fin_tag_pct', label: '서민금융 태그', desc: '사업 중 "서민금융" 태그가 붙은 비율' },
  { key: 'theme_empty_pct', label: '관심주제 빈칸', desc: '관심주제 태그가 비어 있는 사업 비율' },
  { key: 'life_empty_pct', label: '생애주기 빈칸', desc: '생애주기 태그가 비어 있는 사업 비율' },
  { key: 'target_empty_pct', label: '대상특성 빈칸', desc: '대상특성 태그가 비어 있는 사업 비율' },
]
type Sido = { n: number; fin_tag_pct: number; theme_empty_pct: number; life_empty_pct: number; target_empty_pct: number }
const sido = by_sido as unknown as Record<string, Sido>
const SRC1 = 'eval/results/2026-11-13_metadata_quality.json'
const SRC2 = 'eval/results/2026-11-13_sgg_services.json'

const HILITE = ['강북구', '중구', '노원구']
const gv = (g: string) => seoul.rows.find((r) => r.gu === g)?.per_1000.toFixed(2)

export default function DataDiag() {
  const [mk, setMk] = useState<Metric['key']>('fin_tag_pct')
  const m = METRICS.find((x) => x.key === mk)!
  const rows: BarRow[] = Object.entries(sido).sort((a, b) => b[1][mk] - a[1][mk]).map(([k, v]) => ({ label: k, value: v[mk], text: `${v[mk]}%`, sub: `${v.n}건`, tone: 'default' }))
  const gu: BarRow[] = [...seoul.rows].sort((a, b) => b.per_1000 - a.per_1000).map((r) => ({
    label: r.gu, value: r.per_1000, text: r.per_1000.toFixed(2), sub: `${r.services}건/${r.수급가구수.toLocaleString()}가구`,
    tone: HILITE.includes(r.gu) ? 'primary' : 'default',
  }))
  const nat = national as unknown as Sido & { fin_tag: number; fin_nomatch_pct_of_fintag: number; fin_tag_pct_of_tagged: number }

  return (
    <>
      <div className="tt"><h1>데이터 진단</h1><SubNav on="data" /></div>
      <p className="muted caption lead">정보원 복지서비스 API 집계</p>

      <div className="kpis">
        <div className="card kpi"><span className="kpi-l"><Database size={20} aria-hidden="true" />지자체 사업</span><span className="kpi-v"><b>{total.toLocaleString()}</b>건</span><span className="caption muted">조회 {fetched_at.slice(0, 10)}</span></div>
        <div className="card kpi"><span className="kpi-l">서민금융 태그</span><span className="kpi-v"><b>{nat.fin_tag_pct}</b>%</span><span className="caption muted">{nat.fin_tag.toLocaleString()}건</span></div>
        <div className="card kpi"><span className="kpi-l">태그만 있고 금융 단어 없음</span><span className="kpi-v"><b>{nat.fin_nomatch_pct_of_fintag}</b>%</span><span className="caption muted">서민금융 태그 중</span></div>
        <div className="card kpi"><span className="kpi-l">시군구 단위</span><span className="kpi-v"><b>{units_national}</b>곳</span><span className="caption muted">3건 이하 {units_with_le3_services}곳</span></div>
      </div>

      <section className="card sec-gap" aria-labelledby="d1">
        <div className="card-head"><h2 id="d1">시도별 태그 현황 <small>({m.desc})</small></h2></div>
        <div className="tabbar" role="tablist" aria-label="지표 선택">
          {METRICS.map((x) => <button key={x.key} role="tab" aria-selected={mk === x.key} className={`tab${mk === x.key ? ' on' : ''}`} onClick={() => setMk(x.key)}>{x.label}</button>)}
        </div>
        <HBar rows={rows} max={100} label={`시도별 ${m.label} 비율`} />
        <p className="src-line">전국 {nat[mk]}% (n={nat.n.toLocaleString()}) · 출처 {SRC1}<Hint label="해석">서민금융 태그 사업 중 {nat.fin_nomatch_pct_of_fintag}%는 요약에 {finance_words.slice(0, 6).join('·')} 등 금융 단어가 없습니다. 출처: {source}</Hint></p>
      </section>

      <section className="card sec-gap" aria-labelledby="d2">
        <h2 id="d2">서울 자치구별 1,000 수급가구당 자체사업 수</h2>
        <HBar rows={gu} label="자치구별 1,000 수급가구당 자체사업 수" />
        <p className="src-line">강북구 {gv('강북구')} · 중구 {gv('중구')} · 노원구 {gv('노원구')} (강조) · 출처 {SRC2}<Hint label="지표 설명">{metric} · 분모: {denominator}</Hint></p>
      </section>
    </>
  )
}
