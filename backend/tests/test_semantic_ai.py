import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.ai.common import AIProviderError
from app.ai.semantic import (
    ClassificationResponse,
    ClassificationResult,
    GeminiSemanticProvider,
    TextCandidate,
    TextResponse,
    TextResult,
    apply_text_candidates,
)
from app.config import Settings
from app.extraction import extract_document
from app.extraction.models import ProviderMetadata
from app.main import create_app
from app.store import Store


def metadata(prompt_version="test"):
    return ProviderMetadata(
        configured_model="fake-model",
        model_version="fake-v1",
        response_id="response-1",
        prompt_version=prompt_version,
        duration_ms=4.5,
        usage={"prompt_token_count": 10, "total_token_count": 14},
    )


class FakeSemanticProvider:
    model = "fake-model"

    def __init__(self):
        self.classification_calls = []
        self.text_calls = []
        self.fail = None

    def classify_email(self, subject, body, *, timeout_seconds=None):
        self.classification_calls.append((subject, body, timeout_seconds))
        if self.fail:
            raise self.fail
        return ClassificationResult(
            response=ClassificationResponse(
                category="GENERAL", reason="The current message asks for general assistance."
            ),
            metadata=metadata("email-intent-five-categories-v1"),
        )

    def extract_text(self, units, fields, *, timeout_seconds=None):
        self.text_calls.append((units, fields, timeout_seconds))
        if self.fail:
            raise self.fail
        unit = next(item for item in units if "Exporter Entity" in item.text)
        return TextResult(
            response=TextResponse(
                fields=[
                    TextCandidate(
                        field=field,
                        raw_value="ACME SHIPPING LTD" if field == "shipper" else None,
                        unit_id=unit.unit_id if field == "shipper" else None,
                        quote="Exporter Entity: ACME SHIPPING LTD" if field == "shipper" else None,
                    )
                    for field in fields
                ]
            ),
            metadata=metadata("readable-text-seven-fields-v1"),
        )


def write_email(root: Path, email_id: str, subject: str, body: str, attachments=()):
    (root / "inbox").mkdir(parents=True, exist_ok=True)
    (root / "attachments").mkdir(exist_ok=True)
    (root / f"inbox/{email_id}.json").write_text(
        json.dumps(
            {
                "email_id": email_id,
                "from": "reviewer@example.test",
                "subject": subject,
                "body": body,
                "attachments": list(attachments),
            }
        )
    )


def test_gemini_semantic_adapter_uses_strict_schema_metadata_and_no_retries():
    captured = {}

    class Models:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return type(
                "Response",
                (),
                {
                    "text": ClassificationResponse(
                        category="GENERAL", reason="General request."
                    ).model_dump_json(),
                    "model_version": "model-v1",
                    "response_id": "response-id",
                    "usage_metadata": {"prompt_token_count": 3, "total_token_count": 7},
                },
            )()

    class Client:
        models = Models()

        def close(self):
            captured["closed"] = True

    provider = GeminiSemanticProvider(
        Settings(gemini_api_key="secret", gemini_model="configured-model", _env_file=None),
        client_factory=lambda **_: Client(),
    )
    result = provider.classify_email("Question", "Can you help?", timeout_seconds=6)

    assert captured["model"] == "configured-model"
    assert captured["config"].http_options.timeout == 6000
    assert captured["config"].http_options.retry_options.attempts == 1
    assert "additionalProperties" not in json.dumps(captured["config"].response_schema)
    assert captured["closed"] is True
    assert result.response.category == "GENERAL"
    assert result.metadata.response_id == "response-id"
    assert result.metadata.usage == {"prompt_token_count": 3, "total_token_count": 7}


def test_text_candidates_require_verified_case_sensitive_source_quote():
    content = b"SHIPPING INSTRUCTION\nExporter Entity: ACME SHIPPING LTD\nGross Weight: N/A"
    base = extract_document(content, "source.txt", "doc", expected_role="SI")
    unit = next(item for item in base.source_units if "Exporter Entity" in item.text)
    good = TextResult(
        response=TextResponse(
            fields=[
                TextCandidate(
                    field="shipper",
                    raw_value="ACME SHIPPING LTD",
                    unit_id=unit.unit_id,
                    quote="Exporter Entity: ACME SHIPPING LTD",
                )
            ]
        ),
        metadata=metadata(),
    )
    applied = apply_text_candidates(base, good)
    shipper = next(item for item in applied.fields if item.field == "shipper")
    assert shipper.method == "gemini_text"
    assert shipper.normalized_value == "ACME SHIPPING LTD"
    assert shipper.evidence[0].verified is True
    weight = next(item for item in applied.fields if item.field == "gross_weight_kg")
    assert weight.value_state == "MISSING"

    forged = good.model_copy(
        update={
            "response": TextResponse(
                fields=[
                    TextCandidate(
                        field="shipper",
                        raw_value="ACME SHIPPING LTD",
                        unit_id=unit.unit_id,
                        quote="exporter entity: acme shipping ltd",
                    )
                ]
            )
        }
    )
    rejected = apply_text_candidates(base, forged)
    assert any(issue.code == "AI_QUOTE_UNVERIFIED" for issue in rejected.issues)
    assert next(item for item in rejected.fields if item.field == "shipper").method == "rule"


