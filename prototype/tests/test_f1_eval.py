"""f1_eval: 합성 CSV(tmp)로만 시험한다. 실제 시험셋(eval/testset)은 읽지 않는다. LLM은 기준선으로 대체."""
import csv
import json

import pytest

from prototype.pipeline import f1_baseline
from prototype.scripts import f1_eval

HEAD = ["메모ID", "가구ID", "상담일", "상담방식", "메모", "[정답]업무상태", "[정답]종결유형", "[정답]장벽원인",
        "[정답]신청", "[정답]문자", "[정답]방문", "[정답]관계망부재", "[정답]고립징후", "근거문장(선택)", "작성자메모(선택)"]
ROWS = [
    ["T-1", "G-1", "2026-08-01", "방문 상담", "2회차. 서류가 복잡하다며 또 미룸. 상담안내 종결.",
     "종결", "D1", "서류·절차", "보류(장벽)", "미확인", "미확인", "아니오", "없음", "", ""],
    ["T-2", "G-1", "2026-02-01", "방문 상담", "긴급지원 안내. 서류를 어디서 떼는지 몰라 미룸. 문자는 괜찮다고 함. 상담안내 종결.",
     "종결", "D1", "서류", "보류", "동의", "미확인", "아니오", "없음", "", ""],
    ["T-3", "G-2", "2026-03-01", "방문 상담", "세 차례 방문했으나 만나지 못함. 우편물이 쌓여 있음. 조사불가로 종결.",
     "종결", "C", "해당없음", "미확인", "미확인", "미확인", "예", "반복 부재, 우편물 적체", "", ""],
]


def write(path, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEAD)
        w.writerows(rows)
    return path


def fake(text, model):
    return f1_baseline.classify(text), {"latency_s": 0.1, "attempts": 1, "llm_ok": True,
                                        "quotes_proposed": 2, "quotes_verified": 1}


def test_refuses_empty_gold_cell(tmp_path):
    rows = [r[:] for r in ROWS]
    rows[1][7] = " "
    with pytest.raises(f1_eval.LabelError, match="비어"):
        f1_eval.load(write(tmp_path / "t.csv", rows))


def test_refuses_unreadable_label(tmp_path):
    rows = [r[:] for r in ROWS]
    rows[0][5] = "끝남"
    with pytest.raises(f1_eval.LabelError, match="끝남"):
        f1_eval.load(write(tmp_path / "t.csv", rows))


def test_main_refuses_without_calling_model(tmp_path, monkeypatch):
    rows = [r[:] for r in ROWS]
    rows[2][12] = ""
    monkeypatch.setattr(f1_eval.ollama, "model_info", lambda m: pytest.fail("모델을 부르면 안 된다"))
    with pytest.raises(SystemExit):
        f1_eval.main(["m", "--csv", str(write(tmp_path / "t.csv", rows)), "--out-dir", str(tmp_path / "o")])
    assert not (tmp_path / "o").exists()


def test_run_metrics_and_outputs(tmp_path):
    r = f1_eval.run(write(tmp_path / "t.csv", ROWS), "fake:1", tmp_path / "out", "2026-01-01", classify=fake)
    js = tmp_path / "out" / "2026-01-01_f1_testset_fake-1.json"
    assert js.exists() and js.with_suffix(".md").exists()
    saved = json.loads(js.read_text(encoding="utf-8"))
    assert saved["csv_sha256"] == r["csv_sha256"] and saved["network_mode"] == "2값"
    m = r["systems"]["fake:1"]
    assert m["fields"]["barrier_cause"]["accuracy"] == 1.0  # '서류' 표기 → 서류·절차로 정규화
    assert m["fields"]["isolation"]["accuracy"] == 1.0
    assert m["quote_verified_rate"] == 0.5 and m["pending_rate"] == 0.0
    rb = m["repeated_barrier"]
    assert rb["detected_str"] == "1/1" and rb["households"] == 1
    assert rb["per_household"][0]["memo_ids"] == ["T-2", "T-1"]  # 상담일 순
    assert set(m["fields"]["work_status"]["confusion"]["종결"]) == {"종결"}
    assert "반복 장벽 검출" in js.with_suffix(".md").read_text(encoding="utf-8")
    assert set(r["systems"]) == {"fake:1", "fake:1 (거부 가드 없음)", f1_baseline.MODEL}
    assert "unguarded" not in json.dumps(saved["per_memo"], ensure_ascii=False)


def test_macro_f1():
    assert f1_eval.macro_f1(["a", "a", "b"], ["a", "b", "b"]) == round((2 / 3 + 2 / 3) / 2, 3)
    assert f1_eval.set_macro_f1([["단전"], []], [["단전"], ["단수"]]) == round((1 + 0) / 2, 3)
