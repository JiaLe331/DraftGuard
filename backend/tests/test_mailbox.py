import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.dev_extraction import service as extraction_service
from app.main import create_app
from app.store import Store, StoreError

SI = """SHIPPING INSTRUCTION
Shipper: EXPORTER LTD
Consignee: BUYER LTD
Notify Party: BUYER LTD
POL: SINGAPORE
POD: HOUSTON, US
Container Count: 2 x 40'HC
Gross Weight (KG): 20,000 KG
"""
BL = SI.replace("SHIPPING INSTRUCTION", "BILL OF LADING (DRAFT)")


def dataset(root, count=1):
    (root / "inbox").mkdir(parents=True)
    (root / "attachments").mkdir()
    for number in range(count):
        email_id = f"email_{number:03}"
        files = []
        for role, content in (("SI", SI), ("BL", BL)):
            name = f"attachments/{email_id}_{role}.txt"
            (root / name).write_text(content)
            files.append(name)
        (root / "inbox" / f"{email_id}.json").write_text(
            json.dumps(
                {
                    "email_id": email_id,
                    "from": "shipping@example.test",
                    "subject": "Check draft BL",
                    "body": "Please compare the SI and draft BL.",
                    "attachments": files,
                }
            )
        )
    return root


def test_import_is_idempotent_ignores_answers_and_preserves_source_versions(tmp_path):
    root = dataset(tmp_path / "input")
    store = Store(tmp_path / "local")
    (root / "ground_truth.json").write_text("NOT JSON; never a runtime input")
    assert store.import_dataset(root) == ["email_000"]
    original = store.analyze("email_000", 1, "precomputed")
    assert original["workflow_state"] == "READY"
    (root / "ground_truth.json").unlink()
    assert store.import_dataset(root) == []
    assert store.detail("email_000")["current_run"]["id"] == original["current_run"]["id"]
    (root / "attachments/email_000_BL.txt").write_text(BL.replace("BUYER LTD", "OTHER LTD"))
    store.import_dataset(root)
    changed = store.detail("email_000")
    assert changed["revision"] == 2
    assert changed["current_run"] is None
    assert changed["documents"][1]["version"] == 2
    assert store.get_document("email_000", original["documents"][1]["id"])[1].read_text() == BL
    result = store.analyze("email_000", 2)["current_run"]["result"]
    assert result["known_defect_fields"] == ["consignee", "notify_party"]
    assert len(store.detail("email_000")["runs"]) == 2
    assert Store(tmp_path / "local").detail("email_000")["current_run"]["result"] == result


def test_import_rejects_outside_paths_and_duplicate_ids_before_writes(tmp_path):
    root = dataset(tmp_path / "input")
    path = root / "inbox/email_000.json"
    email = json.loads(path.read_text())
    email["attachments"] = ["attachments/../../secret.txt"]
    path.write_text(json.dumps(email))
    store = Store(tmp_path / "local")
    with pytest.raises(StoreError, match="leaves the dataset"):
        store.import_dataset(root)
    assert store.list_samples()["total"] == 0
    email["attachments"] = []
    path.write_text(json.dumps(email))
    (root / "inbox/duplicate.json").write_text(json.dumps(email))
    with pytest.raises(StoreError, match="unique"):
        store.import_dataset(root)


