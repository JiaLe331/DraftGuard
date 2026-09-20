import json
import sqlite3
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from test_live_audit import eventually, has_candidates, paused_worker
from test_mailbox import dataset

from app.config import Settings
from app.extraction import extract_document
from app.main import create_app
from app.store import Store


@pytest.fixture
def mailbox(tmp_path):
    root = dataset(tmp_path / "input", 3)
    settings = Settings(
        _env_file=None,
        enable_dev_extraction=True,
        local_data_dir=tmp_path / "mailbox",
        dev_audit_db=tmp_path / "audit.sqlite3",
    )
    application = create_app(settings)
    application.state.mailbox_store.import_dataset(root)
    with TestClient(application) as client:
        yield client, application, settings, root


def start(client, email="email_000", wait=False):
    response = client.post(
        f"/api/v1/dev/samples/{email}/analyze?wait={str(wait).lower()}",
        json={"expected_revision": 1},
    )
    assert response.status_code == (200 if wait else 202), response.text
    return response.json()


def finished(client, email="email_000"):
    detail = client.get(f"/api/v1/samples/{email}").json()
    return detail if detail["latest_run"]["status"] != "RUNNING" else None


def test_mailbox_uses_identical_extraction_contract_and_originals(mailbox):
    client, app, _, root = mailbox
    detail = start(client, wait=True)
    saved = detail["current_run"]
    audit = client.get(f"/api/v1/dev/runs/{saved['audit_run_id']}").json()
    assert saved["pipeline_version"] == "mailbox-shared-2"
    assert audit["analysis"] == saved["result"]
    assert audit["source_type"] == "mailbox_email"
    assert audit["mailbox"]["run_id"] == saved["id"]
    assert audit["processing_status"] == "SUCCEEDED"
    assert detail["workflow_state"] == "READY"
    for document in audit["documents"]:
        content = (root / "attachments" / document["filename"]).read_bytes()
        expected = extract_document(content, document["filename"], document["document_id"])
        assert document["result"] == expected.model_dump(mode="json")
        assert document["document_id"] in saved["document_ids"]
        downloaded = client.get(
            f"/api/v1/dev/runs/{audit['run_id']}/documents/{document['document_id']}/original"
        )
        assert downloaded.content == content
    stages = [item["stage"] for item in audit["events"]]
    assert stages.index("classification") < stages.index("validation") < stages.index("comparison")
    assert stages.count("comparison") == 7
    assert [e["sequence"] for e in audit["events"]] == list(range(1, len(audit["events"]) + 1))
    units = {
        (d["document_id"], u["unit_id"]): u for d in audit["documents"] for u in d["source_units"]
    }
    for field in saved["result"]["fields"]:
        for side in ("si", "bl"):
            for evidence in field[side]["evidence"]:
                assert (
                    evidence["excerpt"]
                    in units[(evidence["document_id"], evidence["unit_id"])]["text"]
                )
    assert client.get("/api/v1/dev/runs?source_type=mailbox_email").json()["total"] == 1
    before = deepcopy(audit)
    start(client, wait=True)
    assert client.get(f"/api/v1/dev/runs/{audit['run_id']}").json() == before
    assert len(app.state.mailbox_store.detail("email_000")["runs"]) == 2


def test_live_mailbox_events_share_capacity_and_survive_refresh(mailbox, monkeypatch, tmp_path):
    client, _, _, _ = mailbox
    gate = paused_worker(monkeypatch, tmp_path)
    try:
        first = start(client)
        audit_id = first["latest_run"]["audit_run_id"]
        page = eventually(lambda: has_candidates(client, audit_id))
        assert page["processing_status"] == "RUNNING"
        assert (
            client.get("/api/v1/samples/email_000").json()["latest_run"]["audit_run_id"] == audit_id
        )
        duplicate = client.post(
            "/api/v1/dev/samples/email_000/analyze?wait=false", json={"expected_revision": 1}
        )
        assert duplicate.status_code == 409
        second = client.post(
            "/api/v1/dev/extract?wait=false",
            files={"file": ("file.txt", b"SHIPPING INSTRUCTION\nShipper: A LTD")},
        )
        assert second.status_code == 202
        busy = client.post(
            "/api/v1/dev/samples/email_001/analyze?wait=false", json={"expected_revision": 1}
        )
        assert busy.status_code == 503
        assert busy.json()["detail"]["code"] == "EXTRACTION_BUSY"
    finally:
        gate.touch()
    detail = eventually(lambda: finished(client))
    assert detail["current_run"]["audit_run_id"] == audit_id
    assert detail["workflow_state"] == "READY"


