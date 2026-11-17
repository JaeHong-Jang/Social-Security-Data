"""Normalize observed welfare rows without treating detail codes as law IDs."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
from typing import Iterable
from urllib.parse import urlsplit

from .store import sanitize_url


def _text(value) -> str:
    return str(value).strip() if isinstance(value, (str, int, float)) else ""


def _items(value) -> list[dict]:
    if isinstance(value, dict):
        return [value]
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _url(value) -> str:
    url = sanitize_url(_text(value))
    try:
        parsed = urlsplit(url)
        return url if parsed.scheme in {"https", "http"} and parsed.netloc else ""
    except ValueError:
        return ""


def _date(value) -> str | None:
    value = _text(value)
    if not value or value == "99991231":
        return None
    try:
        return datetime.strptime(value, "%Y%m%d").date().isoformat()
    except ValueError:
        return None


def _links(value) -> list[dict]:
    return [{"name": _text(item.get("wlfareInfoReldNm")), "url": _url(item.get("wlfareInfoReldCn"))}
            for item in _items(value)]


def normalize_service(row: dict, kind: str, source_id: str,
                      fetched_at: str | None, snapshot_id: str) -> dict:
    if not isinstance(row, dict) or kind not in {"local", "central"} or not _text(row.get("servId")):
        raise ValueError("A valid welfare service identifier and kind are required")
    nested = row.get("detail")
    detail = nested if isinstance(nested, dict) else {}
    if not detail and any(key in row for key in ("sprtTrgtCn", "slctCritCn", "baslawList", "alwServCn", "aplyMtdCn")):
        detail = row
    failed = bool(detail) and _text(detail.get("resultCode")) not in {"", "0", "00", "0000"}
    detail_status = "error" if failed else "collected" if detail else "missing"
    if failed:
        detail = {}

    def field(key: str) -> str:
        return _text(detail.get(key)) or _text(row.get(key))

    if kind == "central":
        region = "전국"
        department = " ".join(filter(None, [field("jurMnofNm"), field("jurOrgNm")]))
    else:
        region = " ".join(dict.fromkeys(filter(None, [field("ctpvNm"), field("sggNm")])))
        department = field("bizChrDeptNm")
    legal_bases = [{"name": _text(item.get("wlfareInfoReldNm")),
                    "content": _text(item.get("wlfareInfoReldCn")),
                    "code": _text(item.get("wlfareInfoDtlCd"))}
                   for item in _items(detail.get("baslawList"))]
    related_links = _links(detail.get("inqplHmpgReldList"))
    source_url = _url(field("servDtlLink"))
    service = {
        "id": f"{kind}:{_text(row['servId'])}", "kind": kind, "name": field("servNm"),
        "region": region, "department": department, "summary": field("servDgst"),
        "target": _text(detail.get("sprtTrgtCn")), "criteria": _text(detail.get("slctCritCn")),
        "application": _text(detail.get("aplyMtdCn")) or field("aplyMtdNm"),
        "legalBases": legal_bases,
        "homepageUrl": next((link["url"] for link in related_links if link["url"]), source_url),
        "sourceUrl": source_url, "fetchedAt": fetched_at, "sourceId": source_id,
        "snapshotId": snapshot_id, "detailStatus": detail_status,
        "support": _text(detail.get("alwServCn")),
        "serviceStartDate": _date(field("enfcBgngYmd")), "serviceEndDate": _date(field("enfcEndYmd")),
        "modifiedAt": _date(field("lastModYmd")),
        "attachments": _links(detail.get("basfrmList")), "relatedLinks": related_links,
    }
    service["provenance"] = [{"sourceId": source_id, "snapshotId": snapshot_id,
                              "fetchedAt": fetched_at, "detailStatus": detail_status}]
    return service


def _unique(values: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for value in values:
        identity = json.dumps(value, ensure_ascii=False, sort_keys=True)
        if identity not in seen:
            result.append(value)
            seen.add(identity)
    return result


def merge_services(services: Iterable[dict]) -> list[dict]:
    """Select one observed version, keeping its content and all provenance."""
    merged: dict[str, dict] = {}

    def rank(service: dict) -> tuple:
        try:
            observed = datetime.fromisoformat(_text(service.get("fetchedAt")))
            # Legacy cache values lack an offset; retain their recorded wall-clock order.
            observed = observed.replace(tzinfo=timezone.utc) if observed.tzinfo is None else observed.astimezone(timezone.utc)
        except ValueError:
            observed = None
        content = {key: value for key, value in service.items() if key != "provenance"}
        return (service.get("detailStatus") == "collected", observed is not None,
                observed or datetime.min.replace(tzinfo=timezone.utc),
                _text(service.get("snapshotId")), json.dumps(content, ensure_ascii=False, sort_keys=True))

    for service in services:
        incoming = deepcopy(service)
        service_id = incoming.get("id")
        if not service_id:
            raise ValueError("Service identifier is required")
        if service_id not in merged:
            merged[service_id] = incoming
            continue
        existing = merged[service_id]
        primary, secondary = (incoming, existing) if rank(incoming) > rank(existing) else (existing, incoming)
        result = deepcopy(primary)
        # Empty arrays and strings can be removals in a newer detail snapshot.
        # Mixing any older fields would detach the displayed content from snapshotId.
        result["provenance"] = sorted(_unique(primary.get("provenance", []) + secondary.get("provenance", [])),
                                      key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
        merged[service_id] = result
    return list(merged.values())