def test_api_pagination_search_global_counts_content_and_production_gate(tmp_path):
    root = dataset(tmp_path / "input", 3)
    settings = Settings(
        local_data_dir=tmp_path / "local", dev_audit_db=tmp_path / "audit.sqlite3", _env_file=None
    )
    store = Store(settings.local_data_dir)
    store.import_dataset(root)
    with TestClient(create_app(settings)) as client:
        page = client.get("/api/v1/samples?limit=2&page=2&q=email_002").json()
        assert page["total"] == 1 and page["items"] == []
        assert page["summary"]["total"] == 3 and page["summary"]["attachments"] == 6
        response = client.post(
            "/api/v1/dev/samples/email_000/analyze", json={"expected_revision": 1}
        )
        detail = response.json()
        assert detail["workflow_state"] == "READY"
        content = f"/api/v1/samples/email_000/documents/{detail['documents'][0]['id']}/content"
        assert client.get(content).content == (root / "attachments/email_000_SI.txt").read_bytes()
        assert client.get(content.replace("/email_000/", "/email_001/")).status_code == 404
        assert client.get("/api/v1/samples?limit=9999").status_code == 422
        assert (
            client.post(
                "/api/v1/dev/samples/email_000/analyze", json={"expected_revision": 0}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/v1/dev/samples/email_000/analyze", json={"expected_revision": 2}
            ).status_code
            == 409
        )
        assert (
            client.post(
                "/api/v1/dev/samples/email_000/analyze",
                json={"expected_revision": 1},
                headers={"Origin": "https://untrusted.example"},
            ).status_code
            == 403
        )
        preflight = client.options(
            "/api/v1/dev/samples/email_000/analyze",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert preflight.status_code == 200
    with TestClient(create_app(Settings(app_env="production", _env_file=None))) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/v1/samples").status_code == 404


def test_failed_rerun_preserves_success_and_retry_recovers(tmp_path, monkeypatch):
    store = Store(tmp_path / "local")
    store.import_dataset(dataset(tmp_path / "input"))
    original = store.analyze("email_000", 1)
    worker = extraction_service.run_worker

    def timeout(*args, **kwargs):
        return None, [], {"code": "EXTRACTION_TIMEOUT", "message": "Test worker timed out."}

    monkeypatch.setattr(extraction_service, "run_worker", timeout)
    failed = store.analyze("email_000", 1)
    assert failed["workflow_state"] == "FAILED"
    assert failed["current_run"]["id"] == original["current_run"]["id"]
    assert failed["latest_run"]["error"]["code"] == "analysis_timeout"
    monkeypatch.setattr(extraction_service, "run_worker", worker)
    recovered = store.analyze("email_000", 1)
    assert recovered["workflow_state"] == "READY"
    assert len(recovered["runs"]) == 3


def test_duplicate_and_stale_runs_cannot_overwrite_current(tmp_path, monkeypatch):
    store = Store(tmp_path / "local")
    store.import_dataset(dataset(tmp_path / "input"))
    entered, release = Event(), Event()
    worker = extraction_service.run_worker

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return worker(*args, **kwargs)

    monkeypatch.setattr(extraction_service, "run_worker", blocked)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(store.analyze, "email_000", 1)
        assert entered.wait(5)
        try:
            with pytest.raises(StoreError, match="already running"):
                store.analyze("email_000", 1)
            # Simulate a future source-write path advancing while a worker holds an old snapshot.
            with store.connect() as db:
                db.execute("UPDATE emails SET revision=2 WHERE id='email_000'")
        finally:
            release.set()
        detail = pending.result()
    assert detail["current_run"] is None
    assert detail["latest_run"]["error"]["code"] == "stale_run"


def test_source_tampering_is_not_parsed_as_a_valid_run(tmp_path):
    store = Store(tmp_path / "local")
    store.import_dataset(dataset(tmp_path / "input"))
    original = store.analyze("email_000", 1)
    doc, path = store.get_document("email_000", original["documents"][0]["id"])
    path.write_text("CHANGED")
    failed = store.analyze("email_000", 1)
    assert failed["latest_run"]["error"]["code"] == "source_unavailable"
    assert failed["current_run"]["id"] == original["current_run"]["id"]


def test_interrupted_runs_expire_without_auto_retry(tmp_path):
    store = Store(tmp_path / "local")
    store.import_dataset(dataset(tmp_path / "input"))
    original = store.analyze("email_000", 1)
    with store.connect() as db:
        db.execute(
            "INSERT INTO runs (id,email_id,revision,document_ids,pipeline_version,mode,"
            "status,started_at) VALUES ('interrupted','email_000',1,'[]','rules-1',"
            "'interactive','RUNNING','2000-01-01T00:00:00+00:00')"
        )
        db.execute("UPDATE emails SET latest_run_id='interrupted' WHERE id='email_000'")
    detail = store.detail("email_000")
    assert detail["latest_run"]["error"]["code"] == "interrupted"
    assert detail["current_run"]["id"] == original["current_run"]["id"]
    assert len(detail["runs"]) == 2


def test_relative_data_directory_is_backend_relative():
    settings = Settings(local_data_dir=Path(".local"), _env_file=None)
    assert settings.local_data_dir == Path(__file__).resolve().parents[1] / ".local"
