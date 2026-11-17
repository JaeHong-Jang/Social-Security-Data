"""Read-only API for locally collected public evidence.

Run from the repository root:
  .venv/bin/python -m prototype.ordinance_impact.api.server
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query

from .store import SnapshotStore


PREFIX = "/api/ordinance-impact"
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "ordinance_impact"


def create_app(data_dir: str | Path | None = None) -> FastAPI:
    app = FastAPI(title="조례 변경 영향 추적 공개자료", docs_url=None, redoc_url=None, openapi_url=None)
    store = SnapshotStore(data_dir if data_dir is not None else os.environ.get("ORDINANCE_DATA_DIR", str(DEFAULT_DATA_DIR)))

    @app.middleware("http")
    async def secure_json(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def catalog() -> dict:
        try:
            return store.load_catalog()
        except (OSError, ValueError, TypeError):
            raise HTTPException(503, "공개자료를 읽을 수 없습니다. 수집 상태를 확인해 주세요.") from None

    @app.get(f"{PREFIX}/health")
    def health():
        data = catalog()
        return {"status": "ok", "hasData": any(data[key] for key in ("services", "documents", "statistics"))}

    @app.get(f"{PREFIX}/catalog")
    def get_catalog():
        data = catalog()
        services = data["services"]
        summary = {
            "services": len(services), "localServices": sum(s.get("kind") == "local" for s in services),
            "centralServices": sum(s.get("kind") == "central" for s in services),
            "detailedServices": sum(s.get("detailStatus") == "collected" for s in services),
            "legalBases": sum(len(s.get("legalBases", [])) for s in services),
            "documents": len(data["documents"]), "statistics": len(data["statistics"]),
        }
        return {**{key: value for key, value in data.items() if key != "services"}, "summary": summary}

    @app.get(f"{PREFIX}/services")
    def get_services(query: str = "", kind: Literal["all", "local", "central"] = "all", region: str = "",
                     legalOnly: bool = False, page: int = Query(1, ge=1), pageSize: int = Query(40, ge=1)):
        services = catalog()["services"]
        query_text = query.strip().casefold()
        region_text = region.strip().casefold()
        results = []
        for service in services:
            if kind != "all" and service.get("kind") != kind:
                continue
            if region_text and region_text not in service.get("region", "").casefold():
                continue
            if legalOnly and not service.get("legalBases"):
                continue
            search = " ".join([service.get("name", ""), service.get("region", ""),
                               *(base.get("name", "") + " " + base.get("content", "") for base in service.get("legalBases", []))])
            if query_text and query_text not in search.casefold():
                continue
            results.append(service)
        pageSize = min(pageSize, 100)
        offset = (page - 1) * pageSize
        return {"items": results[offset:offset + pageSize], "total": len(results), "page": page, "pageSize": pageSize}

    @app.get(f"{PREFIX}/services/{{service_id}}")
    def get_service(service_id: str):
        data = catalog()
        service = next((item for item in data["services"] if item.get("id") == service_id), None)
        if service is None:
            raise HTTPException(404, "사업을 찾을 수 없습니다.")
        documents = [document for document in data["documents"] if service_id in document.get("relatedServiceIds", [])]
        return {**service, "documents": documents}

    @app.get(f"{PREFIX}/documents/{{document_id}}")
    def get_document(document_id: str):
        document = next((item for item in catalog()["documents"] if item.get("id") == document_id), None)
        if document is None:
            raise HTTPException(404, "문서를 찾을 수 없습니다.")
        return document

    @app.get(f"{PREFIX}/snapshots/{{snapshot_id}}")
    def get_snapshot(snapshot_id: str):
        try:
            return store.read(snapshot_id)
        except FileNotFoundError:
            raise HTTPException(404, "스냅샷을 찾을 수 없습니다.") from None
        except ValueError:
            raise HTTPException(404, "스냅샷을 찾을 수 없습니다.") from None
        except OSError:
            raise HTTPException(503, "스냅샷을 읽을 수 없습니다.") from None

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8788)
