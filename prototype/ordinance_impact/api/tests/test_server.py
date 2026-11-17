import importlib
import json

from fastapi.testclient import TestClient
import pytest


PREFIX = "/api/ordinance-impact"


def modules():
    try:
        return (importlib.import_module("prototype.ordinance_impact.api.server"), importlib.import_module("prototype.ordinance_impact.api.store"))
    except ModuleNotFoundError:
        pytest.fail("Read-only public data API has not been implemented")


def make_client(tmp_path):
    server, store_module = modules()
    store = store_module.SnapshotStore(tmp_path)
    snapshot = store.save("official", "https://example.go.kr/doc", b"<script>alert(1)</script>", "원문", "text/html", "2026-11-13T00:00:00+09:00")
    catalog = store.load_catalog()
    catalog["services"] = [
        {"id": "local:W1", "kind": "local", "name": "청년 지원", "region": "서울특별시 성동구", "detailStatus": "collected", "legalBases": [{"name": "청년 조례", "content": "제3조", "code": "030"}]},
        {"id": "local:W2", "kind": "local", "name": "아동 지원", "region": "부산광역시", "detailStatus": "missing", "legalBases": []},
        {"id": "central:W1", "kind": "central", "name": "생리용품 지원", "region": "전국", "detailStatus": "missing", "legalBases": []},
    ]
    catalog["sources"] = [{"id": "official", "status": "cache", "fetchedAt": None}]
    catalog["documents"] = [{"id": "doc-1", "kind": "ordinance", "title": "조례", "text": "<script>alert(1)</script>", "relatedServiceIds": ["local:W1"], "snapshotId": snapshot["id"], "relationStatus": "candidate"}]
    catalog["statistics"] = [{"id": "stat-1", "title": "공개통계"}]
    store.save_catalog(catalog)
    return TestClient(server.create_app(tmp_path)), snapshot


def test_missing_catalog_returns_honest_empty_data(tmp_path):
    server, _ = modules()
    client = TestClient(server.create_app(tmp_path))
    health = client.get(f"{PREFIX}/health")
    assert health.status_code == 200
    assert health.json()["hasData"] is False
    assert client.get(f"{PREFIX}/services").json() == {"items": [], "total": 0, "page": 1, "pageSize": 40}
    assert client.get(f"{PREFIX}/catalog").json()["summary"]["services"] == 0


def test_catalog_counts_actual_details_and_excludes_large_service_list(tmp_path):
    client, _ = make_client(tmp_path)
    response = client.get(f"{PREFIX}/catalog")
    assert response.status_code == 200
    catalog = response.json()
    assert "services" not in catalog
    assert catalog["summary"] == {"services": 3, "localServices": 2, "centralServices": 1, "detailedServices": 1, "legalBases": 1, "documents": 1, "statistics": 1}
    assert catalog["sources"][0]["fetchedAt"] is None


def test_services_searches_legal_names_and_combines_kind_region_and_legal_filters(tmp_path):
    client, _ = make_client(tmp_path)
    response = client.get(f"{PREFIX}/services", params={"query": "조례", "kind": "local", "region": "성동구", "legalOnly": "true"})
    assert response.status_code == 200
    assert [s["id"] for s in response.json()["items"]] == ["local:W1"]
    assert client.get(f"{PREFIX}/services", params={"kind": "central"}).json()["total"] == 1
    assert client.get(f"{PREFIX}/services", params={"query": "부산"}).json()["total"] == 1


def test_services_paginates_validates_boundaries_and_caps_page_size(tmp_path):
    client, _ = make_client(tmp_path)
    page = client.get(f"{PREFIX}/services", params={"page": 2, "pageSize": 2}).json()
    assert page["total"] == 3
    assert [s["id"] for s in page["items"]] == ["central:W1"]
    assert client.get(f"{PREFIX}/services", params={"page": 5}).json()["items"] == []
    assert client.get(f"{PREFIX}/services", params={"pageSize": 1000}).json()["pageSize"] == 100
    for params in ({"page": 0}, {"pageSize": 0}, {"kind": "invented"}):
        assert client.get(f"{PREFIX}/services", params=params).status_code == 422


def test_service_detail_preserves_candidate_document_relationship(tmp_path):
    client, _ = make_client(tmp_path)
    response = client.get(f"{PREFIX}/services/local:W1")
    assert response.status_code == 200
    assert response.json()["id"] == "local:W1"
    assert response.json()["documents"][0]["relationStatus"] == "candidate"
    assert client.get(f"{PREFIX}/services/local:W2").json()["documents"] == []


def test_document_and_snapshot_are_json_and_never_serve_original_html(tmp_path):
    client, snapshot = make_client(tmp_path)
    document = client.get(f"{PREFIX}/documents/doc-1")
    assert document.headers["content-type"].startswith("application/json")
    assert document.json()["text"] == "<script>alert(1)</script>"
    response = client.get(f"{PREFIX}/snapshots/{snapshot['id']}")
    assert response.status_code == 200
    assert response.json()["text"] == "원문"
    assert "raw" not in response.json()
    assert response.headers["x-content-type-options"] == "nosniff"


def test_missing_and_traversal_requests_do_not_expose_files_or_internal_errors(tmp_path):
    client, _ = make_client(tmp_path)
    for endpoint in ("services/missing", "documents/missing", "snapshots/missing", "snapshots/..%2Fcatalog.json"):
        response = client.get(f"{PREFIX}/{endpoint}")
        assert response.status_code == 404
        assert str(tmp_path) not in response.text
    (tmp_path / "catalog.json").write_text('{"secret":"PRIVATE", broken', encoding="utf-8")
    response = client.get(f"{PREFIX}/catalog")
    assert response.status_code == 503
    assert "PRIVATE" not in response.text
    assert str(tmp_path) not in response.text


def test_api_has_no_mutation_routes_and_reloads_replaced_catalog(tmp_path):
    client, _ = make_client(tmp_path)
    _, store_module = modules()
    store = store_module.SnapshotStore(tmp_path)
    catalog = store.load_catalog()
    catalog["services"] = []
    store.save_catalog(catalog)
    assert client.get(f"{PREFIX}/services").json()["total"] == 0
    assert client.post(f"{PREFIX}/services", json={}).status_code == 405


def test_malformed_collection_entries_return_generic_unavailable_response(tmp_path):
    client, _ = make_client(tmp_path)
    catalog_path = tmp_path / "catalog.json"
    catalog = json.loads(catalog_path.read_text())
    catalog["services"] = ["PRIVATE"]
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    response = client.get(f"{PREFIX}/services")
    assert response.status_code == 503
    assert "PRIVATE" not in response.text


def test_corrupt_snapshot_metadata_returns_generic_failure(tmp_path):
    client, snapshot = make_client(tmp_path)
    path = tmp_path / "snapshots" / f"{snapshot['id']}.json"
    metadata = json.loads(path.read_text())
    metadata["textSha256"] = None
    path.write_text(json.dumps(metadata), encoding="utf-8")
    response = client.get(f"{PREFIX}/snapshots/{snapshot['id']}")
    assert response.status_code == 404
    assert str(tmp_path) not in response.text
