import json
import sqlite3
from hashlib import sha256
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures/extraction"


@pytest.fixture
def settings(tmp_path):
    root = tmp_path / "bundle"
    (root / "inbox").mkdir(parents=True)
    (root / "attachments").mkdir()
    for fixture in FIXTURES.iterdir():
        if fixture.suffix in {".pdf", ".txt", ".docx", ".xlsx"}:
            (root / "attachments" / fixture.name).write_bytes(fixture.read_bytes())
    records = {
        "email_004": ["email_004_SI.txt", "email_004_BL.txt"],
        "email_055": ["email_055_SI.xlsx", "email_055_BL.docx"],
        "email_516": ["email_516_SI.txt", "email_516_BL.txt"],
        "email_512": ["email_512_SI.pdf"],
        "email_000": [],
        "email_999": ["missing.pdf", "email_004_SI.txt"],
    }
    for email_id, attachments in records.items():
        (root / "inbox" / f"{email_id}.json").write_text(
            json.dumps(
                {
                    "email_id": email_id,
                    "from": "sender@example.test",
                    "subject": f"Review {email_id}",
                    "body": "Please check the attached documents.",
                    "attachments": [f"attachments/{a}" for a in attachments],
                }
            ),
            encoding="utf-8",
        )
    return Settings(
        _env_file=None,
        enable_dev_extraction=True,
        local_data_dir=tmp_path / "mailbox",
        dataset_dir=root,
        dev_audit_db=tmp_path / "audit.sqlite3",
    )


def upload(client, name="email_160_SI.pdf", role=None):
    return client.post(
        "/api/v1/dev/extract",
        files={
            "file": (name, (FIXTURES / name).read_bytes()),
        },
        data={"expected_role": role} if role else {},
    )


def test_upload_persists_real_fields_trace_and_original(settings):
    application = create_app(settings)
    with TestClient(application) as client:
        response = upload(client, role="SI")
        assert response.status_code == 200
        run = response.json()
        assert run["processing_status"] == "SUCCEEDED"
        assert not run["needs_review"]
        document = run["documents"][0]
        assert (
            document["content_sha256"]
            == sha256((FIXTURES / "email_160_SI.pdf").read_bytes()).hexdigest()
        )
        assert len(document["result"]["fields"]) == 7
        stages = {e["stage"] for e in document["events"]}
        assert {
            "validation",
            "parsing",
            "role_detection",
            "candidates",
            "normalization",
            "field_result",
            "completed",
        } <= stages
        weight = next(
            e
            for e in document["events"]
            if e["stage"] == "candidates" and e["details"]["field"] == "gross_weight_kg"
        )
        assert any(not c["selected"] for c in weight["details"]["candidates"])
        assert all(e["timestamp"] and e["elapsed_ms"] >= 0 for e in document["events"])
        identifier = run["run_id"]
        assert client.get(f"/api/v1/dev/runs/{identifier}").json() == run
        exported = client.get(f"/api/v1/dev/runs/{identifier}?download=true")
        assert exported.json() == run
        assert "attachment" in exported.headers["content-disposition"]
        path = f"/api/v1/dev/runs/{identifier}/documents/{document['document_id']}/original"
        original = client.get(path)
        assert original.content == (FIXTURES / "email_160_SI.pdf").read_bytes()
        assert "attachment" in original.headers["content-disposition"]
        assert "inline" in client.get(path + "?disposition=inline").headers["content-disposition"]
        with pytest.raises(sqlite3.IntegrityError):
            application.state.audit_store.save(run)
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get(f"/api/v1/dev/runs/{identifier}").json() == run
        assert restarted.get("/api/v1/dev/runs").json()["total"] == 1


