"""Gemini PDF vision adapter and deterministic candidate adaptation."""

from collections.abc import Callable
from typing import Literal

from google.genai import types
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.config import Settings
from app.extraction.models import (
    FIELD_KEYS,
    DocumentExtraction,
    Evidence,
    ExtractionIssue,
    FieldExtraction,
    FieldKey,
    ProviderMetadata,
    Role,
)
from app.extraction.rules import normalize_review_value

from .common import AIProviderError, GeminiProvider

PROMPT_VERSION = "scan-seven-fields-v1"


VisionProviderError = AIProviderError


class VisionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: FieldKey
    raw_value: str | None = Field(default=None, max_length=5000)
    page: int | None = Field(default=None, ge=1)
    excerpt: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def evidence_matches_value(self):
        if self.raw_value is None:
            if self.page is not None or self.excerpt is not None:
                raise ValueError("Missing candidates cannot claim source evidence")
        elif (
            not self.raw_value.strip()
            or self.page is None
            or not self.excerpt
            or not self.excerpt.strip()
        ):
            raise ValueError("Present candidates require a page and visual excerpt")
        return self


class VisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detected_role: Literal["SI", "BL", "UNKNOWN"]
    fields: list[VisionCandidate] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def contains_each_field_once(self):
        keys = [item.field for item in self.fields]
        if set(keys) != set(FIELD_KEYS) or len(keys) != len(set(keys)):
            raise ValueError("The response must contain every supported field exactly once")
        return self


class VisionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    response: VisionResponse
    metadata: ProviderMetadata


class GeminiVisionProvider(GeminiProvider):
    """One request per immutable PDF. Construction never calls the provider."""

    def __init__(
        self,
        settings: Settings,
        client_factory: Callable[..., object] | None = None,
    ):
        super().__init__(settings, client_factory)

    operation_label = "visual extraction"

    def extract_pdf(
        self,
        content: bytes,
        expected_role: Role | None,
        *,
        timeout_seconds: float | None = None,
    ) -> VisionResult:
        payload, metadata = self._generate(
            [
                self._prompt(expected_role),
                types.Part.from_bytes(data=content, mime_type="application/pdf"),
            ],
            VisionResponse,
            PROMPT_VERSION,
            timeout_seconds=timeout_seconds,
        )
        return VisionResult(response=payload, metadata=metadata)

    @staticmethod
    def _prompt(expected_role: Role | None) -> str:
        role = expected_role or "the document role shown in the PDF"
        return (
            "Read only this one scanned shipping PDF. Do not infer from another document or "
            "invent missing values. Identify whether it is SI, BL, or UNKNOWN, then return "
            "exactly these seven fields: shipper, consignee, notify_party, port_of_loading, "
            "port_of_discharge, container_count, gross_weight_kg. Preserve the visible source "
            "wording in raw_value. For a visible value return its 1-based page and a short "
            "verbatim visual excerpt; otherwise return null for raw_value, page, and excerpt. "
            f"The selected task role is {role}; still report the role visible in the PDF."
        )

    @staticmethod
    def _provider_schema() -> dict:
        return GeminiProvider.provider_schema(VisionResponse)

    _usage = staticmethod(GeminiProvider.usage)

    def _provider_error(self, exc: Exception) -> VisionProviderError:
        return self.provider_error(exc)


def apply_visual_candidates(
    base: DocumentExtraction,
    visual: VisionResult,
    expected_role: Role | None,
) -> DocumentExtraction:
    pages = {unit.page: unit for unit in base.source_units if unit.page is not None}
    if not pages:
        raise VisionProviderError(
            "AI_INVALID_RESPONSE",
            "The scanned PDF has no valid page anchors for visual evidence.",
            retryable=False,
        )
    by_key = {item.field: item for item in visual.response.fields}
    fields: list[FieldExtraction] = []
    issues: list[ExtractionIssue] = []
    for key in FIELD_KEYS:
        item = by_key[key]
        if item.page is not None and item.page not in pages:
            raise VisionProviderError(
                "AI_INVALID_RESPONSE",
                "Gemini returned a candidate page outside the source PDF.",
                retryable=True,
            )
        if item.raw_value is None:
            fields.append(
                FieldExtraction(
                    field=key,
                    value_state="MISSING",
                    method="gemini_vision",
                    requires_human_confirmation=True,
                )
            )
            issues.append(
                ExtractionIssue(
                    code="AI_CANDIDATE_MISSING",
                    message="Gemini did not locate this field in the scanned source.",
                    next_action=(
                        "Inspect the PDF and correct the extraction if the value is visible."
                    ),
                    field=key,
                    reason="missing_value",
                )
            )
            continue
        raw, normalized, state, _ = normalize_review_value(key, item.raw_value)
        unit = pages[item.page]
        fields.append(
            FieldExtraction(
                field=key,
                raw_value=raw,
                normalized_value=normalized,
                value_state=state,
                method="gemini_vision",
                requires_human_confirmation=True,
                evidence=[
                    Evidence(
                        unit_id=unit.unit_id,
                        document_id=base.document_id,
                        page=item.page,
                        excerpt=item.excerpt or item.raw_value,
                        verified=False,
                        verification_source="ai_visual_candidate",
                    )
                ],
            )
        )
        issues.append(
            ExtractionIssue(
                code="AI_CONFIRMATION_REQUIRED",
                message="A Gemini visual candidate must be checked against the original PDF.",
                next_action="Confirm the candidate or correct it with the visible source page.",
                field=key,
                reason="unreadable",
            )
        )
    detected_role = (
        visual.response.detected_role if visual.response.detected_role != "UNKNOWN" else None
    )
    if detected_role is None:
        issues.insert(
            0,
            ExtractionIssue(
                code="UNKNOWN_DOCUMENT_ROLE",
                message="Gemini could not identify this scan as an SI or draft BL.",
                next_action="Review the document type and select or replace the source.",
                reason="unreadable",
            ),
        )
    elif expected_role is not None and detected_role != expected_role:
        issues.insert(
            0,
            ExtractionIssue(
                code="DOCUMENT_ROLE_MISMATCH",
                message=(
                    f"Expected {expected_role}, but the scanned source appears to be "
                    f"{detected_role}."
                ),
                next_action="Select the correct role or replace the source.",
                reason="wrong_doc_type",
            ),
        )
    return base.model_copy(
        update={
            "detected_role": detected_role,
            "fields": fields,
            "issues": issues,
            "needs_review": True,
            "pipeline_version": f"{base.pipeline_version}+gemini-vision-1",
            "provider_metadata": visual.metadata,
        }
    )
