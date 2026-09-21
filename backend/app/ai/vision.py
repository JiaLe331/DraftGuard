"""Gemini PDF vision adapter and deterministic candidate adaptation."""

import json
from collections.abc import Callable
from time import perf_counter
from typing import Literal

from google import genai
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

PROMPT_VERSION = "scan-seven-fields-v1"


class VisionProviderError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool, status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status = status


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


class GeminiVisionProvider:
    """One request per immutable PDF. Construction never calls the provider."""

    def __init__(
        self,
        settings: Settings,
        client_factory: Callable[..., object] | None = None,
    ):
        key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
        self.api_key = key.strip() or None
        self.model = settings.gemini_model.strip() if settings.gemini_model else None
        self.timeout_seconds = settings.gemini_timeout_seconds
        self.client_factory = client_factory or genai.Client

    def extract_pdf(
        self,
        content: bytes,
        expected_role: Role | None,
        *,
        timeout_seconds: float | None = None,
    ) -> VisionResult:
        if not self.api_key or not self.model:
            raise VisionProviderError(
                "AI_NOT_CONFIGURED",
                "Gemini visual extraction is not configured. Set GEMINI_API_KEY and "
                "GEMINI_MODEL on the backend, restart it, and retry.",
                retryable=False,
                status=503,
            )
        timeout = min(timeout_seconds or self.timeout_seconds, self.timeout_seconds)
        started = perf_counter()
        client = None
        try:
            client = self.client_factory(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=[
                    self._prompt(expected_role),
                    types.Part.from_bytes(data=content, mime_type="application/pdf"),
                ],
                config=types.GenerateContentConfig(
                    temperature=0,
                    candidate_count=1,
                    response_mime_type="application/json",
                    # Gemini's structured-output subset rejects Pydantic's
                    # `additionalProperties: false`. Send the same bounded shape
                    # without that unsupported keyword, then validate the raw
                    # response against the strict model below.
                    response_schema=self._provider_schema(),
                    http_options=types.HttpOptions(
                        timeout=max(1, round(timeout * 1000)),
                        retry_options=types.HttpRetryOptions(attempts=1),
                    ),
                ),
            )
            payload = VisionResponse.model_validate_json(response.text)
            usage = getattr(response, "usage_metadata", None)
            metadata = ProviderMetadata(
                configured_model=self.model,
                model_version=getattr(response, "model_version", None),
                response_id=getattr(response, "response_id", None),
                prompt_version=PROMPT_VERSION,
                duration_ms=round((perf_counter() - started) * 1000, 3),
                usage=self._usage(usage),
            )
            return VisionResult(response=payload, metadata=metadata)
        except VisionProviderError:
            raise
        except Exception as exc:
            raise self._provider_error(exc) from exc
        finally:
            close = getattr(client, "close", None) if client is not None else None
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

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
        def compatible(value):
            if isinstance(value, dict):
                return {
                    key: compatible(item)
                    for key, item in value.items()
                    if key != "additionalProperties"
                }
            if isinstance(value, list):
                return [compatible(item) for item in value]
            return value

        return compatible(VisionResponse.model_json_schema())

    @staticmethod
    def _usage(usage) -> dict[str, int | None] | None:
        if usage is None:
            return None
        if hasattr(usage, "model_dump"):
            values = usage.model_dump(exclude_none=True)
        elif isinstance(usage, dict):
            values = usage
        else:
            return None
        allowed = {
            "prompt_token_count",
            "candidates_token_count",
            "total_token_count",
            "cached_content_token_count",
            "thoughts_token_count",
        }
        return {key: values.get(key) for key in allowed if key in values} or None

    @staticmethod
    def _provider_error(exc: Exception) -> VisionProviderError:
        code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        try:
            code = int(code)
        except (TypeError, ValueError):
            pass
        name = type(exc).__name__.lower()
        if code == 429:
            return VisionProviderError(
                "AI_RATE_LIMITED",
                "Gemini is rate limited or out of quota. Check quota and retry later.",
                retryable=True,
                status=429,
            )
        if code in {401, 403}:
            return VisionProviderError(
                "AI_ACCESS_DENIED",
                "Gemini rejected the configured credentials or model access.",
                retryable=False,
                status=502,
            )
        if "timeout" in name or isinstance(exc, TimeoutError):
            return VisionProviderError(
                "AI_TIMEOUT",
                "Gemini visual extraction timed out. Retry the analysis.",
                retryable=True,
                status=504,
            )
        if isinstance(exc, (ValueError, TypeError, json.JSONDecodeError)):
            return VisionProviderError(
                "AI_INVALID_RESPONSE",
                "Gemini returned an invalid structured response. Retry the analysis.",
                retryable=True,
                status=502,
            )
        return VisionProviderError(
            "AI_PROVIDER_ERROR",
            "Gemini visual extraction failed. Check provider availability and retry.",
            retryable=True,
            status=502,
        )


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