@pytest.mark.parametrize(
    "email_id,document_count,needs_review",
    [
        ("email_004", 2, False),
        ("email_055", 2, False),
        ("email_516", 2, True),
        ("email_512", 1, True),
        ("email_000", 0, True),
        ("email_999", 2, True),
    ],
)
def test_dataset_attachments_are_processed_independently(
    settings, email_id, document_count, needs_review
):
    with TestClient(create_app(settings)) as client:
        assert client.get(f"/api/v1/dev/emails/{email_id}").status_code == 200
        assert client.get("/api/v1/dev/runs").json()["total"] == 0
        response = client.post(f"/api/v1/dev/emails/{email_id}/extract")
        assert response.status_code == 200
        run = response.json()
        assert len(run["documents"]) == document_count
        assert run["needs_review"] is needs_review
        assert run["email"]["email_id"] == email_id
        if email_id == "email_999":
            assert run["processing_status"] == "FAILED"
            assert run["documents"][0]["error"]["code"] == "ATTACHMENT_UNAVAILABLE"
            assert run["documents"][1]["processing_status"] == "SUCCEEDED"
        if email_id == "email_000":
            assert run["issues"][0]["code"] == "NO_ATTACHMENTS"
        if email_id == "email_055":
            assert not any(
                i["code"] == "MISSING_WEIGHT_UNIT" for i in run["documents"][0]["result"]["issues"]
            )
        if email_id == "email_516":
            weight = next(
                f
                for f in run["documents"][0]["result"]["fields"]
                if f["field"] == "gross_weight_kg"
            )
            assert weight["value_state"] == "MISSING"
            assert weight["normalized_value"] is None
        for document in run["documents"]:
            if document["result"]:
                units = {u["unit_id"]: u for u in document["result"]["source_units"]}
                for field in document["result"]["fields"]:
                    for evidence in field["evidence"]:
                        assert evidence["document_id"] == document["document_id"]
                        assert evidence["excerpt"] in units[evidence["unit_id"]]["text"]


def test_new_run_does_not_overwrite_history_or_allow_cross_run_originals(settings):
    with TestClient(create_app(settings)) as client:
        first, second = upload(client).json(), upload(client).json()
        assert first["run_id"] != second["run_id"]
        assert client.get(f"/api/v1/dev/runs/{first['run_id']}").json() == first
        document_id = first["documents"][0]["document_id"]
        wrong = f"/api/v1/dev/runs/{second['run_id']}/documents/{document_id}/original"
        assert client.get(wrong).status_code == 404


@pytest.mark.parametrize(
    "environment,enabled", [("production", True), ("development", False), ("staging", True)]
)
def test_disabled_routes_and_health(settings, environment, enabled):
    settings.app_env, settings.enable_dev_extraction = environment, enabled
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/v1/dev/extract").status_code == 404
        assert client.get("/api/v1/dev/runs").status_code == 404
        assert (
            client.get("/api/v1/dev/runs/00000000-0000-0000-0000-000000000000/events").status_code
            == 404
        )
        assert not client.get("/api/health").json()["capabilities"]["development_extraction"]
    assert not settings.dev_audit_db.exists()


def test_request_file_limits_and_validation(settings):
    settings.dev_upload_limit, settings.dev_request_limit = 100, 2000
    with TestClient(create_app(settings)) as client:
        too_large = client.post("/api/v1/dev/extract", files={"file": ("source.txt", b"x" * 101)})
        assert too_large.status_code == 413
        assert too_large.json()["error"]["code"] == "FILE_TOO_LARGE"
        body = client.post("/api/v1/dev/extract", content=b"x" * 2001)
        assert body.status_code == 413
        assert body.json()["error"]["request_id"]
        assert client.post("/api/v1/dev/extract", json={}).status_code == 415
        invalid = client.post(
            "/api/v1/dev/extract", files={"file": ("a.txt", b"a")}, data={"expected_role": "BAD"}
        )
        assert invalid.status_code == 422
        assert client.get("/api/v1/dev/runs").json()["total"] == 0


def test_streamed_request_limit_without_content_length(settings):
    settings.dev_request_limit = 100
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/dev/extract",
            content=iter(
                [
                    b"--boundary\r\nContent-Disposition: form-data; "
                    b'name="file"; filename="a.txt"\r\n\r\n',
                    b"x" * 200,
                    b"\r\n--boundary--\r\n",
                ]
            ),
            headers={"Content-Type": "multipart/form-data; boundary=boundary"},
        )
        assert response.status_code == 413


def test_dataset_paths_cannot_escape_and_listing_is_paginated(settings):
    path = settings.dataset_dir / "inbox/email_999.json"
    record = json.loads(path.read_text())
    record["attachments"] = ["attachments/../../secret.txt"]
    path.write_text(json.dumps(record))
    with TestClient(create_app(settings)) as client:
        listing = client.get("/api/v1/dev/emails?limit=2").json()
        assert len(listing["items"]) == 2 and listing["total"] == 5
        assert client.get("/api/v1/dev/emails?has_attachments=false").json()["total"] == 6
        assert client.get("/api/v1/dev/emails?q=004").json()["total"] == 1
        response = client.post("/api/v1/dev/emails/email_999/extract").json()
        assert response["documents"][0]["error"]["code"] == "ATTACHMENT_PATH_INVALID"
        assert client.get("/api/v1/dev/emails/ground_truth").status_code == 404


