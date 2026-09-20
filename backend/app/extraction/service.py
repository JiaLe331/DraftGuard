"""One-document extraction entry point for the CLI and future API integration."""

from collections.abc import Callable
from hashlib import sha256
from pathlib import PureWindowsPath
from time import perf_counter

from .models import (
    FIELD_KEYS,
    DocumentExtraction,
    ExtractionIssue,
    ExtractionLimits,
    FieldExtraction,
    Role,
)
from .parsers import ParseProblem, detect_format, parse
from .rules import detect_role, extract_fields
from .trace import Trace


def extract_document(
    content: bytes,
    filename: str,
    document_id: str,
    expected_role: Role | None = None,
    *,
    limits: ExtractionLimits | None = None,
    observer: Callable[[dict], None] | None = None,
) -> DocumentExtraction:
    """Extract one immutable source; never consult a paired document or external service.

    Bad source documents return structured issues. Invalid caller arguments raise ValueError.
    """
    if not isinstance(content, bytes):
        raise TypeError("content must be bytes")
    if not isinstance(document_id, str) or not document_id.strip():
        raise ValueError("document_id must be a nonempty immutable source identifier")
    if expected_role not in {None, "SI", "BL"}:
        raise ValueError("expected_role must be SI, BL, or None")
    if not isinstance(filename, str) or not filename.strip():
        raise ValueError("filename must be nonempty")
    metadata = {
        "document_id": document_id,
        "filename": PureWindowsPath(filename).name,
        "content_sha256": sha256(content).hexdigest(),
        "expected_role": expected_role,
    }
    kind = None
    limits = limits or ExtractionLimits()
    trace = Trace(observer)
    stage = "validation"
    started = perf_counter()
    trace.emit(stage, "STARTED", "Validating file content and format.", byte_count=len(content))
    try:
        kind = detect_format(content, filename, limits)
        trace.emit(
            stage,
            "SUCCEEDED",
            "File format validated.",
            detected_format=kind,
            duration_ms=round((perf_counter() - started) * 1000, 3),
        )
        stage = "parsing"
        started = perf_counter()
        trace.emit(
            stage,
            "STARTED",
            "Reading source units.",
            parser={
                "txt": "text-decoder",
                "pdf": "pypdf",
                "docx": "python-docx",
                "xlsx": "openpyxl",
            }[kind],
        )
        units = parse(content, kind, document_id, limits)
        trace.emit(
            stage,
            "SUCCEEDED",
            "Source units retained.",
            source_unit_count=len(units),
            source_unit_ids=[u.unit_id for u in units],
            source_units=[u.model_dump(mode="json") for u in units] if observer else [],
            duration_ms=round((perf_counter() - started) * 1000, 3),
        )
    except Exception as exc:
        # The document-library boundary intentionally contains parser-specific errors.
        # Do not expose exception text: it can contain source content or local paths.
        problem = (
            exc
            if isinstance(exc, ParseProblem)
            else ParseProblem(
                "MALFORMED_DOCUMENT",
                "The document could not be parsed safely.",
                "Export a new unencrypted copy of the document.",
            )
        )
        trace.emit(
            stage,
            "FAILED",
            problem.message,
            code=problem.code,
            duration_ms=round((perf_counter() - started) * 1000, 3),
        )
        return DocumentExtraction(
            **metadata,
            detected_format=kind,
            parsing_status="REJECTED" if problem.rejected else "FAILED",
            fields=[FieldExtraction(field=key, value_state="UNREADABLE") for key in FIELD_KEYS],
            issues=[
                ExtractionIssue(
                    code=problem.code,
                    message=problem.message,
                    next_action=problem.action,
                    reason="unreadable",
                )
            ],
            needs_review=True,
        )
    if not any(any(c.isalnum() for c in unit.text) for unit in units):
        trace.emit(
            "text_check",
            "NEEDS_REVIEW",
            "No usable text was extracted.",
            code="VISUAL_REVIEW_REQUIRED" if kind == "pdf" else "NO_USABLE_TEXT",
        )
        return DocumentExtraction(
            **metadata,
            detected_format=kind,
            parsing_status="NO_USABLE_TEXT",
            source_units=units,
            fields=[FieldExtraction(field=key, value_state="UNREADABLE") for key in FIELD_KEYS],
            issues=[
                ExtractionIssue(
                    code="VISUAL_REVIEW_REQUIRED" if kind == "pdf" else "NO_USABLE_TEXT",
                    message="No usable text was extracted; no values have been inferred.",
                    next_action="Review the original or provide a text-readable replacement.",
                    reason="unreadable",
                )
            ],
            needs_review=True,
        )
    role, role_problem = detect_role(units)
    trace.emit(
        "role_detection",
        "NEEDS_REVIEW"
        if role_problem or (expected_role is not None and role != expected_role)
        else "SUCCEEDED",
        "Document headings inspected.",
        detected_role=role,
        expected_role=expected_role,
        code=role_problem
        or (
            "DOCUMENT_ROLE_MISMATCH"
            if expected_role is not None and role != expected_role
            else None
        ),
    )
    fields, issues = extract_fields(units, trace=trace)
    if role_problem:
        issues.insert(
            0,
            ExtractionIssue(
                code=role_problem,
                message="The source could not be identified as one SI or draft BL.",
                next_action="Review the document type and replace or reassign the source.",
                reason="wrong_doc_type" if role_problem == "WRONG_DOCUMENT_TYPE" else "unreadable",
            ),
        )
    elif expected_role is not None and role != expected_role:
        issues.insert(
            0,
            ExtractionIssue(
                code="DOCUMENT_ROLE_MISMATCH",
                message=f"Expected {expected_role}, but the source is {role}.",
                next_action="Reassign the document or upload the correct source.",
                reason="wrong_doc_type",
            ),
        )
    trace.emit(
        "completed",
        "NEEDS_REVIEW" if issues else "SUCCEEDED",
        "Seven-field extraction finished.",
        issue_codes=[i.code for i in issues],
        present_fields=sum(f.value_state == "PRESENT" for f in fields),
    )
    return DocumentExtraction(
        **metadata,
        detected_format=kind,
        detected_role=role,
        parsing_status="READABLE",
        source_units=units,
        fields=fields,
        issues=issues,
        needs_review=bool(issues),
    )