def test_rule_classification_skips_ai_and_ambiguous_intent_uses_it(tmp_path):
    dataset = tmp_path / "dataset"
    write_email(dataset, "clear", "Holiday announcement", "Office resumes tomorrow.")
    write_email(dataset, "ambiguous", "Question", "Can you help with this request?")
    settings = Settings(
        local_data_dir=tmp_path / "local",
        dev_audit_db=tmp_path / "audit.sqlite3",
        _env_file=None,
    )
    Store(settings.local_data_dir).import_dataset(dataset)
    provider = FakeSemanticProvider()
    with TestClient(create_app(settings, semantic_provider=provider)) as client:
        clear_task = client.post(
            "/api/v1/dev/tasks/custom",
            json={
                "subject": "Holiday announcement",
                "sender": "reviewer@example.test",
                "body": "Office resumes tomorrow.",
            },
        ).json()
        clear = client.post(
            f"/api/v1/dev/tasks/{clear_task['id']}/analyze", json={"expected_revision": 1}
        )
        assert clear.status_code == 200
        assert clear.json()["current_run"]["result"]["classification"]["method"] == "rule"
        assert provider.classification_calls == []

        ambiguous_task = client.post(
            "/api/v1/dev/tasks/custom",
            json={
                "subject": "Question",
                "sender": "reviewer@example.test",
                "body": "Can you help with this request?",
            },
        ).json()
        ambiguous = client.post(
            f"/api/v1/dev/tasks/{ambiguous_task['id']}/analyze",
            json={"expected_revision": 1},
        )
        assert ambiguous.status_code == 200
        result = ambiguous.json()["current_run"]["result"]
        assert result["classification"]["method"] == "gemini"
        assert result["classification"]["category"] == "GENERAL"
        assert result["provider_calls"][0]["operation"] == "email_classification"
        assert result["provider_calls"][0]["document_id"] is None
        assert len(provider.classification_calls) == 1


def test_semantic_provider_failure_is_saved_as_retryable_run_failure(tmp_path):
    dataset = tmp_path / "dataset"
    write_email(dataset, "ambiguous", "Question", "Can you help with this request?")
    settings = Settings(
        local_data_dir=tmp_path / "local",
        dev_audit_db=tmp_path / "audit.sqlite3",
        _env_file=None,
    )
    Store(settings.local_data_dir).import_dataset(dataset)
    provider = FakeSemanticProvider()
    provider.fail = AIProviderError(
        "AI_RATE_LIMITED", "Gemini quota is unavailable.", retryable=True, status=429
    )
    with TestClient(create_app(settings, semantic_provider=provider)) as client:
        task = client.post(
            "/api/v1/dev/tasks/custom",
            json={
                "subject": "Question",
                "sender": "reviewer@example.test",
                "body": "Can you help with this request?",
            },
        ).json()
        response = client.post(
            f"/api/v1/dev/tasks/{task['id']}/analyze", json={"expected_revision": 1}
        )
        assert response.status_code == 200
        latest = response.json()["latest_run"]
        assert latest["status"] == "FAILED"
        assert latest["error"] == {
            "code": "AI_RATE_LIMITED",
            "message": "Gemini quota is unavailable.",
            "retryable": True,
        }


def test_readable_documents_use_source_verified_text_fallback(tmp_path):
    settings = Settings(
        local_data_dir=tmp_path / "local",
        dev_audit_db=tmp_path / "audit.sqlite3",
        _env_file=None,
    )
    provider = FakeSemanticProvider()
    source = """{heading}
Exporter Entity: ACME SHIPPING LTD
Consignee: BUYER LTD
Notify Party: BUYER LTD
POL: PORT KLANG
POD: HOUSTON, US
Container Count: 2 x 40'HC
Gross Weight: 20,000 KG
"""
    with TestClient(create_app(settings, semantic_provider=provider)) as client:
        task = client.post(
            "/api/v1/dev/tasks/custom",
            json={
                "subject": "Check draft BL",
                "sender": "reviewer@example.test",
                "body": "Compare the SI and draft BL.",
            },
        ).json()
        for role, heading in (("si", "SHIPPING INSTRUCTION"), ("bl", "BILL OF LADING")):
            uploaded = client.post(
                f"/api/v1/dev/tasks/{task['id']}/documents",
                data={"role": role, "expected_revision": task["revision"]},
                files={
                    "file": (
                        f"{role}.txt",
                        source.format(heading=heading).encode(),
                        "text/plain",
                    )
                },
            )
            assert uploaded.status_code == 200, uploaded.text
            task = uploaded.json()
        analyzed = client.post(
            f"/api/v1/dev/tasks/{task['id']}/analyze",
            json={"expected_revision": task["revision"]},
        )
        assert analyzed.status_code == 200, analyzed.text
        result = analyzed.json()["current_run"]["result"]
        shipper = next(item for item in result["fields"] if item["key"] == "shipper")
        assert shipper["finding"] == "MATCH"
        assert shipper["si"]["method"] == shipper["bl"]["method"] == "gemini_text"
        assert shipper["si"]["evidence"][0]["verified"] is True
        assert len(provider.text_calls) == 2
        assert all(call[1] == ["shipper"] for call in provider.text_calls)
        assert {call["operation"] for call in result["provider_calls"]} == {"text_extraction"}


