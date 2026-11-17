"""Evidence preservation and credential boundary tests."""

import hashlib
import importlib
import json

import pytest


def store_module():
    name = "prototype.ordinance_impact.api.store"
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError:
        pytest.fail("SnapshotStore has not been implemented")


def test_snapshot_preserves_exact_bytes_hashes_and_unknown_observation_time(tmp_path):
    store = store_module().SnapshotStore(tmp_path)
    raw = "<body>조례</body>".encode("utf-8")
    saved = store.save("official", "https://example.go.kr/doc?id=2", raw, "조례 본문", "text/html")
    assert saved["rawSha256"] == hashlib.sha256(raw).hexdigest()
    assert saved["textSha256"] == hashlib.sha256("조례 본문".encode()).hexdigest()
    assert saved["fetchedAt"] is None
    assert saved["extractedAt"]
    assert (tmp_path / "raw" / f"{saved['rawSha256']}.bin").read_bytes() == raw
    assert store.read(saved["id"])["text"] == "조례 본문"


def test_snapshot_repeated_capture_does_not_overwrite_original_evidence(tmp_path):
    store = store_module().SnapshotStore(tmp_path)
    first = store.save("official", "https://example.go.kr/doc", b"same", "first extraction", "text/plain", "2026-11-13T00:00:00+09:00")
    again = store.save("official", "https://example.go.kr/doc", b"same", "first extraction", "text/plain", "2026-11-13T00:00:00+09:00")
    changed = store.save("official", "https://example.go.kr/doc", b"same", "improved extraction", "text/plain", "2026-11-13T00:00:00+09:00")
    assert again == first
    assert changed["id"] != first["id"]
    assert changed["rawSha256"] == first["rawSha256"]
    assert store.read(first["id"])["text"] == "first extraction"


def test_store_removes_authentication_from_snapshot_and_catalog_urls(tmp_path):
    store = store_module().SnapshotStore(tmp_path)
    sensitive_url = "https://user:password@example.go.kr/doc?serviceKey=PRIVATE&OC=PRIVATE&token=PRIVATE&id=2#section"
    saved = store.save("official", sensitive_url, b"body", "body", "text/plain")
    assert saved["sourceUrl"] == "https://example.go.kr/doc?id=2#section"
    catalog = store.load_catalog()
    catalog["sources"] = [{"id": "a", "homepageUrl": sensitive_url}]
    store.save_catalog(catalog)
    assert "PRIVATE" not in (tmp_path / "catalog.json").read_text()
    assert "password" not in json.dumps(store.read(saved["id"]))


def test_public_local_government_menu_key_survives_credential_removal(tmp_path):
    store = store_module().SnapshotStore(tmp_path)
    snapshot = store.save("public-guidance", "https://www.sd.go.kr/main/contents.do?key=5353&apiKey=PRIVATE", b"public", "public", "text/html")
    assert snapshot["sourceUrl"] == "https://www.sd.go.kr/main/contents.do?key=5353"


def test_catalog_replacement_keeps_valid_json_and_supplied_observation_dates(tmp_path):
    store = store_module().SnapshotStore(tmp_path)
    catalog = store.load_catalog()
    assert catalog["schemaVersion"] == 1
    assert all(catalog[name] == [] for name in ("sources", "services", "documents", "statistics"))
    catalog["generatedAt"] = "2026-11-17T00:00:00Z"
    catalog["sources"] = [{"id": "legacy", "fetchedAt": None}]
    store.save_catalog(catalog)
    assert store.load_catalog() == catalog
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.parametrize("snapshot_id", ["../catalog", "../catalog.json", "/etc/passwd", "x" * 64])
def test_snapshot_read_rejects_arbitrary_paths(tmp_path, snapshot_id):
    store = store_module().SnapshotStore(tmp_path)
    with pytest.raises((ValueError, FileNotFoundError)):
        store.read(snapshot_id)


def test_snapshot_rejects_symlink_escape_and_modified_text(tmp_path):
    store = store_module().SnapshotStore(tmp_path / "data")
    saved = store.save("official", "https://example.go.kr/doc", b"raw", "safe", "text/plain")
    text_path = tmp_path / "data" / "texts" / f"{saved['textSha256']}.txt"
    text_path.write_text("tampered", encoding="utf-8")
    with pytest.raises(ValueError):
        store.read(saved["id"])
    text_path.unlink()
    outside = tmp_path / "outside.txt"
    outside.write_text("safe", encoding="utf-8")
    text_path.symlink_to(outside)
    with pytest.raises(ValueError):
        store.read(saved["id"])


def test_snapshot_detects_modified_raw_bytes(tmp_path):
    store = store_module().SnapshotStore(tmp_path)
    saved = store.save("official", "https://example.go.kr/doc", b"original", "text", "text/plain")
    (tmp_path / "raw" / f"{saved['rawSha256']}.bin").write_bytes(b"tampered")
    with pytest.raises(ValueError):
        store.read(saved["id"])


def test_snapshot_read_returns_only_contract_metadata_and_text(tmp_path):
    store = store_module().SnapshotStore(tmp_path)
    saved = store.save("official", "https://example.go.kr/doc", b"original", "text", "text/plain")
    path = tmp_path / "snapshots" / f"{saved['id']}.json"
    metadata = json.loads(path.read_text())
    metadata["raw"] = "UNEXPECTED PRIVATE DATA"
    path.write_text(json.dumps(metadata), encoding="utf-8")
    assert "raw" not in store.read(saved["id"])
