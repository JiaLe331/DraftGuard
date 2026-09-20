"""Development-only HTTP adapters; enabled explicitly by application configuration."""

from typing import Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from starlette.datastructures import UploadFile

from .dataset import Dataset, DatasetError
from .service import DocumentInput
from .uploads import LimitedUploadParser

router = APIRouter(prefix="/api/v1/dev", tags=["Local development extraction"])


def services(request: Request):
    return request.app.state.audit_store, request.app.state.run_service


def page_bounds(limit, offset):
    if limit < 1 or limit > 100 or offset < 0:
        raise DatasetError("INVALID_PAGINATION", "Use a limit of 1–100 and a nonnegative offset.")


@router.post(
    "/extract",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {
                            "file": {"type": "string", "format": "binary"},
                            "expected_role": {"type": "string", "enum": ["SI", "BL"]},
                        },
                    }
                }
            },
        }
    },
)
async def upload(request: Request, wait: bool = True):
    settings = request.app.state.settings
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise DatasetError("MULTIPART_REQUIRED", "Send the file as multipart form data.", 415)
    form = await LimitedUploadParser(request, settings.dev_upload_limit).parse()
    try:
        file = form.get("file")
        role = form.get("expected_role") or None
        if not isinstance(file, UploadFile) or not file.filename:
            raise DatasetError("FILE_REQUIRED", "Select one file to extract.")
        if role not in {None, "SI", "BL"}:
            raise DatasetError("INVALID_ROLE", "Expected role must be SI or BL.")
        if set(form) - {"file", "expected_role"} or len(form.getlist("file")) != 1:
            raise DatasetError("INVALID_FORM", "Send one file and an optional expected role.")
        content = await file.read(settings.dev_upload_limit + 1)
        filename = file.filename
    finally:
        await form.close()
    if len(content) > settings.dev_upload_limit:
        raise DatasetError("FILE_TOO_LARGE", "The file exceeds the development upload limit.", 413)
    _, service = services(request)
    result = await run_in_threadpool(
        service.run,
        [
            DocumentInput(
                filename,
                lambda: content,
                role,
                settings.dev_upload_limit,
            )
        ],
        "upload",
        filename,
        None,
        request.state.request_id,
        wait,
    )
    return JSONResponse(result, status_code=200 if wait else 202)


@router.get("/emails")
def emails(
    request: Request, q: str = "", has_attachments: bool = True, limit: int = 25, offset: int = 0
):
    page_bounds(limit, offset)
    return Dataset(request.app.state.settings.dataset_dir).list(q, has_attachments, limit, offset)


@router.get("/emails/{email_id}")
def email(request: Request, email_id: str):
    return Dataset(request.app.state.settings.dataset_dir).email(email_id)


@router.post("/emails/{email_id}/extract")
def extract_email(request: Request, email_id: str, wait: bool = True):
    dataset = Dataset(request.app.state.settings.dataset_dir)
    record = dataset.email(email_id)
    if len(record["attachments"]) > 10:
        raise DatasetError(
            "TOO_MANY_ATTACHMENTS", "An email may contain at most 10 attachments.", 413
        )
    inputs = [
        DocumentInput(reference, lambda ref=reference: dataset.attachment(ref, 10 * 1024 * 1024))
        for reference in record["attachments"]
    ]
    _, service = services(request)
    result = service.run(
        inputs, "dataset_email", record["subject"], record, request.state.request_id, wait
    )
    return JSONResponse(result, status_code=200 if wait else 202)


@router.get("/runs")
def runs(
    request: Request,
    limit: int = 25,
    offset: int = 0,
    q: str = "",
    status: Literal["RUNNING", "SUCCEEDED", "FAILED", "INTERRUPTED"] | None = None,
    source_type: Literal["upload", "dataset_email"] | None = None,
    needs_review: bool | None = None,
):
    page_bounds(limit, offset)
    store, _ = services(request)
    return store.list(limit, offset, q, status, source_type, needs_review)


@router.get("/runs/{run_id}/events")
def events(request: Request, run_id: UUID, after_sequence: int = 0, limit: int = 100):
    if after_sequence < 0 or not 1 <= limit <= 500:
        raise DatasetError("INVALID_PAGINATION", "Use a nonnegative cursor and a limit of 1–500.")
    store, service = services(request)
    service.check_recording(str(run_id))
    result = store.events(str(run_id), after_sequence, limit)
    if result is None:
        raise DatasetError("RUN_NOT_FOUND", "The extraction run was not found.", 404)
    return result


@router.get("/runs/{run_id}")
def run(request: Request, run_id: UUID, download: bool = False):
    store, service = services(request)
    service.check_recording(str(run_id))
    result = store.get(str(run_id))
    if result is None:
        raise DatasetError("RUN_NOT_FOUND", "The extraction run was not found.", 404)
    if download:
        return JSONResponse(
            result,
            headers={
                "Content-Disposition": f'attachment; filename="extraction-{run_id}.json"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    return result


@router.get("/runs/{run_id}/documents/{document_id}/original")
def original(
    request: Request,
    run_id: UUID,
    document_id: UUID,
    disposition: Literal["inline", "attachment"] = "attachment",
):
    store, _ = services(request)
    source = store.original(str(run_id), str(document_id))
    if source is None:
        raise DatasetError(
            "DOCUMENT_NOT_FOUND", "The source document was not found in this run.", 404
        )
    data = source["content"]
    saved = store.get(str(run_id))
    document = next(d for d in saved["documents"] if d["document_id"] == str(document_id))
    result = document["result"]
    is_pdf = bool(
        result
        and result["detected_format"] == "pdf"
        and result["parsing_status"]
        in {
            "READABLE",
            "NO_USABLE_TEXT",
        }
    )
    mode = "inline" if is_pdf and disposition == "inline" else "attachment"
    return Response(
        data,
        media_type="application/pdf" if is_pdf else "application/octet-stream",
        headers={
            "Content-Disposition": f"{mode}; filename*=UTF-8''{quote(source['filename'])}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )
