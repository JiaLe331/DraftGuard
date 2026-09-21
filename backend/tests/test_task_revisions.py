"""Real-source acceptance for the local task revision workflow."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock

import pytest
from fastapi.testclient import TestClient

from app.ai.amendment import (
    AmendmentWording,
    AmendmentWordingResult,
    GeminiAmendmentProvider,
)
from app.ai.common import AIProviderError
from app.ai.risk import DiscrepancyNote, RiskBriefing, RiskBriefingResult
from app.config import Settings
from app.dev_extraction import service as extraction_service
from app.extraction.models import ProviderMetadata
from app.main import create_app
from app.store import Store

FIXTURES = Path(__file__).parent / "fixtures"
PREFIX = "/api/v1/dev/tasks"
NAMES = {"consignee", "notify_party"}


class FakeAmendmentProvider:
    def __init__(self):
        self.calls = []
        self.failure = None
        self.on_call = None

    def draft_wording(self, subject, issue_kinds, *, timeout_seconds=None):
        self.calls.append((subject, issue_kinds, timeout_seconds))
        if self.on_call:
            self.on_call()
        if self.failure:
            raise self.failure
        return AmendmentWordingResult(
            response=AmendmentWording(
                subject=f"Please revise: {subject}",
                opening="Hello,\n\nPlease review the evidence-backed items below.",
                closing="Thank you. We look forward to the revised documents.",
            ),
            metadata=ProviderMetadata(
                configured_model="fake-model",
                model_version="fake-v1",
                response_id="amendment-response-1",
                prompt_version="amendment-email-wording-v1",
                duration_ms=5.5,
                usage={"prompt_token_count": 8, "total_token_count": 16},
            ),
        )


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


def test_amendment_draft_uses_locked_facts_and_persists_latest_edit(task_client):
    client, settings, _ = task_client
    task = analyze(client, clone(client))
    provider = FakeAmendmentProvider()
    with TestClient(create_app(settings, amendment_provider=provider)) as enabled:
        response = enabled.post(
            f"{PREFIX}/{task['id']}/amendment-draft",
            json={
                "expected_revision": task["revision"],
                "run_id": task["current_run"]["id"],
                "method": "gemini",
            },
        )
        assert response.status_code == 200, response.text
        saved = response.json()["amendment_draft"]
        assert provider.calls == [("Check draft BL", ["mismatch", "mismatch"], None)]
        assert saved["generation_method"] == "gemini"
        assert saved["provider_call"]["operation"] == "amendment_email"
        assert saved["provider_call"]["document_id"] is None
        assert saved["provider_call"]["response_id"] == "amendment-response-1"
        assert [item["field"] for item in saved["issue_items"]] == [
            "consignee",
            "notify_party",
        ]
        assert all(item["kind"] == "mismatch" for item in saved["issue_items"])

        updated = enabled.put(
            f"{PREFIX}/{task['id']}/amendment-draft/{saved['id']}",
            json={
                "expected_revision": task["revision"],
                "run_id": task["current_run"]["id"],
                "recipient": "carrier@example.test",
                "subject": "Please revise the draft BL",
                "opening": "Hello carrier,",
                "closing": "Thank you.",
            },
        )
        assert updated.status_code == 200, updated.text
        edited = updated.json()["amendment_draft"]
        assert edited["recipient"] == "carrier@example.test"
        assert edited["subject"] == "Please revise the draft BL"
        assert edited["user_edited"] is True
        assert edited["issue_items"] == saved["issue_items"]

    with TestClient(create_app(settings, amendment_provider=provider)) as reopened:
        restored = reopened.get(f"{PREFIX}/{task['id']}").json()["amendment_draft"]
        assert restored["id"] == saved["id"]
        assert restored["closing"] == "Thank you."
        historical = reopened.get(f"{PREFIX}/{task['id']}/runs/{task['current_run']['id']}").json()
        assert historical["amendment_draft"] is None


def test_standard_amendment_and_explicit_failure_do_not_masquerade_as_ai(task_client):
    client, settings, _ = task_client
    task = analyze(client, clone(client))
    provider = FakeAmendmentProvider()
    provider.failure = AIProviderError(
        "AI_RATE_LIMITED", "Gemini quota is unavailable.", retryable=True, status=429
    )
    with TestClient(create_app(settings, amendment_provider=provider)) as enabled:
        failed = enabled.post(
            f"{PREFIX}/{task['id']}/amendment-draft",
            json={
                "expected_revision": task["revision"],
                "run_id": task["current_run"]["id"],
                "method": "gemini",
            },
        )
        assert failed.status_code == 429
        assert failed.json()["detail"] == {
            "code": "AI_RATE_LIMITED",
            "message": "Gemini quota is unavailable.",
            "retryable": True,
        }
        assert enabled.get(f"{PREFIX}/{task['id']}").json()["amendment_draft"] is None

        fallback = enabled.post(
            f"{PREFIX}/{task['id']}/amendment-draft",
            json={
                "expected_revision": task["revision"],
                "run_id": task["current_run"]["id"],
                "method": "standard",
            },
        )
        assert fallback.status_code == 200, fallback.text
        draft = fallback.json()["amendment_draft"]
        assert draft["generation_method"] == "standard"
        assert draft["provider_call"] is None


def test_amendment_rejects_samples_completed_clean_stale_and_changed_facts(task_client):
    client, settings, _ = task_client
    mismatch = analyze(client, clone(client))
    payload = {
        "expected_revision": mismatch["revision"],
        "run_id": mismatch["current_run"]["id"],
        "method": "standard",
    }
    sample = client.post(f"{PREFIX}/email_004/amendment-draft", json=payload)
    assert sample.status_code == 409
    assert sample.json()["detail"]["code"] == "sample_read_only"

    changed = upload_version(client, mismatch, 2)
    stale = client.post(f"{PREFIX}/{mismatch['id']}/amendment-draft", json=payload)
    assert stale.status_code == 409

    clean = analyze(client, upload_version(client, changed, 3))
    no_action = client.post(
        f"{PREFIX}/{clean['id']}/amendment-draft",
        json={
            "expected_revision": clean["revision"],
            "run_id": clean["current_run"]["id"],
            "method": "standard",
        },
    )
    assert no_action.status_code == 409
    assert no_action.json()["detail"]["code"] == "no_actionable_items"

    completion = client.post(
        f"{PREFIX}/{clean['id']}/complete",
        json={
            "expected_revision": clean["revision"],
            "run_id": clean["current_run"]["id"],
            "acknowledge_seven_field_scope": True,
        },
    )
    assert completion.status_code == 200
    completed = client.post(
        f"{PREFIX}/{clean['id']}/amendment-draft",
        json={
            "expected_revision": clean["revision"],
            "run_id": clean["current_run"]["id"],
            "method": "standard",
        },
    )
    assert completed.status_code == 409
    assert completed.json()["detail"]["code"] == "completed_run_read_only"

    race_task = analyze(client, clone(client))
    provider = FakeAmendmentProvider()
    provider.on_call = lambda: Store(settings.local_data_dir).replace_document(
        race_task["id"],
        race_task["revision"],
        "bl",
        "changed.txt",
        (FIXTURES / "revisions/team_email_004_BL_v2.txt").read_bytes(),
    )
    with TestClient(create_app(settings, amendment_provider=provider)) as enabled:
        raced = enabled.post(
            f"{PREFIX}/{race_task['id']}/amendment-draft",
            json={
                "expected_revision": race_task["revision"],
                "run_id": race_task["current_run"]["id"],
                "method": "gemini",
            },
        )
        assert raced.status_code == 409
        assert raced.json()["detail"]["code"] in {"stale_revision", "stale_amendment"}
        assert enabled.get(f"{PREFIX}/{race_task['id']}").json()["amendment_draft"] is None


def test_missing_si_value_is_not_backfilled_from_bl_in_amendment_facts():
    from app.documents.amendment import build_issue_items

    extraction = {
        "raw_value": None,
        "normalized_value": None,
        "value_state": "MISSING",
        "requires_human_confirmation": False,
    }
    present = {
        "raw_value": "235,550 KG",
        "normalized_value": "235550",
        "value_state": "PRESENT",
        "requires_human_confirmation": False,
    }
    result = {
        "fields": [
            {
                "key": "gross_weight_kg",
                "si": extraction,
                "bl": present,
                "finding": "NEEDS_REVIEW",
            }
        ],
        "review_requirements": [],
    }
    item = build_issue_items(result)[0]
    assert item["kind"] == "missing_value"
    assert item["si_value"] == "Missing"
    assert item["bl_value"] == "235,550 KG"
    assert "corrected SI" in item["requested_action"]


def test_amendment_facts_cover_review_states_and_deduplicate_requirements():
    from app.documents.amendment import build_issue_items

    def present(value="VALUE"):
        return {
            "raw_value": value,
            "normalized_value": value,
            "value_state": "PRESENT",
            "requires_human_confirmation": False,
        }

    fields = [
        {"key": key, "si": present(), "bl": present(), "finding": "MATCH"}
        for key in (
            "shipper",
            "consignee",
            "notify_party",
            "port_of_loading",
            "port_of_discharge",
            "container_count",
            "gross_weight_kg",
        )
    ]
    fields[0]["si"].update(value_state="AMBIGUOUS", raw_value=None)
    fields[0]["finding"] = "NEEDS_REVIEW"
    fields[1]["bl"].update(value_state="UNREADABLE", raw_value=None)
    fields[1]["finding"] = "NEEDS_REVIEW"
    fields[2]["si"].update(requires_human_confirmation=True)
    fields[2]["finding"] = "NEEDS_REVIEW"
    fields[3]["bl"].update(
        value_state="MISSING",
        raw_value=None,
        supplied_information={"raw_value": "PORT KLANG"},
    )
    # A stale/malformed mismatch flag cannot promote supplied information to a fact.
    fields[3]["finding"] = "MISMATCH"
    result = {
        "fields": fields,
        "review_requirements": [
            {"code": "AMBIGUOUS_TEXT_VALUE", "field": "shipper", "message": "Duplicate"},
            {
                "code": "wrong_doc_type",
                "document_id": "doc-1",
                "message": "The selected source is not an SI or draft BL.",
                "next_action": "Replace the document.",
            },
            {
                "code": "wrong_doc_type",
                "document_id": "doc-1",
                "message": "The selected source is not an SI or draft BL.",
                "next_action": "Replace the document.",
            },
            {"code": "unresolved_fields", "message": "Some fields need review."},
        ],
    }
    items = build_issue_items(result)

    assert [item["kind"] for item in items] == [
        "ambiguous",
        "unreadable",
        "pending_review",
        "supplied_information",
        "document_requirement",
    ]
    assert len({item["id"] for item in items}) == len(items)
    pending = next(item for item in items if item["kind"] == "pending_review")
    assert pending["si_value"] is None and pending["bl_value"] is None


def test_gemini_amendment_prompt_contains_only_bounded_wording_context():
    captured = {}

    class Models:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return type(
                "Response",
                (),
                {
                    "text": AmendmentWording(
                        subject="Please revise the draft BL",
                        opening="Hello, please review the items below.",
                        closing="Thank you.",
                    ).model_dump_json(),
                    "model_version": "model-v1",
                    "response_id": "response-id",
                    "usage_metadata": {"prompt_token_count": 3, "total_token_count": 7},
                },
            )()

    class Client:
        models = Models()

        def close(self):
            pass

    provider = GeminiAmendmentProvider(
        Settings(gemini_api_key="secret", gemini_model="configured-model", _env_file=None),
        client_factory=lambda **_: Client(),
    )
    result = provider.draft_wording("Check draft BL", ["mismatch", "missing_value"])
    prompt = captured["contents"]

    assert "Check draft BL" in prompt
    assert "mismatch, missing_value" in prompt
    assert "235,550 KG" not in prompt
    assert "source excerpt" not in prompt.casefold()
    assert result.metadata.prompt_version == "amendment-email-wording-v1"


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


class FakeRiskProvider:
    def __init__(self):
        self.calls = []
        self.failure = None

    def explain(self, discrepancies, *, timeout_seconds=None):
        self.calls.append(discrepancies)
        if self.failure:
            raise self.failure
        return RiskBriefingResult(
            response=RiskBriefing(
                notes=[
                    DiscrepancyNote(field=field, consequence=f"Downstream effect of {field}.")
                    for field, _, _ in discrepancies
                ]
            ),
            metadata=ProviderMetadata(
                configured_model="fake-model",
                model_version="fake-v1",
                response_id="risk-1",
                prompt_version="discrepancy-operational-risk-v1",
                duration_ms=7.5,
                usage={"total_token_count": 42},
            ),
        )


def test_risk_briefing_explains_only_confirmed_discrepancies(task_client):
    """The briefing is advisory: it sees only fields the deterministic comparison
    already decided, and it never changes the task."""
    client, settings, _ = task_client
    task = analyze(client, clone(client))
    assert set(task["current_run"]["result"]["known_defect_fields"]) == NAMES

    provider = FakeRiskProvider()
    with TestClient(create_app(settings, risk_provider=provider)) as enabled:
        response = enabled.post(
            f"{PREFIX}/{task['id']}/risk-briefing",
            json={"expected_revision": task["revision"]},
        )
        assert response.status_code == 200
        briefing = response.json()
        assert {note["field"] for note in briefing["notes"]} == NAMES
        assert briefing["provider_call"]["operation"] == "risk_briefing"
        assert briefing["revision"] == task["revision"]

        # Gemini receives the decided fields with both values, nothing wider.
        handed = provider.calls[0]
        assert {field for field, _, _ in handed} == NAMES
        assert all(si and bl for _, si, bl in handed)

        # A stale revision is refused rather than described.
        stale = enabled.post(
            f"{PREFIX}/{task['id']}/risk-briefing",
            json={"expected_revision": task["revision"] + 1},
        )
        assert stale.status_code == 409
        assert stale.json()["detail"]["code"] == "stale_revision"

        # A provider failure surfaces as a stable, retryable error.
        provider.failure = AIProviderError("AI_TIMEOUT", "Gemini timed out.", retryable=True)
        failed = enabled.post(
            f"{PREFIX}/{task['id']}/risk-briefing",
            json={"expected_revision": task["revision"]},
        )
        assert failed.status_code == 502
        assert failed.json()["detail"]["retryable"] is True

    # Asking for commentary left the task, its run and its findings untouched.
    after = client.get(f"{PREFIX}/{task['id']}").json()
    assert after["revision"] == task["revision"]
    assert after["current_run"]["id"] == task["current_run"]["id"]
    assert set(after["current_run"]["result"]["known_defect_fields"]) == NAMES


def test_risk_briefing_refuses_a_run_without_a_confirmed_discrepancy(task_client):
    client, settings, _ = task_client
    task = clone(client)
    provider = FakeRiskProvider()
    with TestClient(create_app(settings, risk_provider=provider)) as enabled:
        response = enabled.post(
            f"{PREFIX}/{task['id']}/risk-briefing",
            json={"expected_revision": task["revision"]},
        )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "no_discrepancy"
    assert provider.calls == []
