import importlib
import json
from pathlib import Path

import pytest


def normalizers():
    try:
        return importlib.import_module("prototype.ordinance_impact.api.normalizers")
    except ModuleNotFoundError:
        pytest.fail("Service normalization has not been implemented")


def local_row():
    return {
        "servId": "WLF00005234", "servNm": "성동구 청년 등 탈모 치료 지원",
        "ctpvNm": "서울특별시", "sggNm": "성동구", "servDgst": "목록 요약",
        "servDtlLink": "https://www.bokjiro.go.kr/detail?wlfareInfoId=WLF00005234",
        "detail": {"resultCode": "0", "sprtTrgtCn": "39세 이하 성동구민", "slctCritCn": "3개월 거주",
                   "aplyMtdCn": "구청 홈페이지 접수", "bizChrDeptNm": "아동청년과",
                   "baslawList": {"wlfareInfoDtlCd": "030", "wlfareInfoReldNm": "서울특별시 성동구 청년 등 탈모 치료 지원 조례"}},
    }


def test_normalizes_actual_xml_dictionary_legal_list_without_inventing_law_id():
    service = normalizers().normalize_service(local_row(), "local", "local-welfare", "2026-11-13 00:14:18", "snapshot-detail")
    assert service["id"] == "local:WLF00005234"
    assert service["region"] == "서울특별시 성동구"
    assert service["target"] == "39세 이하 성동구민"
    assert service["criteria"] == "3개월 거주"
    assert service["application"] == "구청 홈페이지 접수"
    assert service["detailStatus"] == "collected"
    assert service["legalBases"] == [{"name": "서울특별시 성동구 청년 등 탈모 치료 지원 조례", "content": "", "code": "030"}]
    assert "lawId" not in json.dumps(service)


def test_legal_bases_list_preserves_repeated_actual_references():
    row = local_row()
    row["detail"]["baslawList"] = [
        {"wlfareInfoDtlCd": "030", "wlfareInfoReldNm": "조례 A", "wlfareInfoReldCn": "제3조"},
        {"wlfareInfoDtlCd": "030", "wlfareInfoReldNm": "법률 B"},
    ]
    service = normalizers().normalize_service(row, "local", "local-welfare", None, "s")
    assert service["legalBases"] == [{"name": "조례 A", "content": "제3조", "code": "030"}, {"name": "법률 B", "content": "", "code": "030"}]


def test_list_only_central_service_has_missing_detail_and_unknown_timestamp():
    row = {"servId": "WLF00000781", "servNm": "여성청소년 생리용품 지원", "jurMnofNm": "성평등가족부", "jurOrgNm": "청소년정책과"}
    service = normalizers().normalize_service(row, "central", "central-welfare", None, "central-cache")
    assert service["id"] == "central:WLF00000781"
    assert service["region"] == "전국"
    assert service["department"] == "성평등가족부 청소년정책과"
    assert service["detailStatus"] == "missing"
    assert service["fetchedAt"] is None
    assert service["legalBases"] == []
    assert service["target"] == ""


def test_failed_detail_is_not_presented_as_collected():
    row = local_row()
    row["detail"] = {"resultCode": "99", "resultMessage": "SECRET"}
    service = normalizers().normalize_service(row, "local", "local-welfare", None, "s")
    assert service["detailStatus"] == "error"
    assert "SECRET" not in json.dumps(service)


def test_merge_keeps_actual_rich_details_and_both_observation_provenances():
    module = normalizers()
    row = local_row()
    rich = module.normalize_service(row, "local", "local-welfare", "2026-11-13 00:14:18", "detail-snapshot")
    del row["detail"]
    listing = module.normalize_service(row, "local", "local-welfare", "2026-11-13 16:39:22", "list-snapshot")
    for items in ([rich, listing], [listing, rich]):
        merged = module.merge_services(items)
        assert len(merged) == 1
        assert merged[0]["target"] == "39세 이하 성동구민"
        assert merged[0]["fetchedAt"] == "2026-11-13 00:14:18"
        assert merged[0]["snapshotId"] == "detail-snapshot"
        assert {item["snapshotId"] for item in merged[0]["provenance"]} == {"detail-snapshot", "list-snapshot"}


