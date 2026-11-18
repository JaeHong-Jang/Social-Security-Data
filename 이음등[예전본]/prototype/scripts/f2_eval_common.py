"""F2 v2 민감도·ablation 스크립트 공통 도구. 입력은 가상 16가구 v3(households.v3.json, F1은 실제 LLM 출력)뿐이다."""
import json
import sys
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from prototype.api.schemas_v2 import CaseFileV2  # noqa: E402

MOCK = ROOT / "prototype/web/mock/households.v3.json"
RESULTS = ROOT / "eval/results"
LABEL = ("가상 16가구 v3(households.v3.json) — 가구·메모는 가상, F1은 실제 로컬 LLM 출력(손 수정 없음, 거부 가드 포함). "
         "설계 시연용. 실제 가구·평가셋 아님, 일반화 불가.")


def load():
    data = CaseFileV2.model_validate_json(MOCK.read_text(encoding="utf-8"))
    return [c.household for c in data.cases]


def rank(scores: dict[str, float]) -> list[str]:
    """점수 내림차순, 동점은 ID 오름차순."""
    return sorted(scores, key=lambda k: (-scores[k], k))


def jaccard(a, b) -> float:
    a, b = set(a), set(b)
    return round(len(a & b) / len(a | b), 3) if a | b else 1.0


def kendall_tau_b(x: dict[str, float], y: dict[str, float]) -> float:
    conc = disc = tx = ty = 0
    for i, j in combinations(sorted(x), 2):
        dx, dy = x[i] - x[j], y[i] - y[j]
        if dx == 0 and dy == 0:
            continue
        if dx == 0:
            tx += 1
        elif dy == 0:
            ty += 1
        elif dx * dy > 0:
            conc += 1
        else:
            disc += 1
    denom = ((conc + disc + tx) * (conc + disc + ty)) ** 0.5
    return round((conc - disc) / denom, 3) if denom else 1.0


def save(name: str, payload: dict, md: str):
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (RESULTS / f"{name}.md").write_text(md, encoding="utf-8")
    print("saved", (RESULTS / f"{name}.json").relative_to(ROOT), (RESULTS / f"{name}.md").relative_to(ROOT))
