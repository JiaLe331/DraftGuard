"""Shared run orchestration; HTTP requests do not own the lifetime of extraction."""

import logging
import sqlite3
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from hashlib import sha256
from pathlib import PureWindowsPath
from time import perf_counter
from uuid import uuid4

from app.config import Settings
from app.extraction.models import SourceUnit

from .dataset import DatasetError
from .process import run_worker
from .store import AuditStore, event, interrupt, now

logger = logging.getLogger(__name__)


@dataclass
class DocumentInput:
    filename: str
    read: Callable[[], bytes]
    expected_role: str | None = None
    max_file_bytes: int = 10 * 1024 * 1024
    document_id: str | None = None


class RunService:
    def __init__(self, store: AuditStore, settings: Settings):
        self.store, self.settings = store, settings
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="extraction")
        self.capacity = threading.BoundedSemaphore(2)
        self.stopping = threading.Event()
        self.lock = threading.Lock()
        self.recording_failures = set()
        self.failure_workflows = {}

    def shutdown(self):
        self.stopping.set()
        self.executor.shutdown(wait=True)

    def check_recording(self, run_id):
        with self.lock:
            failed = run_id in self.recording_failures
        if failed:
            # A read retry may finalize the failure once storage becomes writable again.
            try:
                saved = self.store.get(run_id)
                if saved and saved["processing_status"] == "RUNNING":
                    self._fail(
                        saved,
                        "AUDIT_SAVE_FAILED",
                        "Audit recording failed; extraction stopped.",
                        self.failure_workflows.get(run_id),
                    )
                elif saved:
                    with self.lock:
                        self.recording_failures.discard(run_id)
            except sqlite3.Error:
                pass
            with self.lock:
                failed = run_id in self.recording_failures
        if failed:
            raise DatasetError(
                "AUDIT_SAVE_FAILED",
                "Audit recording failed. The run did not complete successfully.",
                503,
            )

    def run(
        self,
        inputs,
        source_type,
        source_label,
        email,
        request_id,
        wait=True,
        *,
        workflow=None,
        run_id=None,
    ):
        self.store.ensure_initialized()
        if self.stopping.is_set() or not self.capacity.acquire(blocking=False):
            raise DatasetError(
                "EXTRACTION_BUSY",
                "Two extractions are already active or the backend is stopping. Try again shortly.",
                503,
            )
        run, start = None, perf_counter()
        submitted = False
        try:
            run = {
                "run_id": run_id or str(uuid4()),
                "request_id": request_id,
                "source_type": source_type,
                "source_label": source_label,
                "email": email,
                "created_at": now(),
                "finished_at": None,
                "processing_status": "RUNNING",
                "needs_review": True,
                "document_count": len(inputs),
                "pipeline_version": workflow.pipeline_version if workflow else "rules-1",
                "audit_version": 2,
                "issues": [],
                "documents": [],
            }
            if workflow:
                run["mailbox"] = workflow.context
            for source in inputs:
                run["documents"].append(
                    {
                        "document_id": source.document_id or str(uuid4()),
                        "filename": PureWindowsPath(source.filename).name,
                        "expected_role": source.expected_role,
                        "content_sha256": None,
                        "byte_count": None,
                        "has_original": False,
                        "processing_status": "PENDING",
                        "result": None,
                        "events": [],
                        "source_units": [],
                        "error": None,
                        "last_completed_stage": None,
                    }
                )
            self.store.create(
                run,
                [
                    event(
                        "run",
                        "STARTED",
                        "Extraction run created.",
                        source_type=source_type,
                        document_count=len(inputs),
                    )
                ],
                commit=workflow.created if workflow else None,
            )
            # Uploaded bytes must outlive their request before acceptance is returned.
            if source_type == "upload":
                self._read(run, run["documents"][0], inputs[0], start)
            initial = self.store.get(run["run_id"])
            future = self.executor.submit(self._execute, run, inputs, start, workflow)
            submitted = True
            future.add_done_callback(lambda _: self.capacity.release())
        except Exception:
            if run is not None:
                self._fail(
                    run, "AUDIT_SAVE_FAILED", "The run could not be accepted safely.", workflow
                )
            raise
        finally:
            if not submitted:
                self.capacity.release()
        return future.result() if wait else initial

    def _record(self, run, document, stage, status, message, start, *, commit=None, **details):
        record = event(stage, status, message, **details)
        record["elapsed_ms"] = round((perf_counter() - start) * 1000, 3)
        record["document_id"] = document["document_id"] if document else None
        self.store.save(run, [record], commit=commit)

    def _read(self, run, document, source, start):
        if document["has_original"]:
            return self.store.original(run["run_id"], document["document_id"])["content"]
        began = perf_counter()
        self._record(
            run, document, "attachment_read", "STARTED", "Reading attachment bytes.", start
        )
        content = source.read()
        if len(content) > source.max_file_bytes:
            raise DatasetError("RESOURCE_LIMIT", "The attachment exceeds the document size limit.")
        document.update(
            content_sha256=sha256(content).hexdigest(), byte_count=len(content), has_original=True
        )
        record = event(
            "original_storage",
            "SUCCEEDED",
            "Original attachment retained.",
            content_sha256=document["content_sha256"],
            byte_count=len(content),
            duration_ms=round((perf_counter() - began) * 1000, 3),
        )
        record.update(
            document_id=document["document_id"],
            elapsed_ms=round((perf_counter() - start) * 1000, 3),
        )
        self.store.save(
            run,
            [record],
            (
                run["run_id"],
                document["document_id"],
                document["filename"],
                content,
            ),
        )
        return content

    def _observe(self, run, document, item):
        item = {**item, "details": dict(item["details"]), "document_id": document["document_id"]}
        units = item["details"].pop("source_units", None)
        if units is not None:
            units = [SourceUnit.model_validate(unit).model_dump(mode="json") for unit in units]
            if any(unit["document_id"] != document["document_id"] for unit in units):
                raise ValueError("Worker returned foreign source units")
            document["source_units"] = units
        available = {u["unit_id"] for u in document["source_units"]}
        refs = list(item["details"].get("source_unit_ids", []))
        for candidate in item["details"].get("candidates", []):
            refs.extend(candidate.get("source_unit_ids", []))
        if not set(refs) <= available:
            raise ValueError("Worker returned unavailable evidence")
        if item["status"] in {"SUCCEEDED", "NEEDS_REVIEW"}:
            document["last_completed_stage"] = item["stage"]
        self.store.save(run, [item])

    def _execute(self, run, inputs, start, workflow=None):
        def emit(stage, status, message, **details):
            self._record(run, None, stage, status, message, start, **details)

        try:
            should_extract = workflow.prepare(run, emit) if workflow else True
            for source, document in zip(inputs, run["documents"], strict=True):
                if self.stopping.is_set():
                    break
                began = perf_counter()
                document["processing_status"] = "RUNNING"
                self._record(
                    run, document, "document", "STARTED", "Attachment processing started.", start
                )
                try:
                    remaining = self.settings.dev_run_timeout - (perf_counter() - start)
                    if remaining <= 0:
                        raise DatasetError(
                            "RUN_TIMEOUT", "The run time limit was reached before this attachment."
                        )
                    content = self._read(run, document, source, start)
                    if not should_extract:
                        document["processing_status"] = "SKIPPED"
                        self._record(
                            run,
                            document,
                            "extraction",
                            "SKIPPED",
                            "Email classification does not request SI/BL comparison.",
                            start,
                        )
                        continue
                    remaining = self.settings.dev_run_timeout - (perf_counter() - start)
                    if remaining <= 0:
                        raise DatasetError(
                            "RUN_TIMEOUT", "The run time limit was reached before extraction."
                        )
                    result, _, error = run_worker(
                        content,
                        document,
                        min(self.settings.dev_document_timeout, remaining),
                        source.max_file_bytes,
                        lambda item: self._observe(run, document, item),
                        self.stopping,
                    )
                    document.update(result=result, error=error)
                    document["processing_status"] = (
                        "FAILED"
                        if error or result["parsing_status"] in {"FAILED", "REJECTED"}
                        else "SUCCEEDED"
                    )
                except (DatasetError, OSError) as exc:
                    document.update(
                        processing_status="FAILED",
                        error={
                            "code": getattr(exc, "code", "ATTACHMENT_UNAVAILABLE"),
                            "message": getattr(exc, "message", "The attachment could not be read."),
                        },
                    )
                document["elapsed_ms"] = round((perf_counter() - began) * 1000, 3)
                if document["error"] and document["error"]["code"] == "RUN_INTERRUPTED":
                    document["processing_status"] = "INTERRUPTED"
                self._record(
                    run,
                    document,
                    "document",
                    document["processing_status"],
                    document["error"]["message"]
                    if document["error"]
                    else "Attachment processing finished.",
                    start,
                    code=document["error"]["code"] if document["error"] else None,
                    duration_ms=document["elapsed_ms"],
                    needs_review=bool(document["error"] or document["result"]["needs_review"]),
                )
            if self.stopping.is_set():
                interrupt(run, "The backend stopped before this run finished.")
            else:
                if not inputs and not workflow:
                    run["issues"].append({"code": "NO_ATTACHMENTS", "message": "No attachments."})
                    self._record(
                        run,
                        None,
                        "attachments",
                        "NEEDS_REVIEW",
                        "No attachments were listed for this email.",
                        start,
                    )
                run["processing_status"] = (
                    "FAILED"
                    if any(d["processing_status"] == "FAILED" for d in run["documents"])
                    else "SUCCEEDED"
                )
                run["needs_review"] = bool(run["issues"]) or any(
                    d["error"] or d["result"] is None or d["result"]["needs_review"]
                    for d in run["documents"]
                )
            if workflow and not self.stopping.is_set():
                workflow.finish(run, emit)
            run["finished_at"] = now()
            run["elapsed_ms"] = round((perf_counter() - start) * 1000, 3)
            self._record(
                run,
                None,
                "run",
                run["processing_status"],
                "Extraction run finished."
                if run["processing_status"] != "INTERRUPTED"
                else "Extraction run interrupted.",
                start,
                duration_ms=run["elapsed_ms"],
                needs_review=run["needs_review"],
                commit=workflow.commit if workflow else None,
            )
            return self.store.get(run["run_id"])
        except sqlite3.Error:
            self._fail(
                run, "AUDIT_SAVE_FAILED", "Audit recording failed; extraction stopped.", workflow
            )
            raise
        except Exception as exc:
            self._fail(
                run,
                getattr(exc, "code", "PROCESSING_FAILED"),
                "Processing stopped before results could be saved.",
                workflow,
            )
            return self.store.get(run["run_id"])

    def _fail(self, run, code, message, workflow=None):
        with self.lock:
            self.recording_failures.add(run["run_id"])
            if workflow:
                self.failure_workflows[run["run_id"]] = workflow
        logger.error(
            "extraction_failed run_id=%s request_id=%s code=%s",
            run["run_id"],
            run["request_id"],
            code,
        )
        try:
            saved = self.store.get(run["run_id"])
            if saved is None:
                return
            if saved["processing_status"] != "RUNNING":
                return
            saved.pop("events", None)
            for document in saved["documents"]:
                document["events"] = []
                if document["processing_status"] in {"PENDING", "RUNNING"}:
                    document.update(
                        processing_status="FAILED", error={"code": code, "message": message}
                    )
            saved.update(processing_status="FAILED", needs_review=True, finished_at=now())
            saved["issues"].append({"code": code, "message": message})
            self.store.save(
                saved,
                [event("run", "FAILED", message, code=code)],
                commit=workflow.commit if workflow else None,
            )
            with self.lock:
                self.recording_failures.discard(run["run_id"])
                self.failure_workflows.pop(run["run_id"], None)
        except sqlite3.Error:
            pass