def test_failed_terminal_save_rolls_back_mailbox_success(mailbox, monkeypatch):
    client, app, _, _ = mailbox
    original = start(client, wait=True)["current_run"]
    save = app.state.audit_store.save

    def fail_completion(run, records=(), original=None, commit=None):
        if commit and run["processing_status"] == "SUCCEEDED":

            def fail_after_mailbox_write(db, payload):
                commit(db, payload)
                raise sqlite3.OperationalError("Simulated storage failure")

            return save(run, records, original, commit=fail_after_mailbox_write)
        return save(run, records, original, commit=commit)

    monkeypatch.setattr(app.state.audit_store, "save", fail_completion)
    response = client.post("/api/v1/dev/samples/email_000/analyze", json={"expected_revision": 1})
    assert response.status_code == 503
    detail = client.get("/api/v1/samples/email_000").json()
    assert detail["current_run"] == original
    assert detail["latest_run"]["status"] == "FAILED"
    assert detail["latest_run"]["error"]["code"] == "AUDIT_SAVE_FAILED"
    audit = client.get(f"/api/v1/dev/runs/{detail['latest_run']['audit_run_id']}").json()
    assert audit["processing_status"] == "FAILED"
    assert not any(e["stage"] == "run" and e["status"] == "SUCCEEDED" for e in audit["events"])
    assert any(e["stage"] == "comparison" for e in audit["events"])


def test_classification_skips_unrequested_comparison_and_retains_sources(mailbox):
    client, app, _, _ = mailbox
    with app.state.mailbox_store.connect() as db:
        db.execute(
            "UPDATE emails SET subject='Holiday announcement',body='Office resumes tomorrow.' "
            "WHERE id='email_000'"
        )
    detail = start(client, wait=True)
    assert detail["category"] == "GENERAL"
    assert detail["current_run"]["result"]["fields"] == []
    audit = client.get(f"/api/v1/dev/runs/{detail['current_run']['audit_run_id']}").json()
    assert all(
        d["has_original"] and d["processing_status"] == "SKIPPED" for d in audit["documents"]
    )
    assert not any(e["stage"] in {"parsing", "comparison"} for e in audit["events"])


def test_legacy_results_are_preserved_without_fabricating_audit_links(mailbox):
    _, app, settings, _ = mailbox
    store = app.state.mailbox_store
    legacy = {
        "classification": {"category": "GENERAL"},
        "workflow_state": "NOT_APPLICABLE",
        "known_defect_fields": [],
        "coverage": {"checked": 0, "total": 7},
    }
    with store.connect() as db:
        db.execute(
            "INSERT INTO runs (id,email_id,revision,document_ids,pipeline_version,mode,"
            "status,started_at,result) VALUES ('legacy','email_000',1,'[]','rules-1',"
            "'precomputed','SUCCEEDED','2026-09-01',?)",
            (json.dumps(legacy),),
        )
        db.execute(
            "UPDATE emails SET current_run_id='legacy',latest_run_id='legacy' WHERE id='email_000'"
        )
        db.execute("ALTER TABLE runs DROP COLUMN audit_run_id")
    reopened = Store(settings.local_data_dir).detail("email_000")
    assert reopened["current_run"]["result"] == legacy
    assert reopened["current_run"]["audit_run_id"] is None
    assert app.state.audit_store.list(10, 0)["total"] == 0


def test_shutdown_interrupts_mailbox_and_preserves_recorded_prefix(tmp_path, monkeypatch):
    settings = Settings(
        _env_file=None,
        enable_dev_extraction=True,
        local_data_dir=tmp_path / "mailbox",
        dev_audit_db=tmp_path / "audit.sqlite3",
    )
    application = create_app(settings)
    application.state.mailbox_store.import_dataset(dataset(tmp_path / "input"))
    gate = paused_worker(monkeypatch, tmp_path)
    try:
        with TestClient(application) as client:
            detail = start(client)
            audit_id = detail["latest_run"]["audit_run_id"]
            prefix = eventually(lambda: has_candidates(client, audit_id))["items"]
        with TestClient(create_app(settings)) as client:
            detail = client.get("/api/v1/samples/email_000").json()
            assert detail["latest_run"]["status"] == "FAILED"
            assert detail["current_run"] is None
            assert len(detail["runs"]) == 1
            audit = client.get(f"/api/v1/dev/runs/{audit_id}").json()
            assert audit["processing_status"] == "INTERRUPTED"
            assert audit["events"][: len(prefix)] == prefix
            assert audit["documents"][0]["has_original"]
    finally:
        gate.touch()
