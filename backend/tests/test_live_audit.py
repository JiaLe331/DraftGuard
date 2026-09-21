import json
import sqlite3
import sys
import time
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from test_dev_extraction import settings as settings
from test_dev_extraction import upload

from app.dev_extraction import process
from app.dev_extraction.store import AuditStore, event
from app.main import create_app


def eventually(check, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError("Timed out waiting for the observed condition")


def paused_worker(monkeypatch, tmp_path, *, crash=False):
    gate = tmp_path / "continue"
    original = process.subprocess.Popen
    script = f"""
import base64, json, sys, time, os
from pathlib import Path
from app.extraction import extract_document
from app.dev_extraction.worker import send
request = json.load(sys.stdin)
gate = Path({str(gate)!r})
def observe(item):
    send('event', item)
    if item['stage'] == 'candidates':
        while not gate.exists():
            time.sleep(.02)
        if {crash!r}:
            os._exit(9)
result = extract_document(base64.b64decode(request['content']), request['filename'],
    request['document_id'], request['expected_role'], observer=observe)
send('result', result.model_dump(mode='json'))
"""
    monkeypatch.setattr(
        process.subprocess,
        "Popen",
        lambda command, **kwargs: original([sys.executable, "-u", "-c", script], **kwargs),
    )
    return gate


def start(client, email="email_004"):
    response = client.post(f"/api/v1/dev/emails/{email}/extract?wait=false")
    assert response.status_code == 202
    return response.json()["run_id"]


def has_candidates(client, run_id):
    page = client.get(f"/api/v1/dev/runs/{run_id}/events?limit=500").json()
    return page if any(e["stage"] == "candidates" for e in page["items"]) else None


def finished(client, run_id):
    run = client.get(f"/api/v1/dev/runs/{run_id}").json()
    return run if run.get("processing_status") != "RUNNING" else None


def test_live_source_checkpoints_capacity_and_cursors(settings, monkeypatch, tmp_path):
    gate = paused_worker(monkeypatch, tmp_path)
    with TestClient(create_app(settings)) as client:
        try:
            first, second = start(client), start(client, "email_055")
            rejected = client.post("/api/v1/dev/emails/email_516/extract?wait=false")
            assert rejected.status_code == 503
            assert rejected.json()["error"]["code"] == "EXTRACTION_BUSY"
            assert rejected.json()["error"]["retryable"]
            page = eventually(lambda: has_candidates(client, first))
            assert page["processing_status"] == "RUNNING"
            run = client.get(f"/api/v1/dev/runs/{first}").json()
            assert run["documents"][0]["result"] is None
            units = {u["unit_id"]: u for u in run["documents"][0]["source_units"]}
            assert units
            for item in page["items"]:
                assert item["run_id"] == first and item["request_id"] == run["request_id"]
                for candidate in item["details"].get("candidates", []):
                    assert all(
                        units[ref]["document_id"] == item["document_id"]
                        for ref in candidate["source_unit_ids"]
                    )
            one = client.get(f"/api/v1/dev/runs/{first}/events?limit=1").json()
            assert one["has_more"] and one["next_after_sequence"] == 1
            two = client.get(f"/api/v1/dev/runs/{first}/events?after_sequence=1&limit=1").json()
            assert two["items"][0]["sequence"] == 2
            assert client.get(f"/api/v1/dev/runs/{first}/events?limit=501").status_code == 422
        finally:
            gate.write_text("continue")
        result = eventually(lambda: finished(client, first))
        eventually(lambda: finished(client, second))
        assert result["processing_status"] == "SUCCEEDED"
        assert result["events"][-1]["stage"] == "run"
        assert result["events"][-1]["status"] == "SUCCEEDED"
        assert [e["sequence"] for e in result["events"]] == list(
            range(1, len(result["events"]) + 1)
        )
        assert client.get(f"/api/v1/dev/runs?q={first}").json()["total"] == 1
        assert client.get("/api/v1/dev/runs?q=email_055&needs_review=true").json()["total"] == 0
        assert client.get("/api/v1/dev/runs?q=email_055&needs_review=false").json()["total"] == 1
        assert (
            client.get("/api/v1/dev/runs?q=email_004_SI.txt&status=SUCCEEDED").json()["total"] == 1
        )
        assert client.get("/api/v1/dev/runs?source_type=upload").json()["total"] == 0


def test_async_upload_original_is_saved_before_acceptance(settings, monkeypatch, tmp_path):
    gate = paused_worker(monkeypatch, tmp_path)
    application = create_app(settings)
    with TestClient(application) as client:
        try:
            response = client.post(
                "/api/v1/dev/extract?wait=false",
                files={
                    "file": ("source.txt", b"SHIPPING INSTRUCTION\nShipper: Acme"),
                },
            )
            assert response.status_code == 202
            run = response.json()
            doc = run["documents"][0]
            original = client.get(
                f"/api/v1/dev/runs/{run['run_id']}/documents/{doc['document_id']}/original"
            )
            assert original.content == b"SHIPPING INSTRUCTION\nShipper: Acme"
            assert doc["has_original"]
        finally:
            gate.write_text("continue")


@pytest.mark.parametrize("mode", ["crash", "timeout", "shutdown"])
def test_interrupted_workers_retain_trace(settings, monkeypatch, tmp_path, mode):
    gate = paused_worker(monkeypatch, tmp_path, crash=mode == "crash")
    if mode == "timeout":
        settings.dev_document_timeout = 2
    application = create_app(settings)
    with TestClient(application) as client:
        run_id = start(client, "email_516")
        prefix = eventually(lambda: has_candidates(client, run_id))["items"]
        if mode == "crash":
            gate.write_text("continue")
        elif mode == "shutdown":
            application.state.run_service.shutdown()
        run = eventually(lambda: finished(client, run_id))
        assert run["events"][: len(prefix)] == prefix
        assert run["processing_status"] == ("INTERRUPTED" if mode == "shutdown" else "FAILED")
        assert run["documents"][0]["result"] is None
        assert (
            run["documents"][0]["error"]["code"]
            == {
                "crash": "WORKER_FAILED",
                "timeout": "EXTRACTION_TIMEOUT",
                "shutdown": "RUN_INTERRUPTED",
            }[mode]
        )


def test_recording_failure_stops_worker_and_never_reports_success(settings, monkeypatch, tmp_path):
    gate = paused_worker(monkeypatch, tmp_path)
    application = create_app(settings)
    with TestClient(application) as client:
        run_id = start(client)
        prefix = eventually(lambda: has_candidates(client, run_id))["items"]
        original_save = application.state.audit_store.save
        with monkeypatch.context() as patch:
            patch.setattr(
                application.state.audit_store,
                "save",
                lambda *args, **kwargs: (_ for _ in ()).throw(sqlite3.OperationalError()),
            )
            gate.write_text("continue")
            eventually(lambda: client.get(f"/api/v1/dev/runs/{run_id}").status_code == 503)
            assert client.get(f"/api/v1/dev/runs/{run_id}/events").status_code == 503
            application.state.run_service.shutdown()
        assert application.state.audit_store.save == original_save
    with TestClient(create_app(settings)) as client:
        recovered = client.get(f"/api/v1/dev/runs/{run_id}").json()
        assert recovered["processing_status"] == "INTERRUPTED"
        assert recovered["events"][: len(prefix)] == prefix
        assert recovered["events"][-1]["status"] == "INTERRUPTED"


def test_legacy_migration_is_lossless_idempotent_and_append_only(settings, tmp_path):
    with TestClient(create_app(settings)) as client:
        saved = upload(client).json()
    legacy = deepcopy(saved)
    legacy.pop("audit_version")
    legacy.pop("events")
    path = tmp_path / "legacy.sqlite3"
    payload = json.dumps(legacy)
    original = b"exact-original\r\nbytes"
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE runs (run_id TEXT PRIMARY KEY, created_at TEXT, "
            "status TEXT, payload TEXT)"
        )
        db.execute(
            "CREATE TABLE originals (run_id TEXT, document_id TEXT, filename TEXT, "
            "content BLOB, PRIMARY KEY(run_id,document_id))"
        )
        db.execute(
            "INSERT INTO runs VALUES (?,?,?,?)",
            (legacy["run_id"], legacy["created_at"], "SUCCEEDED", payload),
        )
        db.execute(
            "INSERT INTO originals VALUES (?,?,?,?)",
            (legacy["run_id"], legacy["documents"][0]["document_id"], "source.pdf", original),
        )
    store = AuditStore(path)
    store.initialize()
    events = store.events(legacy["run_id"], limit=500)
    assert events["trace_mode"] == "legacy"
    assert len(events["items"]) == sum(len(d["events"]) for d in legacy["documents"])
    store.initialize()
    assert store.events(legacy["run_id"], limit=500) == events
    assert store.get(legacy["run_id"]) == legacy
    with store.connect() as db:
        assert db.execute("SELECT payload FROM runs").fetchone()[0] == payload
        assert db.execute("SELECT content FROM originals").fetchone()[0] == original
    for sql in ["UPDATE audit_events SET sequence=999", "DELETE FROM audit_events"]:
        with pytest.raises(sqlite3.IntegrityError), store.connect() as db:
            db.execute(sql)
    with pytest.raises(sqlite3.IntegrityError):
        store.save(legacy, [event("run", "SUCCEEDED", "Must not be inserted")])


def test_final_event_and_result_commit_is_atomic(settings):
    with TestClient(create_app(settings)) as client:
        saved = upload(client).json()
    store = AuditStore(settings.dev_audit_db)
    ongoing = deepcopy(saved)
    ongoing.update(run_id="atomic-test", processing_status="RUNNING", events=[])
    store.create(ongoing)
    before = store.get("atomic-test")
    with store.connect() as db:
        db.execute("""CREATE TRIGGER reject_finish BEFORE UPDATE ON runs
            WHEN NEW.run_id='atomic-test' AND NEW.status='SUCCEEDED'
            BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
    ongoing["processing_status"] = "SUCCEEDED"
    with pytest.raises(sqlite3.IntegrityError):
        store.save(ongoing, [event("run", "SUCCEEDED", "Finished")])
    assert store.get("atomic-test") == before
    assert store.events("atomic-test")["items"] == []


def test_recording_failure_can_be_finalized_after_storage_recovers(settings):
    application = create_app(settings)
    with TestClient(application) as client:
        saved = upload(client).json()
        ongoing = deepcopy(saved)
        ongoing.update(run_id="storage-recovery", processing_status="RUNNING", events=[])
        ongoing["documents"][0].update(processing_status="RUNNING", result=None, events=[])
        application.state.audit_store.create(ongoing)
        application.state.run_service.recording_failures.add("storage-recovery")
        application.state.run_service.check_recording("storage-recovery")
        failed = application.state.audit_store.get("storage-recovery")
        assert failed["processing_status"] == "FAILED"
        assert failed["issues"][-1]["code"] == "AUDIT_SAVE_FAILED"
        assert failed["events"][-1]["status"] == "FAILED"
        assert "storage-recovery" not in application.state.run_service.recording_failures
