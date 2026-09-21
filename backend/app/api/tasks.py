"""Development-only local working copies; no session ownership or public access claim."""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import UploadFile

from app.dev_extraction.uploads import LimitedUploadParser
from app.store import StoreError


class CreateTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sample_id: str = Field(min_length=1, max_length=100)


class AnalyzeTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)


class SelectPair(AnalyzeTask):
    si_id: str | None
    bl_id: str | None


class ReviewEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1)


class ReviewTask(AnalyzeTask):
    run_id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    field: Literal[
        "shipper",
        "consignee",
        "notify_party",
        "port_of_loading",
        "port_of_discharge",
        "container_count",
        "gross_weight_kg",
    ]
    action: Literal["CONFIRM_CANDIDATE", "CORRECT_EXTRACTION"]
    raw_value: str | None = Field(default=None, max_length=5000)
    evidence: ReviewEvidence


def build_task_router(settings, store):
    router = APIRouter(prefix="/api/v1/dev/tasks", tags=["local tasks"])

    def execute(operation):
        try:
            return operation()
        except StoreError as exc:
            raise HTTPException(
                exc.status,
                detail={
                    "code": exc.code,
                    "message": str(exc),
                    "retryable": exc.status in {409, 503},
                },
            ) from exc

    def guard(request):
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins:
            raise HTTPException(
                403, detail={"code": "origin_denied", "message": "This origin is not allowed."}
            )

    @router.post("")
    def create(payload: CreateTask, request: Request):
        guard(request)
        return execute(lambda: store.clone_task(payload.sample_id))

    @router.get("")
    def listing(page: int = Query(default=1, ge=1), limit: int = Query(default=50, ge=1, le=100)):
        return execute(lambda: store.list_tasks(page, limit))

    @router.get("/{task_id}")
    def detail(task_id: str):
        return execute(lambda: store.task_detail(task_id))

    @router.post("/{task_id}/documents")
    async def upload(task_id: str, request: Request):
        guard(request)
        execute(lambda: store.task_detail(task_id))
        if not request.headers.get("content-type", "").startswith("multipart/form-data"):
            raise HTTPException(
                415,
                detail={
                    "code": "multipart_required",
                    "message": "Send a document as multipart form data.",
                },
            )
        form = await LimitedUploadParser(request, settings.dev_upload_limit, max_fields=2).parse()
        try:
            file = form.get("file")
            role = form.get("role")
            revision = form.get("expected_revision")
            if set(form) != {"file", "role", "expected_revision"} or any(
                len(form.getlist(key)) != 1 for key in form
            ):
                raise HTTPException(
                    422,
                    detail={
                        "code": "invalid_form",
                        "message": "Send one file, role, and expected_revision.",
                    },
                )
            if (
                not isinstance(file, UploadFile)
                or not file.filename
                or role not in {"si", "bl"}
                or not isinstance(revision, str)
                or not revision.isdigit()
                or int(revision) < 1
            ):
                raise HTTPException(
                    422,
                    detail={
                        "code": "invalid_form",
                        "message": "Choose one source, SI or BL, and a current revision.",
                    },
                )
            content = await file.read(settings.dev_upload_limit + 1)
            filename = file.filename
        finally:
            await form.close()
        return await run_in_threadpool(
            lambda: execute(
                lambda: store.replace_document(
                    task_id, int(revision), role, filename, content, settings.dev_upload_limit
                )
            )
        )

    @router.post("/{task_id}/pair")
    def pair(task_id: str, payload: SelectPair, request: Request):
        guard(request)
        return execute(
            lambda: store.select_pair(
                task_id, payload.expected_revision, payload.si_id, payload.bl_id
            )
        )

    @router.post("/{task_id}/analyze")
    def analyze(task_id: str, payload: AnalyzeTask, request: Request, wait: bool = True):
        guard(request)
        execute(lambda: store.task_detail(task_id))
        result = execute(
            lambda: store.analyze(
                task_id, payload.expected_revision, request_id=request.state.request_id, wait=wait
            )
        )
        return JSONResponse(result, status_code=200 if wait else 202)

    @router.post("/{task_id}/reviews")
    def review(task_id: str, payload: ReviewTask, request: Request):
        guard(request)
        return execute(
            lambda: store.record_review(
                task_id,
                payload.expected_revision,
                payload.run_id,
                payload.document_id,
                payload.field,
                payload.action,
                payload.raw_value,
                payload.evidence.page,
            )
        )

    @router.get("/{task_id}/runs/{run_id}")
    def history(task_id: str, run_id: str):
        return execute(lambda: store.task_run_detail(task_id, run_id))

    @router.get("/{task_id}/documents/{document_id}/content")
    def content(task_id: str, document_id: str, download: bool = False):
        execute(lambda: store.task_detail(task_id))
        document, path = execute(lambda: store.get_document(task_id, document_id))
        media_type = {
            ".pdf": "application/pdf",
            ".txt": "text/plain; charset=utf-8",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }[Path(document["filename"]).suffix.lower()]
        return FileResponse(
            path,
            filename=document["filename"],
            media_type=media_type,
            content_disposition_type="inline"
            if not download and media_type.startswith(("application/pdf", "text/plain"))
            else "attachment",
            headers={
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "frame-ancestors 'self'",
            },
        )

    return router
