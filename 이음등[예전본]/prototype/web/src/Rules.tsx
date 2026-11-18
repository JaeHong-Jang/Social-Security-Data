import { useState } from 'react'
import { Ban, FlaskConical, RotateCcw } from 'lucide-react'
import { RANK, useData } from './data'
import { Hint, LevelBadge, Skeleton, SubNav, Tag } from './ui'
import { summary as sens, label as sensLabel, delta, runs } from '../../../eval/results/2026-11-13_f2_sensitivity.json'
import { kendall_tau_b, topk, level_changed, n_households, label as ablLabel } from '../../../eval/results/2026-11-13_f2_ablation.json'

// prototype/pipeline/f2_priority_v2.py 의 가중치 표(모두 가설)
const RULES: { key: string; label: string; source: string; max: number; rule: string }[] = [
  { key: 'R', label: '반복 발굴', source: '행정(발굴 이력)', max: 10, rule: '2회 6점, 3회 이상 10점' },
  { key: 'C', label: '현재 위기영역', source: '행정', max: 12, rule: '영역당 3점, 최대 4개' },
  { key: 'W', label: '악화', source: '행정', max: 8, rule: '직전 발굴보다 위기영역 수가 늘면 가점' },
  { key: 'M', label: '처리 확인 필요', source: '메모 해석(인용)', max: 15, rule: '최근 메모가 조사중·판단보류인데 종결 처리됐거나, 조사불가 종결' },
  { key: 'B', label: '반복 장벽', source: '회차 교차(인용)', max: 15, rule: '서로 다른 회차 메모 2건 이상에서 같은 장벽 원인이 인용과 함께 나타남' },
  { key: 'I', label: '고립', source: '행정 + 메모 인용', max: 14, rule: '1인가구 4점 + 도움 관계망 부재 6점(인용) + 고립 징후 4점(인용)' },
  { key: 'N', label: '종결 후 새 위기신호', source: '행정(위기정보 연계)', max: 14, rule: '새 신호 1건 8점, 2건 이상 14점' },
  { key: 'T', label: '경과일', source: '행정(종결일)', max: 12, rule: '종결 후 30일마다 3점, 120일 이상 12점' },
]
const SRC = 'eval/results/2026-11-13_f2_sensitivity.json · 2026-11-13_f2_ablation.json'

