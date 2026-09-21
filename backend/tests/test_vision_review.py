import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai.vision import (
    GeminiVisionProvider,
    VisionCandidate,
    VisionProviderError,
    VisionResponse,
    VisionResult,
    apply_visual_candidates,
)
from app.config import Settings
from app.extraction import extract_document
from app.extraction.models import FIELD_KEYS, ProviderMetadata
from app.main import create_app
from app.store import Store

FIXTURES = Path(__file__).parent / "fixtures/extraction"
PREFIX = "/api/v1/dev/tasks"
VALUES = {
    "shipper": "APRIL FAR EAST (M) SDN BHD",
    "consignee": "AL GURG STATIONERY LLC",
    "notify_party": "AL GURG STATIONERY LLC",
    "port_of_loading": "NHAVA SHEVA, INDIA",
    "port_of_discharge": "TUTICORIN, INDIA",
    "container_count": "6 x 40'HC",
    "gross_weight_kg": "128,544 KG",
}


def response(role="SI", *, page=1, weight=None):
    values = {**VALUES, **({"gross_weight_kg": weight} if weight else {})}
    return VisionResponse(
        detected_role=role,
        fields=[
            VisionCandidate(field=key, raw_value=values[key], page=page, excerpt=values[key])
            for key in FIELD_KEYS
        ],
    )


class FakeVisionProvider:
    model = "fake-vision-model"

    def __init__(self, si, bl):
        self.si = si
        self.bl = bl
        self.calls = []
        self.fail = False

    def extract_pdf(self, content, expected_role, *, timeout_seconds=None):
        self.calls.append((content, expected_role, timeout_seconds))
        if self.fail:
            raise VisionProviderError(
                "AI_PROVIDER_ERROR", "Injected provider failure.", retryable=True
            )
        is_si = content == self.si
        payload = response("SI" if is_si else "BL", weight=None if is_si else "128,545 KG")
        return VisionResult(
            response=payload,
            metadata=ProviderMetadata(
                configured_model=self.model,
                model_version="fake-v1",
                response_id=f"response-{len(self.calls)}",
                prompt_version="scan-seven-fields-v1",
                duration_ms=12.5,
                usage={"prompt_token_count": 10, "total_token_count": 20},
            ),
        )


def test_gemini_adapter_uses_pdf_schema_metadata_and_no_retries():
    captured = {}

    class Models:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return type(
                "Response",
                (),
                {
                    "parsed": response(),
                    "text": response().model_dump_json(),
                    "model_version": "model-v1",
                    "response_id": "response-id",
                    "usage_metadata": {
                        "prompt_token_count": 11,
                        "total_token_count": 22,
                        "irrelevant": 99,
                    },
                },
            )()

    class Client:
        models = Models()

        def close(self):
            captured["closed"] = True

    settings = Settings(gemini_api_key="secret", gemini_model="configured-model", _env_file=None)
    provider = GeminiVisionProvider(settings, client_factory=lambda **_: Client())
    result = provider.extract_pdf(b"%PDF-test", "SI", timeout_seconds=7)

    assert captured["model"] == "configured-model"
    assert captured["contents"][1].inline_data.mime_type == "application/pdf"
    assert captured["contents"][1].inline_data.data == b"%PDF-test"
    schema = captured["config"].response_schema
    assert schema["title"] == "VisionResponse"
    assert "additionalProperties" not in json.dumps(schema)
    assert captured["config"].http_options.timeout == 7000
    assert captured["config"].http_options.retry_options.attempts == 1
    assert captured["closed"] is True
    assert result.metadata.model_version == "model-v1"
    assert result.metadata.usage == {"prompt_token_count": 11, "total_token_count": 22}


