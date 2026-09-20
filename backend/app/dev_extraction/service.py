"""Shared synchronous run orchestration for upload and email adapters."""

import base64
import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path, PureWindowsPath
from time import perf_counter
from uuid import uuid4

from app.config import Settings
from app.extraction import DocumentExtraction

from .dataset import DatasetError
from .store import AuditStore, now


@dataclass
class DocumentInput:
    filename: str
    read: Callable[[], bytes]
    expected_role: str | None = None
    max_file_bytes: int = 10 * 1024 * 1024


def run_worker(content: bytes, document: dict, timeout: float, max_file_bytes: int):
    payload = {
        "content": base64.b64encode(content).decode("ascii"),
        "filename": document["filename"],
        "document_id": document["document_id"],
        "expected_role": document["expected_role"],
        "max_file_bytes": max_file_bytes,
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "app.dev_extraction.worker"],
        cwd=Path(__file__).resolve().parents[2],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    error = None
    try:
        try:
            stdout, _ = process.communicate(json.dumps(payload).encode(), timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, _ = process.communicate()
            error = {"code": "EXTRACTION_TIMEOUT", "message": "Extraction exceeded its time limit."}
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
    events, result = [], None
    for line in stdout.splitlines():
        try:
            message = json.loads(line)
            if message["type"] == "event":
                events.append(message["payload"])
            elif message["type"] == "result":
                result = DocumentExtraction.model_validate(message["payload"]).model_dump(
                    mode="json"
                )
            elif message["type"] == "error":
                error = message["payload"]
        except (ValueError, KeyError, TypeError):
            error = {
                "code": "INVALID_WORKER_OUTPUT",
                "message": "The extraction output was incomplete.",
            }
    if error or process.returncode != 0 or result is None:
        return (
            None,
            events,
            error or {"code": "WORKER_FAILED", "message": "The extraction worker failed."},
        )
    return result, events, None


class RunService:
    def __init__(self, store: AuditStore, settings: Settings):
        self.store, self.settings = store, settings

    def run(
        self,
        inputs: list[DocumentInput],
        source_type: str,
        source_label: str,
        email: dict | None,
        request_id: str,
    ):
        run = {
            "run_id": str(uuid4()),
            "request_id": request_id,
            "source_type": source_type,
            "source_label": source_label,
            "email": email,
            "created_at": now(),
            "finished_at": None,
            "processing_status": "RUNNING",
            "needs_review": True,
            "document_count": len(inputs),
            "pipeline_version": "rules-1",
            "issues": [],
            "documents": [],
        }
        for source in inputs:
            run["documents"].append(
                {
                    "document_id": str(uuid4()),
                    "filename": PureWindowsPath(source.filename).name,
                    "expected_role": source.expected_role,
                    "content_sha256": None,
                    "byte_count": None,
                    "has_original": False,
                    "processing_status": "PENDING",
                    "result": None,
                    "events": [],
                    "error": None,
                    "last_completed_stage": None,
                }
            )
        self.store.create(run)
        start = perf_counter()
        for source, document in zip(inputs, run["documents"], strict=True):
            document_started = perf_counter()
            document["processing_status"] = "RUNNING"
            self.store.save(run)
            remaining = self.settings.dev_run_timeout - (perf_counter() - start)
            try:
                if remaining <= 0:
                    raise DatasetError(
                        "RUN_TIMEOUT", "The run time limit was reached before this attachment."
                    )
                content = source.read()
                if len(content) > source.max_file_bytes:
                    raise DatasetError(
                        "RESOURCE_LIMIT", "The attachment exceeds the document size limit."
                    )
                document.update(content_sha256=sha256(content).hexdigest(), byte_count=len(content))
                self.store.save_original(
                    run["run_id"], document["document_id"], document["filename"], content
                )
                document["has_original"] = True
                self.store.save(run)
                remaining = self.settings.dev_run_timeout - (perf_counter() - start)
                if remaining <= 0:
                    raise DatasetError(
                        "RUN_TIMEOUT", "The run time limit was reached before extraction."
                    )
                result, events, error = run_worker(
                    content,
                    document,
                    min(self.settings.dev_document_timeout, remaining),
                    source.max_file_bytes,
                )
                document.update(result=result, events=events, error=error)
                document["processing_status"] = (
                    "FAILED"
                    if error
                    or result["parsing_status"]
                    in {
                        "FAILED",
                        "REJECTED",
                    }
                    else "SUCCEEDED"
                )
            except (DatasetError, OSError) as exc:
                document["processing_status"] = "FAILED"
                document["error"] = {
                    "code": getattr(exc, "code", "ATTACHMENT_UNAVAILABLE"),
                    "message": getattr(exc, "message", "The attachment could not be read."),
                }
            if document["error"]:
                events = document["events"]
                events.append(
                    {
                        "sequence": len(events) + 1,
                        "timestamp": now(),
                        "elapsed_ms": round((perf_counter() - document_started) * 1000, 3),
                        "stage": "processing",
                        "status": "FAILED",
                        "message": document["error"]["message"],
                        "details": {"code": document["error"]["code"]},
                    }
                )
            completed_stages = [
                e["stage"]
                for e in document["events"]
                if e["status"] in {"SUCCEEDED", "NEEDS_REVIEW"}
            ]
            document["last_completed_stage"] = completed_stages[-1] if completed_stages else None
            document["elapsed_ms"] = round((perf_counter() - document_started) * 1000, 3)
            self.store.save(run)
        if not inputs:
            run["issues"].append(
                {"code": "NO_ATTACHMENTS", "message": "This email has no attachments."}
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
        run["finished_at"] = now()
        run["elapsed_ms"] = round((perf_counter() - start) * 1000, 3)
        self.store.save(run)
        return run
