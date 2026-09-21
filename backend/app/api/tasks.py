"""Development-only local working copies; no session ownership or public access claim."""

from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.datastructures import UploadFile

from app.ai.common import AIProviderError
from app.dev_extraction.uploads import LimitedUploadParser
from app.store import StoreError


class CreateTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sample_id: str = Field(min_length=1, max_length=100)


class CreateCustomTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str = Field(min_length=1, max_length=500)
    sender: str = Field(min_length=1, max_length=320)
    body: str = Field(min_length=1, max_length=50_000)

    @field_validator("subject", "sender", "body")
    @classmethod
    def reject_blank_text(cls, value: str):
        value = value.strip()
        if not value:
            raise ValueError("Enter visible text")
        return value


class AnalyzeTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)


class SelectPair(AnalyzeTask):
    si_id: str | None
    bl_id: str | None


class VisualPageEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["visual_page"]
    page: int = Field(ge=1)


class SourceUnitEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["source_unit"]
    unit_id: str = Field(min_length=1, max_length=200)


ReviewEvidence = Annotated[VisualPageEvidence | SourceUnitEvidence, Field(discriminator="kind")]


class ReviewProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_name: str = Field(min_length=1, max_length=200)
    reference: str = Field(min_length=1, max_length=1000)
    note: str | None = Field(default=None, max_length=2000)


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
    action: Literal["CONFIRM_CANDIDATE", "CORRECT_EXTRACTION", "SUPPLY_INFORMATION"]
    raw_value: str | None = Field(default=None, max_length=5000)
    evidence: ReviewEvidence | None = None
    provenance: ReviewProvenance | None = None

    @model_validator(mode="after")
    def validate_action_payload(self):
        if self.action in {"CONFIRM_CANDIDATE", "CORRECT_EXTRACTION"}:
            if not self.evidence or self.provenance is not None:
                raise ValueError("Confirm and correction actions require page evidence only.")
        elif self.evidence is not None or self.provenance is None:
            raise ValueError("Supplied information requires provenance and no page evidence.")
        return self


class CompleteTask(AnalyzeTask):
    run_id: str = Field(min_length=1)
    acknowledge_seven_field_scope: Literal[True]


class GenerateAmendment(AnalyzeTask):
    run_id: str = Field(min_length=1)
    method: Literal["gemini", "standard"]


class UpdateAmendment(AnalyzeTask):
    run_id: str = Field(min_length=1)
    recipient: str = Field(min_length=1, max_length=320)
    subject: str = Field(min_length=1, max_length=500)
    opening: str = Field(min_length=1, max_length=2000)
    closing: str = Field(min_length=1, max_length=2000)

    @field_validator("recipient", "subject", "opening", "closing")
    @classmethod
    def reject_blank_text(cls, value: str):
        value = value.strip()
        if not value:
            raise ValueError("Enter visible text")
        return value

    @field_validator("recipient", "subject")
    @classmethod
    def require_single_line(cls, value: str):
        if any(character in value for character in "\r\n"):
            raise ValueError("Use one line")
        return value


def build_task_router(settings, store, risk_provider=None):
    router = APIRouter(prefix="/api/v1/dev/tasks", tags=["local tasks"])

    def execute(operation):
        try:
            return operation()
        except AIProviderError as exc:
            raise HTTPException(
                exc.status,
                detail={
                    "code": exc.code,
                    "message": exc.message,
                    "retryable": exc.retryable,
                },
            ) from exc
        except StoreError as exc:
            detail = {
                "code": exc.code,
                "message": str(exc),
                "retryable": exc.status in {409, 503},
            }
            if exc.details is not None:
                detail["blockers"] = exc.details
            raise HTTPException(
                exc.status,
                detail=detail,
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

    @router.post("/custom")
    def create_custom(payload: CreateCustomTask, request: Request):
        guard(request)
        return execute(
            lambda: store.create_custom_task(
                payload.subject.strip(), payload.sender.strip(), payload.body.strip()
            )
        )

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

    @router.post("/{task_id}/risk-briefing")
    def risk_briefing(task_id: str, payload: AnalyzeTask, request: Request):
        """Explain confirmed discrepancies. Advisory only: nothing is stored and
        nothing here changes the comparison, the reviewed result, or completion."""
        guard(request)
        detail = execute(lambda: store.task_detail(task_id))
        if detail["revision"] != payload.expected_revision:
            raise HTTPException(
                409,
                detail={
                    "code": "stale_revision",
                    "message": "This task advanced. Reload before asking again.",
                },
            )
        run = detail.get("current_run") or {}
        result = run.get("result") or {}
        fields = {item["key"]: item for item in result.get("fields", [])}
        discrepancies = [
            (
                key,
                fields[key]["si"]["raw_value"],
                fields[key]["bl"]["raw_value"],
            )
            for key in result.get("known_defect_fields", [])
            if fields.get(key) and fields[key]["si"]["raw_value"] and fields[key]["bl"]["raw_value"]
        ]
        if not discrepancies:
            raise HTTPException(
                409,
                detail={
                    "code": "no_discrepancy",
                    "message": "This run has no confirmed discrepancy to explain.",
                },
            )
        briefing = execute(lambda: risk_provider.explain(discrepancies))
        return {
            "task_id": task_id,
            "revision": detail["revision"],
            "run_id": run.get("id"),
            "notes": [note.model_dump() for note in briefing.response.notes],
            "provider_call": {
                "operation": "risk_briefing",
                "document_id": None,
                "provider": "gemini",
                **briefing.metadata.model_dump(mode="json"),
            },
        }

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
                payload.evidence.model_dump() if payload.evidence else None,
                payload.provenance.model_dump() if payload.provenance else None,
            )
        )

    @router.post("/{task_id}/complete")
    def complete(task_id: str, payload: CompleteTask, request: Request):
        guard(request)
        return execute(
            lambda: store.record_completion(
                task_id,
                payload.expected_revision,
                payload.run_id,
                payload.acknowledge_seven_field_scope,
            )
        )

    @router.post("/{task_id}/amendment-draft")
    def generate_amendment(task_id: str, payload: GenerateAmendment, request: Request):
        guard(request)
        return execute(
            lambda: store.generate_amendment_draft(
                task_id,
                payload.expected_revision,
                payload.run_id,
                payload.method,
            )
        )

    @router.put("/{task_id}/amendment-draft/{draft_id}")
    def update_amendment(task_id: str, draft_id: str, payload: UpdateAmendment, request: Request):
        guard(request)
        return execute(
            lambda: store.update_amendment_draft(
                task_id,
                draft_id,
                payload.expected_revision,
                payload.run_id,
                payload.recipient,
                payload.subject,
                payload.opening,
                payload.closing,
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