def test_merge_does_not_attribute_list_timestamp_to_undated_actual_detail():
    module = normalizers()
    row = local_row()
    undated_detail = module.normalize_service(row, "local", "local-welfare", None, "undated-detail")
    del row["detail"]
    dated_listing = module.normalize_service(row, "local", "local-welfare", "2026-11-13 16:39:22", "dated-list")
    service = module.merge_services([dated_listing, undated_detail])[0]
    assert service["snapshotId"] == "undated-detail"
    assert service["fetchedAt"] is None


def test_merge_uses_newest_observed_detail_without_resurrecting_old_references():
    module = normalizers()
    old_row, new_row = local_row(), local_row()
    old_row["detail"].update({
        "sprtTrgtCn": "1월의 오래된 상세 설명이 11월 상세보다 훨씬 깁니다",
        "baslawList": {"wlfareInfoReldNm": "폐지된 조례"},
        "basfrmList": {"wlfareInfoReldNm": "과거 신청서", "wlfareInfoReldCn": "https://example.go.kr/old-form"},
        "inqplHmpgReldList": {"wlfareInfoReldNm": "과거 안내", "wlfareInfoReldCn": "https://example.go.kr/old-guide"},
    })
    new_row["detail"].update({
        "sprtTrgtCn": "새 대상",
        "baslawList": {"wlfareInfoReldNm": "현행 조례"},
        "basfrmList": {"wlfareInfoReldNm": "새 신청서", "wlfareInfoReldCn": "https://example.go.kr/new-form"},
        "inqplHmpgReldList": {"wlfareInfoReldNm": "새 안내", "wlfareInfoReldCn": "https://example.go.kr/new-guide"},
    })
    old = module.normalize_service(old_row, "local", "local-welfare", "2026-01-01T00:00:00+09:00", "old-detail")
    new = module.normalize_service(new_row, "local", "local-welfare", "2026-11-01T00:00:00+09:00", "new-detail")
    results = [module.merge_services(items)[0] for items in ([old, new], [new, old])]
    assert results[0] == results[1]
    result = results[0]
    assert {key: value for key, value in result.items() if key != "provenance"} == {key: value for key, value in new.items() if key != "provenance"}
    assert {item["snapshotId"] for item in result["provenance"]} == {"old-detail", "new-detail"}


def test_new_detail_empty_arrays_and_fields_do_not_revive_deleted_old_content():
    module = normalizers()
    old_row, new_row = local_row(), local_row()
    old_row["detail"]["basfrmList"] = {"wlfareInfoReldNm": "과거 신청서", "wlfareInfoReldCn": "https://example.go.kr/old"}
    old_row["detail"]["inqplHmpgReldList"] = {"wlfareInfoReldNm": "과거 안내", "wlfareInfoReldCn": "https://example.go.kr/old-guide"}
    new_row["detail"].update({"sprtTrgtCn": "", "slctCritCn": "", "baslawList": [], "basfrmList": [], "inqplHmpgReldList": []})
    old = module.normalize_service(old_row, "local", "local-welfare", "2026-01-01", "old-detail")
    new = module.normalize_service(new_row, "local", "local-welfare", "2026-11-01", "new-detail")
    for items in ([old, new], [new, old]):
        result = module.merge_services(items)[0]
        assert result["target"] == ""
        assert result["criteria"] == ""
        assert result["legalBases"] == []
        assert result["attachments"] == []
        assert result["relatedLinks"] == []
        assert result["snapshotId"] == "new-detail"


@pytest.mark.parametrize("unknown_time", [None, "unknown"])
def test_undated_detail_is_not_assumed_newer_than_dated_observation(unknown_time):
    module = normalizers()
    dated_row, undated_row = local_row(), local_row()
    dated_row["detail"]["sprtTrgtCn"] = "확인된 대상"
    undated_row["detail"]["sprtTrgtCn"] = "수집 시각이 알려지지 않은 훨씬 더 길고 상세한 설명"
    dated = module.normalize_service(dated_row, "local", "local-welfare", "2026-11-01", "dated-detail")
    undated = module.normalize_service(undated_row, "local", "local-welfare", unknown_time, "undated-detail")
    for items in ([dated, undated], [undated, dated]):
        result = module.merge_services(items)[0]
        assert result["target"] == "확인된 대상"
        assert result["snapshotId"] == "dated-detail"
        assert len(result["provenance"]) == 2