def test_text_input_limit_stays_reviewable_without_provider_call(tmp_path):
    settings = Settings(
        local_data_dir=tmp_path / "local",
        dev_audit_db=tmp_path / "audit.sqlite3",
        gemini_text_max_chars=10,
        _env_file=None,
    )
    provider = FakeSemanticProvider()
    base = extract_document(
        b"SHIPPING INSTRUCTION\nExporter Entity: ACME SHIPPING LTD",
        "si.txt",
        "si",
        expected_role="SI",
    )
    from app.ai.semantic import add_input_too_large, fallback_fields, source_text_length

    assert fallback_fields(base) == [
        "shipper",
        "consignee",
        "notify_party",
        "port_of_loading",
        "port_of_discharge",
        "container_count",
        "gross_weight_kg",
    ]
    assert source_text_length(base.source_units) > settings.gemini_text_max_chars
    bounded = add_input_too_large(base)
    assert any(issue.code == "AI_INPUT_TOO_LARGE" for issue in bounded.issues)
    assert provider.text_calls == []


VALUES = {
    "shipper": "APRIL FAR EAST (M) SDN BHD",
    "consignee": "EAST BRIGHT FZ-LLC",
    "notify_party": "EAST BRIGHT FZ-LLC",
    "port_of_loading": "NANTONG, CHINA",
    "port_of_discharge": "KARACHI, PAKISTAN",
    "gross_weight_kg": "131,058 KG",
}


class UnseenLabelProvider(FakeSemanticProvider):
    """Reads the fixture text the way the real fallback does: every value it
    returns is quoted verbatim from a named source unit, so the backend can
    verify it against the extracted text before accepting it."""

    def extract_text(self, units, fields, *, timeout_seconds=None):
        self.text_calls.append((units, fields, timeout_seconds))
        candidates = []
        for field in fields:
            value = VALUES.get(field)
            if field == "container_count":
                # The planted discrepancy: the SI says six, the draft BL says seven.
                value = "7" if any("Equipment Quantity" in u.text for u in units) else "6"
            line = next(
                (
                    (unit, text.strip())
                    for unit in units
                    for text in unit.text.splitlines()
                    if value and value in text
                ),
                None,
            )
            candidates.append(
                TextCandidate(
                    field=field,
                    raw_value=value if line else None,
                    unit_id=line[0].unit_id if line else None,
                    quote=line[1] if line else None,
                )
            )
        return TextResult(
            response=TextResponse(fields=candidates),
            metadata=metadata("readable-text-seven-fields-v1"),
        )


def test_unseen_labels_reach_comparison_through_verified_quotes():
    """Neither fixture uses a label the rules know, and the two documents share
    no label vocabulary. Rules alone see nothing; the verified text fallback
    still resolves all seven fields and isolates the single real discrepancy."""
    from app.ai.semantic import fallback_fields
    from app.documents.analysis import classify, compare

    fixtures = Path(__file__).parent / "fixtures/unseen-labels"
    provider = UnseenLabelProvider()
    documents = []
    for role in ("SI", "BL"):
        path = fixtures / f"unseen_labels_{role}.txt"
        parsed = extract_document(
            path.read_bytes(), path.name, document_id=role, expected_role=role
        )
        # Deterministic rules recognise the document type but not one label.
        assert parsed.detected_role == role
        assert all(field.value_state == "MISSING" for field in parsed.fields)
        assert {issue.code for issue in parsed.issues} == {"FIELD_NOT_FOUND"}

        requested = fallback_fields(parsed)
        assert len(requested) == 7
        merged = apply_text_candidates(
            parsed, provider.extract_text(parsed.source_units, requested)
        )
        assert all(field.method == "gemini_text" for field in merged.fields)
        documents.append(
            {"document_id": role, "role": role, "result": merged.model_dump(mode="json")}
        )

    result = compare(
        classify("TO CONFIRM DOCS _ 5ALT-01226", "Attached are the SI and draft BL."), documents
    )
    assert result["coverage"] == {"checked": 7, "total": 7}
    assert result["known_defect_fields"] == ["container_count"]
    containers = next(f for f in result["fields"] if f["key"] == "container_count")
    assert (containers["si"]["raw_value"], containers["bl"]["raw_value"]) == ("6", "7")
    # Every accepted value still points at a line of its own source document.
    assert all(
        field[side]["evidence"][0]["excerpt"]
        in (fixtures / f"unseen_labels_{side.upper()}.txt").read_text()
        for field in result["fields"]
        for side in ("si", "bl")
    )
