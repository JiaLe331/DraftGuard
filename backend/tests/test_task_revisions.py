"""Real-source acceptance for the local task revision workflow."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.dev_extraction import service as extraction_service
from app.main import create_app
from app.store import Store

FIXTURES = Path(__file__).parent / "fixtures"
PREFIX = "/api/v1/dev/tasks"
NAMES = {"consignee", "notify_party"}


@pytest.fixture
def task_client(tmp_path):
    source = tmp_path / "dataset"
    (source / "inbox").mkdir(parents=True)
    (source / "attachments").mkdir()
    attachments = []
    for role in ("SI", "BL"):
        name = f"email_004_{role}.txt"
        (source / "attachments" / name).write_bytes((FIXTURES / "extraction" / name).read_bytes())
        attachments.append(f"attachments/{name}")
    (source / "inbox/email_004.json").write_text(
        json.dumps(
            {
                "email_id": "email_004",
                "from": "shipping@example.test",
                "subject": "Check draft BL",
                "body": "Please compare the SI and draft BL.",
                "attachments": attachments,
            }
        )
    )
    for email_id, extra_bl in (("email_104", False), ("email_204", True), ("email_304", False)):
        email = json.loads((source / "inbox/email_004.json").read_text())
        email["email_id"] = email_id
        if email_id == "email_304":
            missing_weight = "attachments/missing_weight_BL.txt"
            (source / missing_weight).write_text(
                (FIXTURES / "extraction/email_004_BL.txt").read_text().replace("131,058 KG", "N/A")
            )
            email["attachments"] = [attachments[0], missing_weight]
        if extra_bl:
            duplicate = "attachments/another_BL.txt"
            (source / duplicate).write_bytes(
                (FIXTURES / "extraction/email_004_BL.txt").read_bytes()
            )
            email["attachments"] = [*attachments, duplicate]
        (source / "inbox" / f"{email_id}.json").write_text(json.dumps(email))
    settings = Settings(
        local_data_dir=tmp_path / "local",
        dev_audit_db=tmp_path / "audit.sqlite3",
        _env_file=None,
    )
    store = Store(settings.local_data_dir)
    store.import_dataset(source)
    baseline = store.analyze("email_004", 1)
    with TestClient(create_app(settings)) as client:
        yield client, settings, baseline


def clone(client, sample_id="email_004"):
    response = client.post(PREFIX, json={"sample_id": sample_id})
    assert response.status_code in (200, 201), response.text
    return response.json()


def analyze(client, task):
    response = client.post(
        f"{PREFIX}/{task['id']}/analyze", json={"expected_revision": task["revision"]}
    )
    assert response.status_code == 200, response.text
    return response.json()


def replace(client, task, content, name="revised.txt", role="bl"):
    return client.post(
        f"{PREFIX}/{task['id']}/documents",
        data={"role": role, "expected_revision": task["revision"]},
        files={"file": (name, content, "application/octet-stream")},
    )


def upload_version(client, task, version):
    # Deliberately generic filename: only bytes determine findings.
    response = replace(
        client,
        task,
        (FIXTURES / "revisions" / f"team_email_004_BL_v{version}.txt").read_bytes(),
    )
    assert response.status_code in (200, 201), response.text
    updated = response.json()
    assert updated["revision"] == task["revision"] + 1
    assert updated["current_run"] is None
    return updated


def result(task):
    return task["current_run"]["result"]


def test_clone_preserves_baseline_and_copies_sources_without_machine_results(task_client):
    client, _, baseline = task_client
    task = clone(client)
    assert task["id"] != baseline["id"]
    assert task["baseline_id"] == baseline["id"]
    assert task["revision"] == 1
    assert task["current_run"] is None
    assert task["latest_run"] is None
    assert task["runs"] == []
    assert {d["sha256"] for d in task["documents"]} == {d["sha256"] for d in baseline["documents"]}
    assert not {d["id"] for d in task["documents"]} & {d["id"] for d in baseline["documents"]}
    analyze(client, task)
    assert client.get("/api/v1/samples/email_004").json() == baseline


def test_custom_task_and_record_kind_are_explicit(task_client):
    client, _, _ = task_client
    response = client.post(
        f"{PREFIX}/custom",
        json={
            "subject": "  New document check  ",
            "sender": " reviewer@example.test ",
            "body": " Compare the attached shipping documents. ",
        },
    )
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["record_kind"] == "task"
    assert task["baseline_id"] is None
    assert task["subject"] == "New document check"
    assert task["documents"] == []
    assert any(item["id"] == task["id"] for item in client.get(PREFIX).json()["items"])
    sample = client.get("/api/v1/samples/email_004").json()
    assert sample["record_kind"] == "sample"
    read_only = client.post("/api/v1/dev/samples/email_004/analyze", json={"expected_revision": 1})
    assert read_only.status_code == 409
    assert read_only.json()["detail"]["code"] == "sample_read_only"
    blank = client.post(f"{PREFIX}/custom", json={"subject": " ", "sender": "x", "body": "body"})
    assert blank.status_code == 422


def test_rule_extraction_can_be_corrected_against_current_source_unit(task_client):
    client, _, _ = task_client
    task = analyze(client, clone(client))
    run = task["current_run"]
    document = next(item for item in run["result"]["documents"] if item["role"] == "si")
    source = next(item for item in document["units"] if "APRIL FAR EAST" in item["text"])
    corrected_value = "APRIL FAR EAST (M) SDN BHD"
    corrected = client.post(
        f"{PREFIX}/{task['id']}/reviews",
        json={
            "expected_revision": task["revision"],
            "run_id": run["id"],
            "document_id": document["id"],
            "field": "shipper",
            "action": "CORRECT_EXTRACTION",
            "raw_value": corrected_value,
            "evidence": {"kind": "source_unit", "unit_id": source["unit_id"]},
        },
    )
    assert corrected.status_code == 200, corrected.text
    reviewed = next(
        item
        for item in corrected.json()["current_run"]["reviewed_result"]["fields"]
        if item["key"] == "shipper"
    )
    assert reviewed["si"]["method"] == "human"
    assert reviewed["si"]["evidence"][0]["verified"] is True
    assert corrected.json()["current_run"]["result"] == run["result"]

    forged = client.post(
        f"{PREFIX}/{task['id']}/reviews",
        json={
            "expected_revision": task["revision"],
            "run_id": run["id"],
            "document_id": document["id"],
            "field": "shipper",
            "action": "CORRECT_EXTRACTION",
            "raw_value": "NOT PRESENT IN SOURCE LTD",
            "evidence": {"kind": "source_unit", "unit_id": source["unit_id"]},
        },
    )
    assert forged.status_code == 422


def test_real_v1_v2_v3_deltas_reruns_history_and_persistence(task_client):
    client, settings, baseline = task_client
    first = analyze(client, clone(client))
    assert set(result(first)["known_defect_fields"]) == NAMES
    second = analyze(client, upload_version(client, first, 2))
    delta = result(second)["revision_delta"]
    assert delta["baseline_run_id"] == first["current_run"]["id"]
    assert set(delta["resolved"]) == NAMES
    assert delta["new"] == ["gross_weight_kg"]
    assert delta["persisting"] == delta["uncertain"] == []
    assert result(second)["known_defect_fields"] == ["gross_weight_kg"]
    rerun = analyze(client, second)
    assert result(rerun)["revision_delta"] == delta
    third = analyze(client, upload_version(client, rerun, 3))
    final_delta = result(third)["revision_delta"]
    assert final_delta["baseline_run_id"] == rerun["current_run"]["id"]
    assert final_delta["resolved"] == ["gross_weight_kg"]
    assert final_delta["new"] == final_delta["persisting"] == final_delta["uncertain"] == []
    assert result(third)["coverage"] == {"checked": 7, "total": 7}
    assert result(third)["known_defect_fields"] == []
    assert third["workflow_state"] == "READY"
    assert all(field["finding"] == "MATCH" for field in result(third)["fields"])
    history = client.get(f"{PREFIX}/{third['id']}/runs/{first['current_run']['id']}")
    assert history.status_code == 200, history.text
    historical = history.json()
    assert historical["is_historical"] is True
    assert historical["revision"] == 1
    assert historical["current_run"]["id"] == first["current_run"]["id"]
    assert historical["documents"] == first["documents"]
    assert result(historical) == result(first)
    assert client.get("/api/v1/samples/email_004").json() == baseline
    with TestClient(create_app(settings)) as reopened:
        saved = reopened.get(f"{PREFIX}/{third['id']}")
        assert saved.status_code == 200, saved.text
        assert saved.json()["current_run"] == third["current_run"]
        assert saved.json()["documents"] == third["documents"]


def test_supplied_information_stays_unresolved_and_blocks_completion(task_client):
    client, _, _ = task_client
    task = analyze(client, clone(client, "email_304"))
    run = task["current_run"]
    weight = next(field for field in run["result"]["fields"] if field["key"] == "gross_weight_kg")
    assert weight["bl"]["value_state"] == "MISSING"
    bl = next(doc for doc in run["result"]["documents"] if doc["role"] == "bl")

    supplied = client.post(
        f"{PREFIX}/{task['id']}/reviews",
        json={
            "expected_revision": task["revision"],
            "run_id": run["id"],
            "document_id": bl["id"],
            "field": "gross_weight_kg",
            "action": "SUPPLY_INFORMATION",
            "raw_value": "131,058 KG",
            "provenance": {
                "source_name": "Carrier confirmation",
                "reference": "Email dated 21 Sep 2026",
                "note": "Confirmed by forwarding agent",
            },
        },
    )
    assert supplied.status_code == 200, supplied.text
    task = supplied.json()
    reviewed_weight = next(
        field
        for field in task["current_run"]["reviewed_result"]["fields"]
        if field["key"] == "gross_weight_kg"
    )
    assert reviewed_weight["finding"] == "NEEDS_REVIEW"
    assert reviewed_weight["bl"]["value_state"] == "MISSING"
    assert reviewed_weight["bl"]["supplied_information"]["raw_value"] == "131,058 KG"
    assert task["current_run"]["review_progress"]["supplied"] == 1
    assert task["coverage"]["checked"] < 7

    blocked = client.post(
        f"{PREFIX}/{task['id']}/complete",
        json={
            "expected_revision": task["revision"],
            "run_id": run["id"],
            "acknowledge_seven_field_scope": True,
        },
    )
    assert blocked.status_code == 409
    assert "supplied_information_unverified" in {
        item["code"] for item in blocked.json()["detail"]["blockers"]
    }
    assert task["current_run"]["result"] == run["result"]

    missing_provenance = client.post(
        f"{PREFIX}/{task['id']}/reviews",
        json={
            "expected_revision": task["revision"],
            "run_id": run["id"],
            "document_id": bl["id"],
            "field": "gross_weight_kg",
            "action": "SUPPLY_INFORMATION",
            "raw_value": "131,058 KG",
        },
    )
    assert missing_provenance.status_code == 422


def test_completion_is_exact_idempotent_persisted_and_locks_review(task_client):
    client, settings, _ = task_client
    task = clone(client)
    task = analyze(client, upload_version(client, task, 3))
    run_id = task["current_run"]["id"]
    assert task["current_run"]["completion_eligibility"] == {
        "eligible": True,
        "blockers": [],
    }
    payload = {
        "expected_revision": task["revision"],
        "run_id": run_id,
        "acknowledge_seven_field_scope": True,
    }
    completed = client.post(f"{PREFIX}/{task['id']}/complete", json=payload)
    assert completed.status_code == 200, completed.text
    task = completed.json()
    assert task["workflow_state"] == "CHECK_COMPLETE"
    assert task["current_run"]["reviewed_result"]["workflow_state"] == "CHECK_COMPLETE"
    assert task["current_run"]["result"]["workflow_state"] == "READY"
    acknowledgment = task["current_run"]["completion"]
    assert acknowledgment["run_id"] == run_id
    assert acknowledgment["actor"] == "Demo reviewer — unverified"

    repeated = client.post(f"{PREFIX}/{task['id']}/complete", json=payload)
    assert repeated.status_code == 200
    assert repeated.json()["current_run"]["completion"] == acknowledgment

    locked = client.post(
        f"{PREFIX}/{task['id']}/reviews",
        json={
            "expected_revision": task["revision"],
            "run_id": run_id,
            "document_id": task["current_si_id"],
            "field": "shipper",
            "action": "SUPPLY_INFORMATION",
            "raw_value": "A",
            "provenance": {"source_name": "Email", "reference": "Reference"},
        },
    )
    assert locked.status_code == 409
    assert locked.json()["detail"]["code"] == "completed_run_read_only"

    rerun = analyze(client, task)
    assert rerun["workflow_state"] == "READY"
    assert rerun["current_run"]["completion"] is None
    historical = client.get(f"{PREFIX}/{task['id']}/runs/{run_id}").json()
    assert historical["is_historical"] is True
    assert historical["current_run"]["completion"] == acknowledgment
    assert historical["current_run"]["reviewed_result"]["workflow_state"] == "CHECK_COMPLETE"

    with TestClient(create_app(settings)) as reopened:
        restored = reopened.get(f"{PREFIX}/{task['id']}/runs/{run_id}").json()
        assert restored["current_run"]["completion"] == acknowledgment


def test_stale_upload_analysis_and_pair_selection_do_not_mutate_revision(task_client):
    client, _, _ = task_client
    first = analyze(client, clone(client))
    updated = upload_version(client, first, 2)
    stale = replace(client, first, b"BILL OF LADING (DRAFT)\n")
    assert stale.status_code == 409, stale.text
    assert (
        client.post(
            f"{PREFIX}/{first['id']}/analyze", json={"expected_revision": first["revision"]}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"{PREFIX}/{first['id']}/pair",
            json={"si_id": None, "bl_id": None, "expected_revision": first["revision"]},
        ).status_code
        == 409
    )
    assert client.get(f"{PREFIX}/{updated['id']}").json() == updated


def test_pair_selection_rejects_foreign_and_historical_documents(task_client):
    client, _, baseline = task_client
    first = analyze(client, clone(client))
    updated = upload_version(client, first, 2)
    old_bl = first["current_bl_id"]
    for invalid_id in (old_bl, baseline["documents"][0]["id"]):
        response = client.post(
            f"{PREFIX}/{updated['id']}/pair",
            json={
                "si_id": updated["current_si_id"],
                "bl_id": invalid_id,
                "expected_revision": updated["revision"],
            },
        )
        assert response.status_code in (400, 404, 409, 422), response.text
    assert client.get(f"{PREFIX}/{updated['id']}").json() == updated
    other = clone(client)
    assert (
        client.get(f"{PREFIX}/{other['id']}/runs/{first['current_run']['id']}").status_code == 404
    )


def test_missing_pair_stays_unresolved_instead_of_resolving_prior_findings(task_client):
    client, _, _ = task_client
    first = analyze(client, clone(client))
    response = client.post(
        f"{PREFIX}/{first['id']}/pair",
        json={
            "si_id": first["current_si_id"],
            "bl_id": None,
            "expected_revision": first["revision"],
        },
    )
    assert response.status_code == 200, response.text
    checked = analyze(client, response.json())
    assert checked["workflow_state"] in ("WAITING_DOCUMENT", "REVIEW_REQUIRED")
    assert result(checked)["coverage"]["checked"] == 0
    delta = result(checked)["revision_delta"]
    assert delta["resolved"] == []
    assert NAMES <= set(delta["uncertain"])


@pytest.mark.parametrize(
    ("content", "filename", "expected_code"),
    [
        (b"COMMERCIAL INVOICE\nInvoice Number: 004\n", "wrong.txt", "WRONG_DOCUMENT_TYPE"),
        (
            (FIXTURES / "extraction/email_512_SI.pdf").read_bytes(),
            "scan.pdf",
            "AI_NOT_CONFIGURED",
        ),
    ],
    ids=["wrong-document-type", "image-only-pdf"],
)
def test_wrong_or_unreadable_replacement_never_resolves_findings(
    task_client, content, filename, expected_code
):
    client, _, _ = task_client
    first = analyze(client, clone(client))
    response = replace(client, first, content, filename)
    assert response.status_code in (200, 201), response.text
    checked = analyze(client, response.json())
    assert checked["workflow_state"] != "READY"
    if expected_code == "AI_NOT_CONFIGURED":
        assert checked["current_run"] is None
        assert checked["latest_run"]["error"]["code"] == expected_code
        return
    assert expected_code in {r["code"] for r in result(checked)["review_requirements"]}
    assert result(checked)["revision_delta"]["resolved"] == []
    assert NAMES <= set(result(checked)["revision_delta"]["uncertain"])


def test_product_task_routes_remain_disabled_in_production(tmp_path):
    settings = Settings(app_env="production", local_data_dir=tmp_path, _env_file=None)
    with TestClient(create_app(settings)) as client:
        assert client.post(PREFIX, json={"sample_id": "email_004"}).status_code == 404
        assert client.get(f"{PREFIX}/unknown").status_code == 404


def test_unanalyzed_clone_discovers_pair_for_later_replacement(task_client):
    client, _, _ = task_client
    task = clone(client, "email_104")
    assert task["current_run"] is None
    first = analyze(client, task)
    assert first["current_si_id"] in {d["id"] for d in first["documents"]}
    assert first["current_bl_id"] in {d["id"] for d in first["documents"]}
    second = analyze(client, upload_version(client, first, 2))
    assert result(second)["known_defect_fields"] == ["gross_weight_kg"]
    assert set(result(second)["revision_delta"]["resolved"]) == NAMES


def test_ambiguous_pair_requires_explicit_task_document_choice(task_client):
    client, _, _ = task_client
    task = analyze(client, clone(client, "email_204"))
    assert task["workflow_state"] == "REVIEW_REQUIRED"
    assert "ambiguous_document_pair" in {
        item["code"] for item in result(task)["review_requirements"]
    }
    si = next(d["id"] for d in task["documents"] if d["filename"].endswith("_SI.txt"))
    bl = next(d["id"] for d in task["documents"] if d["filename"].endswith("_BL.txt"))
    response = client.post(
        f"{PREFIX}/{task['id']}/pair",
        json={"si_id": si, "bl_id": bl, "expected_revision": task["revision"]},
    )
    assert response.status_code == 200, response.text
    selected = analyze(client, response.json())
    assert set(result(selected)["known_defect_fields"]) == NAMES
    assert selected["coverage"]["checked"] == 7


def test_mutations_reject_untrusted_origin_and_unrelated_task_sources(task_client):
    client, _, _ = task_client
    task, other = clone(client), clone(client)
    response = client.post(
        f"{PREFIX}/{task['id']}/pair",
        json={
            "si_id": other["current_si_id"],
            "bl_id": other["current_bl_id"],
            "expected_revision": task["revision"],
        },
    )
    assert response.status_code in (400, 404, 409, 422), response.text
    hostile = {"Origin": "https://untrusted.example"}
    assert client.post(PREFIX, json={"sample_id": "email_004"}, headers=hostile).status_code == 403
    assert (
        client.post(
            f"{PREFIX}/{task['id']}/analyze",
            json={"expected_revision": task["revision"]},
            headers=hostile,
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{PREFIX}/{task['id']}/pair",
            json={"si_id": None, "bl_id": None, "expected_revision": task["revision"]},
            headers=hostile,
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{PREFIX}/{task['id']}/documents",
            data={"role": "bl", "expected_revision": task["revision"]},
            files={"file": ("new.txt", b"BILL OF LADING (DRAFT)\n", "text/plain")},
            headers=hostile,
        ).status_code
        == 403
    )
    assert client.get(f"{PREFIX}/{task['id']}").json() == task


def test_late_success_remains_historical_after_new_revision_completes(task_client, monkeypatch):
    client, _, _ = task_client
    task = clone(client)
    entered, release, lock = Event(), Event(), Lock()
    worker = extraction_service.run_worker
    blocked_once = False

    def block_first(*args, **kwargs):
        nonlocal blocked_once
        with lock:
            block = not blocked_once
            blocked_once = True
        if block:
            entered.set()
            assert release.wait(20)
        return worker(*args, **kwargs)

    monkeypatch.setattr(extraction_service, "run_worker", block_first)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(analyze, client, task)
        try:
            assert entered.wait(5)
            running = client.get(f"{PREFIX}/{task['id']}").json()
            old_run_id = running["latest_run"]["id"]
            updated = upload_version(client, running, 2)
            newest = analyze(client, updated)
            assert result(newest)["known_defect_fields"] == ["gross_weight_kg"]
        finally:
            release.set()
        pending.result(timeout=20)
    current = client.get(f"{PREFIX}/{task['id']}").json()
    assert current["revision"] == 2
    assert current["current_run"]["id"] == newest["current_run"]["id"]
    assert current["latest_run"]["id"] == newest["current_run"]["id"]
    previous = client.get(f"{PREFIX}/{task['id']}/runs/{old_run_id}")
    assert previous.status_code == 200, previous.text
    historic = previous.json()
    assert historic["is_historical"] is True
    assert historic["revision"] == 1
    assert historic["current_run"]["status"] == "SUCCEEDED"
    assert set(result(historic)["known_defect_fields"]) == NAMES
    assert historic["documents"] == task["documents"]


def test_failed_analysis_retains_saved_revision_and_retry_recovers(task_client, monkeypatch):
    client, _, _ = task_client
    first = analyze(client, clone(client))
    updated = upload_version(client, first, 2)
    worker = extraction_service.run_worker

    def timeout(*args, **kwargs):
        return None, [], {"code": "EXTRACTION_TIMEOUT", "message": "Test worker timed out."}

    monkeypatch.setattr(extraction_service, "run_worker", timeout)
    failed = analyze(client, updated)
    assert failed["workflow_state"] == "FAILED"
    assert failed["current_run"] is None
    assert failed["latest_run"]["error"]["code"] == "analysis_timeout"
    assert failed["revision"] == updated["revision"]
    assert failed["documents"] == updated["documents"]
    monkeypatch.setattr(extraction_service, "run_worker", worker)
    recovered = analyze(client, failed)
    assert recovered["revision"] == updated["revision"]
    assert result(recovered)["known_defect_fields"] == ["gross_weight_kg"]
    assert result(recovered)["revision_delta"]["baseline_run_id"] == first["current_run"]["id"]
    assert set(result(recovered)["revision_delta"]["resolved"]) == NAMES
    assert client.get(f"{PREFIX}/{first['id']}/runs/{first['current_run']['id']}").json()[
        "current_run"
    ]["result"] == result(first)


def test_upload_before_first_analysis_uses_selected_source_and_ignores_obsolete_issues(task_client):
    client, _, _ = task_client
    task = clone(client, "email_304")
    assert task["current_run"] is None
    assert task["current_si_id"] is None
    assert task["current_bl_id"] is None
    uploaded = upload_version(client, task, 3)
    selected_bl = uploaded["current_bl_id"]
    assert selected_bl is not None
    checked = analyze(client, uploaded)
    assert checked["workflow_state"] == "READY"
    assert checked["coverage"] == {"checked": 7, "total": 7}
    assert checked["current_bl_id"] == selected_bl
    assert checked["current_si_id"] is not None
    assert result(checked)["review_requirements"] == []
    assert all(field["finding"] == "MATCH" for field in result(checked)["fields"])
    rerun = analyze(client, checked)
    assert rerun["workflow_state"] == "READY"
    assert rerun["current_bl_id"] == selected_bl
    assert rerun["current_si_id"] == checked["current_si_id"]


def test_explicit_empty_pair_waits_for_sources_without_clean_result(task_client):
    client, _, _ = task_client
    task = analyze(client, clone(client))
    response = client.post(
        f"{PREFIX}/{task['id']}/pair",
        json={"si_id": None, "bl_id": None, "expected_revision": task["revision"]},
    )
    assert response.status_code == 200, response.text
    checked = analyze(client, response.json())
    assert checked["workflow_state"] == "WAITING_DOCUMENT"
    assert checked["coverage"] == {"checked": 0, "total": 7}
    assert checked["current_si_id"] is None
    assert checked["current_bl_id"] is None
    assert result(checked)["revision_delta"]["resolved"] == []
    assert all(field["finding"] != "MATCH" for field in result(checked)["fields"])
