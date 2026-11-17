"""Immutable source bytes and extracted text with an atomic JSON catalog."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_HASH = re.compile(r"^[a-f0-9]{64}$")
_AUTH_QUERY_KEYS = {
    "servicekey", "apikey", "token", "accesstoken", "refreshtoken",
    "authorization", "auth", "authkey", "clientsecret", "password", "oc",
}
_IDENTITY_FIELDS = ("sourceId", "sourceUrl", "rawSha256", "textSha256", "fetchedAt", "contentType")
_SNAPSHOT_FIELDS = ("id", *_IDENTITY_FIELDS, "extractedAt", "rawBytes", "textBytes", "parserVersion")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_url(value: str) -> str:
    """Remove URL credentials and authentication queries before persistence."""
    if not value:
        return ""
    try:
        parts = urlsplit(str(value))
        host = parts.netloc.rsplit("@", 1)[-1]
        query = [(key, item) for key, item in parse_qsl(parts.query, keep_blank_values=True)
                 if re.sub(r"[^a-z0-9]", "", key.casefold()) not in _AUTH_QUERY_KEYS]
        return urlunsplit((parts.scheme, host, parts.path, urlencode(query), parts.fragment))
    except ValueError:
        return ""


def _safe_urls(value):
    if isinstance(value, list):
        return [_safe_urls(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_url(item) if isinstance(item, str) and key.casefold().endswith("url")
                else _safe_urls(item) for key, item in value.items()}
    return value


def _json_bytes(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _validate_catalog(catalog: dict) -> None:
    if not isinstance(catalog, dict) or catalog.get("schemaVersion") != 1:
        raise ValueError("Unsupported catalog")
    for key in ("sources", "services", "documents", "statistics"):
        values = catalog.get(key)
        if not isinstance(values, list) or any(not isinstance(value, dict) for value in values):
            raise ValueError("Invalid catalog collections")
    for service in catalog["services"]:
        if any(key in service and not isinstance(service[key], str) for key in ("id", "name", "region", "kind")):
            raise ValueError("Invalid service fields")
        bases = service.get("legalBases", [])
        if not isinstance(bases, list) or any(not isinstance(base, dict) or
                any(key in base and not isinstance(base[key], str) for key in ("name", "content", "code")) for base in bases):
            raise ValueError("Invalid legal references")
    for document in catalog["documents"]:
        related = document.get("relatedServiceIds", [])
        if not isinstance(related, list) or any(not isinstance(value, str) for value in related):
            raise ValueError("Invalid document links")


class SnapshotStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()

    def _path(self, relative: str) -> Path:
        path = self.root / relative
        if not path.resolve().is_relative_to(self.root):
            raise ValueError("Invalid evidence path")
        return path

    def _write(self, relative: str, content: bytes, *, replace: bool = False) -> None:
        path = self._path(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".write-", suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            if replace:
                os.replace(temporary, path)
            else:
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    if path.read_bytes() != content:
                        raise ValueError("Existing evidence does not match its hash") from None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def save(self, source_id: str, source_url: str, raw: bytes, text: str,
             content_type: str, fetched_at: str | None = None) -> dict:
        if not isinstance(raw, bytes) or not isinstance(text, str):
            raise TypeError("Source bytes and extracted text are required")
        text_bytes = text.encode("utf-8")
        clean_url = sanitize_url(source_url)
        raw_hash = hashlib.sha256(raw).hexdigest()
        text_hash = hashlib.sha256(text_bytes).hexdigest()
        identity = {"sourceId": source_id, "sourceUrl": clean_url, "rawSha256": raw_hash,
                    "textSha256": text_hash, "fetchedAt": fetched_at, "contentType": content_type}
        snapshot_id = hashlib.sha256(_json_bytes(identity)).hexdigest()
        metadata_path = self._path(f"snapshots/{snapshot_id}.json")
        if metadata_path.exists():
            return self.read(snapshot_id)
        metadata = {"id": snapshot_id, **identity, "extractedAt": utc_now(),
                    "rawBytes": len(raw), "textBytes": len(text_bytes), "parserVersion": "plain-text-v1"}
        self._write(f"raw/{raw_hash}.bin", raw)
        self._write(f"texts/{text_hash}.txt", text_bytes)
        self._write(f"snapshots/{snapshot_id}.json", _json_bytes(metadata))
        return {**metadata, "text": text}

    def read(self, snapshot_id: str) -> dict:
        if not isinstance(snapshot_id, str) or not _HASH.fullmatch(snapshot_id):
            raise ValueError("Invalid snapshot identifier")
        metadata = json.loads(self._path(f"snapshots/{snapshot_id}.json").read_text(encoding="utf-8"))
        if not isinstance(metadata, dict) or metadata.get("id") != snapshot_id:
            raise ValueError("Invalid snapshot metadata")
        text_hash = metadata.get("textSha256", "")
        raw_hash = metadata.get("rawSha256", "")
        if any(not isinstance(value, str) or not _HASH.fullmatch(value) for value in (text_hash, raw_hash)):
            raise ValueError("Invalid snapshot digest")
        if any(key not in metadata for key in _SNAPSHOT_FIELDS):
            raise ValueError("Incomplete snapshot metadata")
        identity = {key: metadata[key] for key in _IDENTITY_FIELDS}
        if hashlib.sha256(_json_bytes(identity)).hexdigest() != snapshot_id:
            raise ValueError("Snapshot metadata integrity check failed")
        raw_bytes = self._path(f"raw/{raw_hash}.bin").read_bytes()
        if hashlib.sha256(raw_bytes).hexdigest() != raw_hash:
            raise ValueError("Stored source integrity check failed")
        text_bytes = self._path(f"texts/{text_hash}.txt").read_bytes()
        if hashlib.sha256(text_bytes).hexdigest() != text_hash:
            raise ValueError("Stored text integrity check failed")
        return {**{key: metadata[key] for key in _SNAPSHOT_FIELDS}, "text": text_bytes.decode("utf-8")}

    def load_catalog(self) -> dict:
        path = self._path("catalog.json")
        if not path.exists():
            return {"schemaVersion": 1, "generatedAt": None,
                    "sources": [], "services": [], "documents": [], "statistics": []}
        catalog = json.loads(path.read_text(encoding="utf-8"))
        _validate_catalog(catalog)
        return catalog

    def save_catalog(self, catalog: dict) -> None:
        _validate_catalog(catalog)
        self._write("catalog.json", _json_bytes(_safe_urls(catalog)), replace=True)
