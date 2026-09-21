"""Public extraction contracts; independent of HTTP, storage, and provider clients."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

FieldKey = Literal[
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
]
FIELD_KEYS: tuple[FieldKey, ...] = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)
Role = Literal["SI", "BL"]
Format = Literal["txt", "pdf", "docx", "xlsx"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ExtractionLimits(Contract):
    max_file_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    max_pdf_pages: int = Field(default=20, gt=0)
    max_archive_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    max_archive_entries: int = Field(default=1000, gt=0)
    max_sheets: int = Field(default=10, gt=0)
    max_rows: int = Field(default=5000, gt=0)
    max_columns: int = Field(default=100, gt=0)
    max_cells: int = Field(default=100_000, gt=0)
    max_source_units: int = Field(default=20_000, gt=0)
    max_text_chars: int = Field(default=1_000_000, gt=0)
    max_pdf_stream_bytes: int = Field(default=10 * 1024 * 1024, gt=0)


class Locator(Contract):
    page: int | None = Field(default=None, ge=1)
    line: int | None = Field(default=None, ge=1)
    paragraph: int | None = Field(default=None, ge=1)
    table: int | None = Field(default=None, ge=1)
    row: int | None = Field(default=None, ge=1)
    column: int | None = Field(default=None, ge=1)
    sheet: str | None = None
    cell: str | None = None


class SourceUnit(Locator):
    unit_id: str
    document_id: str
    text: str
    is_formula: bool = False


class Evidence(Locator):
    unit_id: str
    document_id: str
    excerpt: str
    verified: bool = True
    verification_source: Literal["source_text", "ai_visual_candidate", "human_visual"] = (
        "source_text"
    )


class ProviderMetadata(Contract):
    provider: Literal["gemini"] = "gemini"
    configured_model: str
    model_version: str | None = None
    response_id: str | None = None
    prompt_version: str
    duration_ms: float = Field(ge=0)
    usage: dict[str, int | None] | None = None
    cost_usd: float | None = None


class FieldExtraction(Contract):
    field: FieldKey
    raw_value: str | None = None
    normalized_value: str | None = None
    value_state: Literal["PRESENT", "MISSING", "UNREADABLE", "AMBIGUOUS"]
    method: Literal["rule", "gemini_text", "gemini_vision", "human"] = "rule"
    requires_human_confirmation: bool = False
    evidence: list[Evidence] = Field(default_factory=list)


class ExtractionIssue(Contract):
    code: str
    message: str
    next_action: str
    field: FieldKey | None = None
    reason: Literal["wrong_doc_type", "unreadable", "missing_value"] | None = None


class DocumentExtraction(Contract):
    document_id: str
    filename: str
    content_sha256: str
    detected_format: Format | None = None
    detected_role: Role | None = None
    expected_role: Role | None = None
    parsing_status: Literal["READABLE", "NO_USABLE_TEXT", "FAILED", "REJECTED"]
    source_units: list[SourceUnit] = Field(default_factory=list)
    fields: list[FieldExtraction]
    issues: list[ExtractionIssue] = Field(default_factory=list)
    needs_review: bool
    pipeline_version: str = "rules-1"
    provider_metadata: ProviderMetadata | None = None
