"""Local task copies and immutable revision writes for the development workbench."""

import hashlib
import json
from pathlib import Path, PureWindowsPath
from uuid import uuid4

from app.extraction.models import FIELD_KEYS, ExtractionLimits
from app.extraction.parsers import ParseProblem, detect_format
from app.extraction.rules import normalize_review_value


class TaskStoreMixin:
    def _task(self, db, task_id, expected_revision=None):
        from app.store import StoreError

        task = self._email(db, task_id)
        if not task["baseline_id"]:
            raise StoreError("not_found", "This local task could not be found.", 404)
        if expected_revision is not None and task["revision"] != expected_revision:
            raise StoreError("stale_revision", "The sources changed. Refresh before saving.", 409)
        return task

    def task_detail(self, task_id):
        with self.connect() as db:
            self._task(db, task_id)
        return self.detail(task_id)

    def list_tasks(self, page=1, limit=50):
        with self.connect() as db:
            self._recover_expired(db)
            rows = db.execute(
                "SELECT * FROM emails WHERE baseline_id IS NOT NULL ORDER BY rowid DESC"
            ).fetchall()
            items = [{**self._summary(db, row), "baseline_id": row["baseline_id"]} for row in rows]
        states = {}
        for item in items:
            state = item["workflow_state"]
            states[state] = states.get(state, 0) + 1
        return {
            "items": items[(page - 1) * limit : page * limit],
            "total": len(items),
            "page": page,
            "limit": limit,
            "summary": {
                "total": len(items),
                "attachments": sum(i["attachment_count"] for i in items),
                "states": states,
            },
        }

    def clone_task(self, sample_id):
        from app.store import StoreError, encode, now

        task_id = f"task-{uuid4().hex}"
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            baseline = self._email(db, sample_id)
            if baseline["baseline_id"]:
                raise StoreError("invalid_sample", "Create a task from an organizer sample.")
            docs = self._documents(db, baseline)
            mapping = {doc["id"]: str(uuid4()) for doc in docs}
            source_run = self._run(db, baseline["current_run_id"])
            pair = {}
            if source_run and source_run["revision"] == baseline["revision"]:
                for role in ("si", "bl"):
                    candidates = [
                        doc["id"]
                        for doc in source_run["result"]["documents"]
                        if doc["role"] == role and doc["id"] in mapping
                    ]
                    if len(candidates) == 1:
                        pair[role] = mapping[candidates[0]]
            db.execute(
                "INSERT INTO emails (id,subject,sender,body,position,revision,fingerprint,"
                "document_ids,baseline_id,current_si_id,current_bl_id,pair_selected) "
                "VALUES (?,?,?,?,?,1,?,?,?,?,?,?)",
                (
                    task_id,
                    baseline["subject"],
                    baseline["sender"],
                    baseline["body"],
                    baseline["position"],
                    task_id,
                    encode(list(mapping.values())),
                    sample_id,
                    pair.get("si"),
                    pair.get("bl"),
                    int(len(pair) == 2),
                ),
            )
            for doc in docs:
                self.document_path(doc)
                db.execute(
                    "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)",
                    (
                        mapping[doc["id"]],
                        task_id,
                        doc["source_key"],
                        doc["filename"],
                        doc["sha256"],
                        doc["byte_count"],
                        doc["version"],
                        now(),
                    ),
                )
        return self.task_detail(task_id)

    def _advance_task(self, db, task, document_ids, si_id, bl_id):
        from app.store import encode

        db.execute(
            "UPDATE emails SET revision=revision+1,document_ids=?,current_si_id=?,current_bl_id=?,"
            "pair_selected=1,current_run_id=NULL,latest_run_id=NULL WHERE id=?",
            (encode(document_ids), si_id, bl_id, task["id"]),
        )

    def select_pair(self, task_id, expected_revision, si_id, bl_id):
        from app.store import StoreError

        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            task = self._task(db, task_id, expected_revision)
            current = json.loads(task["document_ids"])
            if si_id is not None and si_id == bl_id:
                raise StoreError("invalid_pair", "SI and BL must be different documents.")
            if any(doc_id is not None and doc_id not in current for doc_id in (si_id, bl_id)):
                raise StoreError("invalid_pair", "Select documents attached to the current task.")
            if not (
                task["pair_selected"]
                and si_id == task["current_si_id"]
                and bl_id == task["current_bl_id"]
            ):
                self._advance_task(db, task, current, si_id, bl_id)
        return self.task_detail(task_id)

    def replace_document(self, task_id, expected_revision, role, filename, content, max_bytes=None):
        from app.store import MAX_BYTES, StoreError, now

        if role not in {"si", "bl"}:
            raise StoreError("invalid_role", "Choose SI or BL.")
        if (
            not filename
            or Path(filename).name != filename
            or PureWindowsPath(filename).name != filename
            or any(ord(c) < 32 for c in filename)
        ):
            raise StoreError(
                "unsafe_filename", "Use a filename without directories or control characters."
            )
        try:
            detect_format(
                content, filename, ExtractionLimits(max_file_bytes=max_bytes or MAX_BYTES)
            )
        except ParseProblem as exc:
            status = 413 if exc.code == "RESOURCE_LIMIT" else 415
            raise StoreError(exc.code, exc.message, status) from exc
        digest = hashlib.sha256(content).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            task = self._task(db, task_id, expected_revision)
            current = json.loads(task["document_ids"])
            old_id = task[f"current_{role}_id"]
            if len(current) >= 10 and old_id not in current:
                raise StoreError(
                    "attachment_limit",
                    "Select an existing document to replace; the limit is ten active attachments.",
                )
            doc_id = str(uuid4())
            version = db.execute(
                "SELECT COALESCE(MAX(version),0)+1 FROM documents WHERE email_id=?", (task_id,)
            ).fetchone()[0]
            destination = self.objects / digest
            if not destination.exists():
                temporary = self.objects / f".{uuid4()}.tmp"
                temporary.write_bytes(content)
                temporary.replace(destination)
            db.execute(
                "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)",
                (
                    doc_id,
                    task_id,
                    f"upload/{doc_id}",
                    filename,
                    digest,
                    len(content),
                    version,
                    now(),
                ),
            )
            current = [item for item in current if item != old_id] + [doc_id]
            pair = {"si": task["current_si_id"], "bl": task["current_bl_id"], role: doc_id}
            self._advance_task(db, task, current, pair["si"], pair["bl"])
            if not task["pair_selected"]:
                db.execute("UPDATE emails SET pair_selected=0 WHERE id=?", (task_id,))
        return self.task_detail(task_id)

    def _revision_baseline(self, db, task):
        """Freeze a previous comparable revision when this revision first starts."""
        previous_attempt = db.execute(
            "SELECT baseline_run_id FROM runs WHERE email_id=? AND revision=? "
            "ORDER BY started_at LIMIT 1",
            (task["id"], task["revision"]),
        ).fetchone()
        if previous_attempt:
            return previous_attempt["baseline_run_id"]
        for row in db.execute(
            "SELECT id,result FROM runs WHERE email_id=? AND revision<? AND status='SUCCEEDED' "
            "ORDER BY revision DESC,finished_at DESC",
            (task["id"], task["revision"]),
        ):
            result = json.loads(row["result"]) if row["result"] else None
            if (
                result
                and result["classification"]["category"] == "BL_COMPARISON"
                and len(result["fields"]) == 7
            ):
                return row["id"]
        return None

    def record_review(
        self,
        task_id,
        expected_revision,
        run_id,
        document_id,
        field,
        action,
        raw_value,
        evidence,
        provenance=None,
    ):
        from app.store import StoreError, now

        if field not in FIELD_KEYS:
            raise StoreError("invalid_review", "Choose one supported comparison field.", 422)
        if action not in {"CONFIRM_CANDIDATE", "CORRECT_EXTRACTION", "SUPPLY_INFORMATION"}:
            raise StoreError("invalid_review", "Choose a supported review action.", 422)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            task = self._task(db, task_id, expected_revision)
            run = self._run(db, run_id)
            if (
                not run
                or run["email_id"] != task_id
                or run["status"] != "SUCCEEDED"
                or run["revision"] != task["revision"]
                or task["current_run_id"] != run_id
            ):
                raise StoreError(
                    "stale_review", "Review the current saved analysis after refreshing.", 409
                )
            if self._completion(db, run_id):
                raise StoreError(
                    "completed_run_read_only",
                    "This completed run is read only. Reanalyze or replace a source to continue.",
                    409,
                )
            if document_id not in run["document_ids"] or document_id not in {
                task["current_si_id"],
                task["current_bl_id"],
            }:
                raise StoreError(
                    "stale_review", "This document is not part of the current comparison.", 409
                )
            result = run["result"]
            document = next(
                (item for item in result["documents"] if item["id"] == document_id), None
            )
            if not document or document.get("role") not in {"si", "bl"}:
                raise StoreError("invalid_review", "The source role is not established.", 422)
            machine_field = next((item for item in result["fields"] if item["key"] == field), None)
            machine = machine_field[document["role"]] if machine_field else None
            if not machine:
                raise StoreError("invalid_review", "The selected field is unavailable.", 422)
            unit = None
            page = None
            if action == "CONFIRM_CANDIDATE":
                if machine.get("method") != "gemini_vision":
                    raise StoreError(
                        "invalid_review", "Only Gemini visual candidates can be confirmed.", 422
                    )
                if not evidence or evidence.get("kind") != "visual_page":
                    raise StoreError("invalid_review", "Choose the candidate PDF page.", 422)
                page = evidence.get("page")
                unit = next(
                    (item for item in document.get("units", []) if item.get("page") == page), None
                )
            elif action == "CORRECT_EXTRACTION":
                if machine.get("method") == "gemini_vision":
                    if not evidence or evidence.get("kind") != "visual_page":
                        raise StoreError(
                            "invalid_review", "Choose a page that exists in the current PDF.", 422
                        )
                    page = evidence.get("page")
                    unit = next(
                        (item for item in document.get("units", []) if item.get("page") == page),
                        None,
                    )
                else:
                    if not evidence or evidence.get("kind") != "source_unit":
                        raise StoreError(
                            "invalid_review",
                            "Choose extracted source text for this correction.",
                            422,
                        )
                    unit = next(
                        (
                            item
                            for item in document.get("units", [])
                            if item.get("id") == evidence.get("unit_id")
                        ),
                        None,
                    )
                    page = unit.get("page") if unit else None
            if action != "SUPPLY_INFORMATION" and unit is None:
                raise StoreError(
                    "invalid_review", "Choose evidence from the current source document.", 422
                )
            if action == "SUPPLY_INFORMATION":
                if machine.get("value_state") not in {"MISSING", "AMBIGUOUS", "UNREADABLE"}:
                    raise StoreError(
                        "invalid_review",
                        "Supply information only for a value missing or unusable in this source.",
                        422,
                    )
                saved_raw = raw_value.strip() if isinstance(raw_value, str) else ""
                source = (provenance or {}).get("source_name", "").strip()
                reference = (provenance or {}).get("reference", "").strip()
                note = (provenance or {}).get("note")
                note = note.strip() if isinstance(note, str) and note.strip() else None
                if not saved_raw or not source or not reference:
                    raise StoreError(
                        "invalid_review",
                        "Enter a supplied value, source name, and checkable reference.",
                        422,
                    )
                saved_raw, normalized, state, _ = normalize_review_value(field, saved_raw)
                if state != "PRESENT" or normalized is None:
                    raise StoreError(
                        "invalid_review",
                        "The supplied value is ambiguous. Include an explicit, supported value.",
                        422,
                    )
            elif action == "CONFIRM_CANDIDATE":
                evidence_pages = {item.get("page") for item in machine.get("evidence", [])}
                if machine.get("raw_value") is None or page not in evidence_pages:
                    raise StoreError(
                        "invalid_review",
                        (
                            "This candidate cannot be confirmed; correct it against the source "
                            "instead."
                        ),
                        422,
                    )
                saved_raw = machine["raw_value"]
                normalized = machine.get("normalized_value")
            else:
                saved_raw = raw_value.strip() if isinstance(raw_value, str) else ""
                if not saved_raw or len(saved_raw) > 5000:
                    raise StoreError(
                        "invalid_review", "Enter the value visible on the selected PDF page.", 422
                    )
                saved_raw, normalized, state, _ = normalize_review_value(field, saved_raw)
                if state != "PRESENT" or normalized is None:
                    raise StoreError(
                        "invalid_review",
                        "The correction is still ambiguous. Include an explicit, supported value.",
                        422,
                    )
                if machine.get("method") != "gemini_vision":
                    visible_source = " ".join(unit["text"].split())
                    visible_value = " ".join(saved_raw.split())
                    if visible_value not in visible_source:
                        raise StoreError(
                            "invalid_review",
                            "The corrected value must appear in the selected source text.",
                            422,
                        )
            review_id = str(uuid4())
            db.execute(
                "INSERT INTO review_events "
                "(id,task_id,revision,run_id,document_id,field,action,machine_raw_value,"
                "raw_value,normalized_value,page,unit_id,provenance_source,"
                "provenance_reference,provenance_note,actor,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    review_id,
                    task_id,
                    task["revision"],
                    run_id,
                    document_id,
                    field,
                    action,
                    machine.get("raw_value"),
                    saved_raw,
                    normalized,
                    page,
                    unit["id"] if unit else None,
                    source if action == "SUPPLY_INFORMATION" else None,
                    reference if action == "SUPPLY_INFORMATION" else None,
                    note if action == "SUPPLY_INFORMATION" else None,
                    "Demo reviewer — unverified",
                    now(),
                ),
            )
        return self.task_detail(task_id)

    def record_completion(self, task_id, expected_revision, run_id, acknowledge_seven_field_scope):
        from app.documents.reviews import apply_review_overlay, completion_eligibility
        from app.store import StoreError, now

        if acknowledge_seven_field_scope is not True:
            raise StoreError(
                "invalid_completion", "Acknowledge the bounded seven-field scope.", 422
            )
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            task = self._task(db, task_id, expected_revision)
            run = self._run(db, run_id)
            if (
                not run
                or run["email_id"] != task_id
                or run["status"] != "SUCCEEDED"
                or run["revision"] != task["revision"]
                or task["current_run_id"] != run_id
            ):
                raise StoreError(
                    "stale_completion",
                    "Complete only the current saved analysis after refreshing.",
                    409,
                )
            if not self._completion(db, run_id):
                actions = self._review_actions(db, run_id)
                reviewed, _ = apply_review_overlay(run["result"], actions)
                eligibility = completion_eligibility(reviewed, actions, run)
                if not eligibility["eligible"]:
                    raise StoreError(
                        "completion_blocked",
                        "This run is not eligible for completion.",
                        409,
                        eligibility["blockers"],
                    )
                db.execute(
                    "INSERT INTO completion_acknowledgments VALUES (?,?,?,?,?,?)",
                    (
                        str(uuid4()),
                        task_id,
                        task["revision"],
                        run_id,
                        "Demo reviewer — unverified",
                        now(),
                    ),
                )
        return self.task_detail(task_id)

    def task_run_detail(self, task_id, run_id):
        from app.store import StoreError, encode

        with self.connect() as db:
            task = self._task(db, task_id)
            run = self._run(db, run_id)
            if not run or run["email_id"] != task_id:
                raise StoreError("not_found", "This task run could not be found.", 404)
            snapshot = {
                **task,
                "revision": run["revision"],
                "document_ids": encode(run["document_ids"]),
                "current_run_id": run_id if run["status"] == "SUCCEEDED" else None,
                "latest_run_id": run_id,
            }
            docs = self._documents(db, snapshot)
            summary = self._summary(db, snapshot)
            public_run = self._public_run(db, run)
        detail = self.task_detail(task_id)
        return {
            **detail,
            **summary,
            "current_si_id": run["current_si_id"],
            "current_bl_id": run["current_bl_id"],
            "is_historical": task["current_run_id"] != run_id
            or task["revision"] != run["revision"],
            "documents": [
                {
                    key: doc[key]
                    for key in ("id", "filename", "sha256", "byte_count", "version", "created_at")
                }
                for doc in docs
            ],
            "current_run": public_run if run["status"] == "SUCCEEDED" else None,
            "latest_run": public_run,
        }
