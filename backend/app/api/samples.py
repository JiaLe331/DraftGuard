from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.config import Settings
from app.store import Store, StoreError


class AnalysisRequest(BaseModel):
    expected_revision: int = Field(ge=1)


def build_router(settings: Settings, store: Store) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def run(operation):
        try:
            return operation()
        except StoreError as exc:
            raise HTTPException(
                exc.status,
                detail={
                    "code": exc.code,
                    "message": str(exc),
                    "retryable": exc.status in {409, 503},
                    "request_id": str(uuid4()),
                },
            ) from exc

    @router.get("/samples")
    def samples(
        q: Annotated[str, Query(max_length=500)] = "",
        category: Literal[
            "", "BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM", "UNCLASSIFIED"
        ] = "",
        status: Literal[
            "",
            "ATTENTION",
            "NOT_ANALYZED",
            "WAITING_DOCUMENT",
            "REVIEW_REQUIRED",
            "DISCREPANCIES_FOUND",
            "READY",
            "NOT_APPLICABLE",
            "FAILED",
            "RUNNING",
        ] = "",
        page: Annotated[int, Query(ge=1)] = 1,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ):
        return run(lambda: store.list_samples(q, category, status, page, limit))

    @router.get("/samples/{email_id}")
    def detail(email_id: str):
        return run(lambda: store.detail(email_id))

    @router.get("/samples/{email_id}/documents/{document_id}/content")
    def content(email_id: str, document_id: str):
        doc, path = run(lambda: store.get_document(email_id, document_id))
        media_type = {
            ".pdf": "application/pdf",
            ".txt": "text/plain; charset=utf-8",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }[Path(doc["filename"]).suffix.lower()]
        return FileResponse(
            path,
            filename=doc["filename"],
            media_type=media_type,
            content_disposition_type="inline"
            if media_type.startswith(("application/pdf", "text/plain"))
            else "attachment",
            headers={
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "frame-ancestors 'self'",
            },
        )

    @router.post("/dev/samples/{email_id}/analyze")
    def reanalyze(email_id: str, payload: AnalysisRequest, request: Request, wait: bool = True):
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins:
            raise HTTPException(
                403, detail={"code": "origin_denied", "message": "This origin is not allowed."}
            )
        result = run(
            lambda: store.analyze(
                email_id, payload.expected_revision, request_id=request.state.request_id, wait=wait
            )
        )
        return JSONResponse(result, status_code=200 if wait else 202)

    return router