def test_timeout_is_saved_with_no_fabricated_result(settings):
    settings.dev_document_timeout = 0.001
    with TestClient(create_app(settings)) as client:
        run = upload(client).json()
        assert run["processing_status"] == "FAILED"
        doc = run["documents"][0]
        assert doc["result"] is None
        assert doc["error"]["code"] == "EXTRACTION_TIMEOUT"
        assert doc["events"][-1]["status"] == "FAILED"


def test_failed_save_is_visible_and_interrupted_run_survives(settings, monkeypatch):
    application = create_app(settings)
    with TestClient(application) as client:
        with monkeypatch.context() as patch:
            patch.setattr(
                application.state.audit_store,
                "save",
                lambda *args, **kwargs: (_ for _ in ()).throw(sqlite3.OperationalError()),
            )
            failed = upload(client)
            assert failed.status_code == 503
            assert failed.json()["error"]["code"] == "AUDIT_SAVE_FAILED"
        run_id = client.get("/api/v1/dev/runs").json()["items"][0]["run_id"]
    with TestClient(create_app(settings)) as restarted:
        run = restarted.get(f"/api/v1/dev/runs/{run_id}").json()
        assert run["processing_status"] == "INTERRUPTED"
        assert run["issues"][-1]["code"] == "RUN_INTERRUPTED"


def test_malformed_document_and_cors(settings):
    with TestClient(create_app(settings)) as client:
        run = client.post("/api/v1/dev/extract", files={"file": ("bad.pdf", b"%PDF-broken")}).json()
        assert run["documents"][0]["result"]["parsing_status"] == "FAILED"
        assert run["documents"][0]["events"][-1]["status"] == "FAILED"
        preflight = client.options(
            "/api/v1/dev/extract",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"
        denied = client.options(
            "/api/v1/dev/extract",
            headers={
                "Origin": "https://not-allowed.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert denied.status_code == 400


def test_multipart_file_limit_stops_receiving_and_closes_spooled_file():
    import asyncio

    from starlette.datastructures import Headers

    from app.dev_extraction.dataset import DatasetError
    from app.dev_extraction.uploads import LimitedUploadParser

    class Request:
        headers = Headers({"content-type": "multipart/form-data; boundary=test"})

        async def stream(self):
            yield b'--test\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\n'
            yield b"x" * 101
            pytest.fail("The parser read more body after the file limit was exceeded")

    parser = LimitedUploadParser(Request(), 100)
    with pytest.raises(DatasetError, match="upload limit"):
        asyncio.run(parser.parse())
    assert all(file.closed for file in parser._files_to_close_on_error)


def test_incomplete_multipart_and_attachment_count_limit(settings):
    with TestClient(create_app(settings)) as client:
        invalid = client.post(
            "/api/v1/dev/extract",
            content=b"not-a-multipart-body",
            headers={"Content-Type": "multipart/form-data; boundary=test"},
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["code"] == "INVALID_MULTIPART"
        path = settings.dataset_dir / "inbox/email_004.json"
        record = json.loads(path.read_text())
        record["attachments"] *= 6
        path.write_text(json.dumps(record))
        assert client.post("/api/v1/dev/emails/email_004/extract").status_code == 413
        assert client.get("/api/v1/dev/runs").json()["total"] == 0


def test_email_run_timeout_preserves_completed_attachment(settings, monkeypatch):
    from app.dev_extraction import service

    actual_worker = service.run_worker
    settings.dev_run_timeout = 10

    def finish_first(*args):
        result = actual_worker(*args)
        # Deterministically exhaust the shared deadline after one real extraction.
        settings.dev_run_timeout = 0.00001
        return result

    monkeypatch.setattr(service, "run_worker", finish_first)
    with TestClient(create_app(settings)) as client:
        run = client.post("/api/v1/dev/emails/email_004/extract").json()
        assert run["processing_status"] == "FAILED"
        assert run["documents"][0]["processing_status"] == "SUCCEEDED"
        assert run["documents"][0]["result"]["fields"]
        assert run["documents"][1]["error"]["code"] == "RUN_TIMEOUT"
        assert client.get(f"/api/v1/dev/runs/{run['run_id']}").json() == run