def test_observation_order_uses_actual_timezone_instead_of_iso_text_order():
    module = normalizers()
    earlier = module.normalize_service(local_row(), "local", "local-welfare", "2026-11-13T10:00:00+09:00", "earlier")
    later = module.normalize_service(local_row(), "local", "local-welfare", "2026-11-13T03:00:00Z", "later")
    for items in ([earlier, later], [later, earlier]):
        assert module.merge_services(items)[0]["snapshotId"] == "later"


def test_two_undated_details_keep_one_whole_observation_in_both_input_orders():
    module = normalizers()
    first_row, second_row = local_row(), local_row()
    first_row["detail"]["baslawList"] = {"wlfareInfoReldNm": "시각미상 근거 A"}
    second_row["detail"]["baslawList"] = {"wlfareInfoReldNm": "시각미상 근거 B"}
    first = module.normalize_service(first_row, "local", "local-welfare", None, "snapshot-a")
    second = module.normalize_service(second_row, "local", "local-welfare", None, "snapshot-b")
    results = [module.merge_services(items)[0] for items in ([first, second], [second, first])]
    assert results[0] == results[1]
    result = results[0]
    assert result["fetchedAt"] is None
    assert len(result["legalBases"]) == 1
    selected = first if result["snapshotId"] == "snapshot-a" else second
    assert {key: value for key, value in result.items() if key != "provenance"} == {key: value for key, value in selected.items() if key != "provenance"}


def test_missing_id_and_unknown_service_kind_are_rejected():
    module = normalizers()
    with pytest.raises(ValueError):
        module.normalize_service({"servNm": "이름만"}, "local", "source", None, "s")
    with pytest.raises(ValueError):
        module.normalize_service(local_row(), "unknown", "source", None, "s")


def test_preserves_actual_support_dates_attachments_and_related_links():
    row = local_row()
    row["detail"].update({
        "alwServCn": "연간 20만원 한도", "enfcBgngYmd": "20230101", "enfcEndYmd": "99991231", "lastModYmd": "20261110",
        "basfrmList": [{"wlfareInfoReldNm": "신청서", "wlfareInfoReldCn": "https://example.go.kr/form?id=1&serviceKey=PRIVATE"}, {"wlfareInfoReldNm": "잘못된 주소", "wlfareInfoReldCn": "javascript:alert(1)"}],
        "inqplHmpgReldList": {"wlfareInfoReldNm": "구청", "wlfareInfoReldCn": "https://example.go.kr/program"},
    })
    service = normalizers().normalize_service(row, "local", "local-welfare", None, "s")
    assert service["support"] == "연간 20만원 한도"
    assert service["serviceStartDate"] == "2023-01-01"
    assert service["serviceEndDate"] is None
    assert service["modifiedAt"] == "2026-11-10"
    assert service["attachments"] == [{"name": "신청서", "url": "https://example.go.kr/form?id=1"}, {"name": "잘못된 주소", "url": ""}]
    assert service["relatedLinks"] == [{"name": "구청", "url": "https://example.go.kr/program"}]
    assert "PRIVATE" not in json.dumps(service)


def test_real_caches_merge_to_5289_services_with_397_actual_details():
    module = normalizers()
    root = Path(__file__).resolve().parents[4]
    cache = root / "data" / "cache"
    if not cache.exists():
        pytest.skip("Existing local caches are not available")
    seoul = json.loads((cache / "local_서울특별시.json").read_text())["items"]
    nationwide = json.loads((cache / "local_list_전국.json").read_text())["items"]
    central = json.loads((cache / "central.partial.json").read_text())
    rows = [module.normalize_service(row, kind, source, None, snapshot) for kind, source, snapshot, items in [
        ("local", "local-welfare", "local-detail", seoul), ("local", "local-welfare", "local-list", nationwide),
        ("central", "central-welfare", "central-list", central),
    ] for row in items]
    merged = module.merge_services(rows)
    assert len(merged) == 5289
    assert sum(s["detailStatus"] == "collected" for s in merged) == 397
    assert sum(s["kind"] == "central" for s in merged) == 461
