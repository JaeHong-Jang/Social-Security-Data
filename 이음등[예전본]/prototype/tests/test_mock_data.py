import json
from pathlib import Path

from prototype.api.schemas import CaseFile

ROOT = Path(__file__).resolve().parents[2]


def test_mock_file_valid_and_quotes_real():
    data = CaseFile.model_validate_json((ROOT / "prototype/web/mock/households.json").read_text(encoding="utf-8"))
    cache = {it["servId"]: it["detail"] for it in
             json.loads((ROOT / "data/cache/local_서울특별시.json").read_text(encoding="utf-8"))["items"]}
    for case in data.cases:
        for c in case.f3.candidates:
            d = cache[c.serv_id]
            assert c.name == d["servNm"]
            assert c.criteria_quote in d.get("sprtTrgtCn", "") + "\n" + d.get("slctCritCn", "")
    assert not any("gender" in json.dumps(c.model_dump(mode="json")) for c in data.cases)


def test_fabricated_quote_rejected():
    import pytest
    from pydantic import ValidationError
    data = json.loads((ROOT / "prototype/web/mock/households.json").read_text(encoding="utf-8"))
    ev = data["cases"][0]["f1"]["evidence"][0]
    ev["quote"] = "원문에없는문장"[: len(ev["quote"])].ljust(len(ev["quote"]), "x")
    with pytest.raises(ValidationError):
        CaseFile.model_validate(data)