export default function Rules() {
  const { meta, cases } = useData()
  const [w, setW] = useState<Record<string, number>>(() => Object.fromEntries(RULES.map((r) => [r.key, r.max])))
  if (!meta || !cases) return <Skeleton label="불러오는 중입니다." />
  const th = meta.level_thresholds
  const base = cases.filter((c) => !c.session)
  const sumW = Object.values(w).reduce((a, b) => a + b, 0) || 1
  const changed = RULES.some((r) => w[r.key] !== r.max)
  const rescored = base.map((c) => {
    const raw = c.f2.items.reduce((s, i) => s + (i.unknown ? 0 : (i.points / i.max) * (w[i.key] ?? 0)), 0)
    const total = Math.round((raw * 100) / sumW)
    return { c, total, level: (total >= th.긴급 ? '긴급' : total >= th.주의 || c.f2.flags.length > 0 ? '주의' : '관찰') as keyof typeof RANK }
  })
  const baseRank = new Map([...base].sort((a, b) => b.f2.total - a.f2.total || a.household.id.localeCompare(b.household.id)).map((c, i) => [c.household.id, i + 1]))
  const ranked = [...rescored].sort((a, b) => b.total - a.total || a.c.household.id.localeCompare(b.c.household.id))

  return (
    <>
      <div className="tt"><h1>규칙 공개</h1><SubNav on="rules" /></div>
      <p className="principle"><Ban size={16} aria-hidden="true" /> 점수는 코드 규칙으로만 계산합니다. 메모 해석(AI)은 입력값 추출에만 쓰이며 점수·단계·자격·발송을 정하지 않습니다. 가중치는 가설(규칙 {meta.rule_version}).</p>

      <section className="card sec-gap" aria-labelledby="r1">
        <h2 id="r1">점수 규칙 <small>(합계 100점)</small></h2>
        <div className="table-wrap flat">
          <table className="queue rules">
            <caption className="sr-only">재검토 점수 규칙과 배점</caption>
            <thead><tr><th scope="col">키</th><th scope="col">항목</th><th scope="col">입력 출처</th><th scope="col" className="num">배점</th><th scope="col">부여 규칙</th></tr></thead>
            <tbody>{RULES.map((r) => (
              <tr key={r.key}><td data-l="키"><b>{r.key}</b></td><td data-l="항목">{r.label}</td><td data-l="입력 출처">{r.source}</td><td data-l="배점" className="num">{meta.weights?.[r.key as 'R'] ?? r.max}</td><td data-l="부여 규칙">{r.rule}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="rule-cols">
          <div>
            <h3>단계 기준 <small className="muted">(가설)</small></h3>
            <p className="check-line"><LevelBadge level="긴급" />{th.긴급}점 이상 <LevelBadge level="주의" />{th.주의}점 이상 <LevelBadge level="관찰" />그 미만</p>
            <p className="caption">예외: '처리 확인 필요'(M) 플래그 → 점수와 무관하게 <b>주의 이상</b> (실험에도 적용)</p>
            <p className="caption muted">재확인 주기 긴급 {meta.recheck_days.긴급}일 · 주의 {meta.recheck_days.주의}일 · 관찰 {meta.recheck_days.관찰}일</p>
          </div>
          <div>
            <h3>점수 미사용 속성</h3>
            <p className="check-line"><Ban size={18} aria-hidden="true" />{(cases[0]?.f2.excluded_attributes ?? ['성별', '연령', '국적', '장애']).map((a) => <Tag key={a} icon="ban">{a}</Tag>)}</p>
            <p className="caption muted">연락 거부 이력도 점수 제외, 제안에서만 반영</p>
          </div>
        </div>
      </section>

      <section className="card sec-gap" aria-labelledby="r2">
        <div className="card-head"><h2 id="r2">민감도·ablation <small>(가상 16가구 설계 시연)</small></h2></div>
        <div className="kpis">
          <div className="card kpi"><span className="kpi-l">가중치 ±{delta} 변경 시 상위 5가구</span><span className="kpi-v"><b>{sens.top5_unchanged_runs}</b></span><span className="caption muted">{runs.length}가지 변경 모두</span></div>
          <div className="card kpi"><span className="kpi-l">순위 상관(Kendall τb)</span><span className="kpi-v"><b>{sens.mean_kendall_tau_b}</b></span><span className="caption muted">평균 · 최소 {sens.min_kendall_tau_b}</span></div>
          <div className="card kpi"><span className="kpi-l">메모 해석(M·B) 제외 시</span><span className="kpi-v"><b>{level_changed.length}</b>가구</span><span className="caption muted">{n_households}가구 중 단계 변경 · τb {kendall_tau_b}</span></div>
          <div className="card kpi"><span className="kpi-l">메모 해석 제외 시 상위 5</span><span className="kpi-v"><b>{topk.top5.changed}</b>가구</span><span className="caption muted">교체 · Jaccard {topk.top5.jaccard}</span></div>
        </div>
        <p className="src-line">출처 {SRC}<Hint label="범위">{sensLabel}{ablLabel === sensLabel ? '' : ` ${ablLabel}`}</Hint></p>
      </section>

      <section className="card sec-gap" aria-labelledby="r3">
        <div className="card-head">
          <h2 id="r3">가설 가중치 실험</h2>
          <span className="head-actions"><Tag tone="draft"><FlaskConical size={14} aria-hidden="true" />저장 안 됨</Tag>
            <button className="btn small" disabled={!changed} onClick={() => setW(Object.fromEntries(RULES.map((r) => [r.key, r.max])))}><RotateCcw size={16} aria-hidden="true" />원래대로</button></span>
        </div>
        <p className="caption muted">가상 {base.length}가구 재순위 · 가중치 합 {sumW}점을 100점으로 환산</p>
        <div className="exp">
          <ul className="sliders">
            {RULES.map((r) => (
              <li key={r.key}>
                <label htmlFor={`w-${r.key}`}><b>{r.key}</b> {r.label}</label>
                <input id={`w-${r.key}`} type="range" min={0} max={30} step={1} value={w[r.key]} onChange={(e) => setW({ ...w, [r.key]: +e.target.value })} />
                <output htmlFor={`w-${r.key}`} className="num">{w[r.key]}점{w[r.key] !== r.max && <small> (기본 {r.max})</small>}</output>
              </li>
            ))}
          </ul>
          <div className="table-wrap flat">
            <table className="queue exp-t">
              <caption className="sr-only">가중치 실험 결과 순위</caption>
              <thead><tr><th scope="col" className="num">순위</th><th scope="col">가구</th><th scope="col">단계</th><th scope="col" className="num">점수</th><th scope="col" className="num">순위 변화</th></tr></thead>
              <tbody>{ranked.map((r, i) => {
                const d = (baseRank.get(r.c.household.id) ?? i + 1) - (i + 1)
                return (
                  <tr key={r.c.household.id}>
                    <td data-l="순위" className="num">{i + 1}</td><td data-l="가구"><b>{r.c.household.id}</b> <span className="sub">{r.c.household.gu}</span></td>
                    <td data-l="단계"><LevelBadge level={r.level} /></td><td data-l="점수" className="num">{r.total}</td>
                    <td data-l="순위 변화" className="num">{d === 0 ? '—' : d > 0 ? `▲ ${d}` : `▼ ${-d}`}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