def test_gemini_adapter_reports_missing_configuration_and_provider_errors():
    provider = GeminiVisionProvider(Settings(_env_file=None))
    with pytest.raises(VisionProviderError, match="not configured") as missing:
        provider.extract_pdf(b"%PDF-test", "SI")
    assert missing.value.code == "AI_NOT_CONFIGURED"
    assert not missing.value.retryable

    for status, code, retryable in (
        (429, "AI_RATE_LIMITED", True),
        (403, "AI_ACCESS_DENIED", False),
        (500, "AI_PROVIDER_ERROR", True),
    ):
        error = type("ProviderFailure", (Exception,), {"code": status})()
        mapped = provider._provider_error(error)
        assert (mapped.code, mapped.retryable) == (code, retryable)
    assert provider._provider_error(TimeoutError()).code == "AI_TIMEOUT"
    assert provider._provider_error(ValueError()).code == "AI_INVALID_RESPONSE"


def test_visual_response_rejects_bad_field_sets_pages_and_role_mismatch():
    with pytest.raises(ValueError, match="every supported field"):
        VisionResponse(
            detected_role="SI",
            fields=[
                VisionCandidate(field="shipper", raw_value="A", page=1, excerpt="A")
                for _ in FIELD_KEYS
            ],
        )

    content = (FIXTURES / "email_512_SI.pdf").read_bytes()
    base = extract_document(content, "scan.pdf", "scan", expected_role="SI")
    metadata = ProviderMetadata(configured_model="fake-model", prompt_version="test", duration_ms=1)
    mismatched = apply_visual_candidates(
        base, VisionResult(response=response("BL"), metadata=metadata), "SI"
    )
    assert any(issue.code == "DOCUMENT_ROLE_MISMATCH" for issue in mismatched.issues)

    with pytest.raises(VisionProviderError) as invalid_page:
        apply_visual_candidates(
            base,
            VisionResult(response=response("SI", page=2), metadata=metadata),
            "SI",
        )
    assert invalid_page.value.code == "AI_INVALID_RESPONSE"


@pytest.fixture
def scan_client(tmp_path):
    source = tmp_path / "dataset"
    (source / "inbox").mkdir(parents=True)
    (source / "attachments").mkdir()
    si = (FIXTURES / "email_512_SI.pdf").read_bytes()
    # The organizer BL is a separate immutable scan. The fixture copy deliberately uses
    # distinct bytes without adding a text layer or runtime answer data.
    bl = si.replace(b"ReportLab Generated", b"ReportLab generated", 1)
    (source / "attachments/scan-si.pdf").write_bytes(si)
    (source / "attachments/scan-bl.pdf").write_bytes(bl)
    (source / "inbox/email_512.json").write_text(
        json.dumps(
            {
                "email_id": "email_512",
                "from": "shipping@example.test",
                "subject": "Check draft BL",
                "body": "Please compare the scanned SI and draft BL.",
                "attachments": ["attachments/scan-si.pdf", "attachments/scan-bl.pdf"],
            }
        )
    )
    settings = Settings(
        local_data_dir=tmp_path / "local",
        dev_audit_db=tmp_path / "audit.sqlite3",
        _env_file=None,
    )
    Store(settings.local_data_dir).import_dataset(source)
    fake = FakeVisionProvider(si, bl)
    with TestClient(create_app(settings, vision_provider=fake)) as client:
        yield client, settings, fake


def test_visual_candidates_review_overlay_refresh_and_stale_protection(scan_client):
    client, settings, fake = scan_client
    baseline = client.post("/api/v1/dev/samples/email_512/analyze", json={"expected_revision": 1})
    assert baseline.status_code == 200, baseline.text
    task = client.post(PREFIX, json={"sample_id": "email_512"}).json()
    analyzed = client.post(
        f"{PREFIX}/{task['id']}/analyze", json={"expected_revision": task["revision"]}
    )
    assert analyzed.status_code == 200, analyzed.text
    task = analyzed.json()
    machine = task["current_run"]["result"]
    assert machine["workflow_state"] == "REVIEW_REQUIRED"
    assert task["current_run"]["review_progress"] == {
        "total": 14,
        "reviewed": 0,
        "confirmed": 0,
        "corrected": 0,
        "supplied": 0,
        "pending": 14,
    }
    assert len(machine["provider_calls"]) == 2
    assert [call[1] for call in fake.calls[-2:]] == ["SI", "BL"]
    assert fake.calls[-2][0] != fake.calls[-1][0]
    assert all(
        side["method"] == "gemini_vision" and side["requires_human_confirmation"]
        for field in machine["fields"]
        for side in (field["si"], field["bl"])
    )

    run_id = task["current_run"]["id"]
    documents = {item["role"]: item["id"] for item in machine["documents"]}
    for field in FIELD_KEYS:
        for role in ("si", "bl"):
            correction = field == "gross_weight_kg" and role == "bl"
            payload = {
                "expected_revision": task["revision"],
                "run_id": run_id,
                "document_id": documents[role],
                "field": field,
                "action": "CORRECT_EXTRACTION" if correction else "CONFIRM_CANDIDATE",
                "raw_value": VALUES[field] if correction else None,
                "evidence": {"page": 1},
            }
            saved = client.post(f"{PREFIX}/{task['id']}/reviews", json=payload)
            assert saved.status_code == 200, saved.text
            task = saved.json()
            if field == "shipper" and role == "si":
                assert task["current_run"]["reviewed_result"]["fields"][0]["finding"] == (
                    "NEEDS_REVIEW"
                )
                assert task["current_run"]["review_progress"]["reviewed"] == 1

    reviewed = task["current_run"]["reviewed_result"]
    assert reviewed["workflow_state"] == "READY"
    assert reviewed["coverage"] == {"checked": 7, "total": 7}
    assert all(item["finding"] == "MATCH" for item in reviewed["fields"])
    assert task["current_run"]["review_progress"] == {
        "total": 14,
        "reviewed": 14,
        "confirmed": 13,
        "corrected": 1,
        "supplied": 0,
        "pending": 0,
    }
    assert task["current_run"]["result"] == machine
    assert task["workflow_state"] == "READY"

    stale = client.post(
        f"{PREFIX}/{task['id']}/reviews",
        json={
            "expected_revision": task["revision"] + 1,
            "run_id": run_id,
            "document_id": documents["si"],
            "field": "shipper",
            "action": "CONFIRM_CANDIDATE",
            "evidence": {"page": 1},
        },
    )
    assert stale.status_code == 409

    for invalid in (
        {"run_id": "not-the-current-run", "document_id": documents["si"]},
        {"run_id": run_id, "document_id": "not-the-current-document"},
    ):
        rejected = client.post(
            f"{PREFIX}/{task['id']}/reviews",
            json={
                "expected_revision": task["revision"],
                **invalid,
                "field": "shipper",
                "action": "CONFIRM_CANDIDATE",
                "evidence": {"page": 1},
            },
        )
        assert rejected.status_code == 409

    repeated = client.post(
        f"{PREFIX}/{task['id']}/reviews",
        json={
            "expected_revision": task["revision"],
            "run_id": run_id,
            "document_id": documents["bl"],
            "field": "gross_weight_kg",
            "action": "CORRECT_EXTRACTION",
            "raw_value": VALUES["gross_weight_kg"],
            "evidence": {"page": 1},
        },
    )
    assert repeated.status_code == 200
    task = repeated.json()
    assert len(task["current_run"]["review_actions"]) == 15
    assert task["current_run"]["review_progress"]["corrected"] == 1
    assert task["current_run"]["result"] == machine

    fake.fail = True
    failed = client.post(
        f"{PREFIX}/{task['id']}/analyze", json={"expected_revision": task["revision"]}
    )
    assert failed.status_code == 200
    task = failed.json()
    assert task["latest_run"]["status"] == "FAILED"
    assert task["latest_run"]["error"]["code"] == "AI_PROVIDER_ERROR"
    assert task["current_run"]["id"] == run_id
    assert task["current_run"]["result"] == machine
    assert task["current_run"]["reviewed_result"]["workflow_state"] == "READY"

    with TestClient(create_app(settings, vision_provider=fake)) as reopened:
        restored = reopened.get(f"{PREFIX}/{task['id']}").json()
        assert restored["current_run"]["result"] == machine
        assert restored["current_run"]["reviewed_result"]["workflow_state"] == "READY"
        historical = reopened.get(f"{PREFIX}/{task['id']}/runs/{run_id}").json()
        assert len(historical["current_run"]["review_actions"]) == 15
