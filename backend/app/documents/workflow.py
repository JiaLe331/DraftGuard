"""Mailbox stages around the common extraction workers and persisted event stream."""

from app.dev_extraction.dataset import DatasetError
from app.documents.analysis import PIPELINE_VERSION, classify, compare, revision_delta


class MailboxWorkflow:
    pipeline_version = PIPELINE_VERSION

    def __init__(self, store, email, run_id, mode):
        self.store, self.email, self.run_id = store, email, run_id
        self.context = {
            "email_id": email["id"],
            "run_id": run_id,
            "revision": email["revision"],
            "mode": mode,
        }

    def prepare(self, run, emit):
        classification = classify(self.email["subject"], self.email["body"])
        run["classification"] = classification
        emit(
            "classification",
            "SUCCEEDED" if classification["category"] else "NEEDS_REVIEW",
            classification["reason"],
            classification=classification,
        )
        return classification["category"] == "BL_COMPARISON"

    def finish(self, run, emit):
        run["processing_status"] = "RUNNING"
        pair = None
        if self.email.get("baseline_id"):
            pair = {
                role: self.email[f"current_{role}_id"]
                for role in ("si", "bl")
                if self.email.get("pair_selected") or self.email[f"current_{role}_id"] is not None
            }
        result = compare(run["classification"], run["documents"], emit, selected_pair=pair)
        if self.email.get("baseline_id"):
            baseline_id = self.email.get("baseline_run_id")
            with self.store.connect() as db:
                baseline = self.store._run(db, baseline_id)
            result["revision_delta"] = revision_delta(
                result, baseline["result"] if baseline else None, baseline_id
            )
        run["analysis"] = result
        # An unreadable source is a completed analysis requiring review. A failed
        # worker/read is a processing failure and must retain the last successful result.
        errors = [doc["error"] for doc in run["documents"] if doc["error"]]
        outcome = "FAILED" if errors else "SUCCEEDED"
        result["processing_status"] = outcome
        run["needs_review"] = bool(
            errors or result["review_requirements"] or result["known_defect_fields"]
        )
        emit(
            "analysis",
            "NEEDS_REVIEW" if run["needs_review"] else "SUCCEEDED",
            "Email classification and comparison finished.",
            workflow_state=result["workflow_state"],
            coverage=result["coverage"],
            review_requirements=result["review_requirements"],
        )

        run["processing_status"] = outcome

    def attach(self, db):
        db.execute("ATTACH DATABASE ? AS mailbox", (str(self.store.database),))

    def created(self, db, run):
        self.attach(db)
        db.execute(
            "UPDATE mailbox.runs SET audit_run_id=? WHERE id=?", (run["run_id"], self.run_id)
        )

    def commit(self, db, run):
        # Both SQLite writes share the audit connection's transaction. An ordinary
        # write failure rolls back the terminal event, result, and mailbox pointers.
        from app.store import encode

        self.attach(db)
        current = db.execute(
            "SELECT revision,latest_run_id FROM mailbox.emails WHERE id=?", (self.email["id"],)
        ).fetchone()
        active = db.execute("SELECT status FROM mailbox.runs WHERE id=?", (self.run_id,)).fetchone()
        success = run["processing_status"] == "SUCCEEDED"
        stale = (
            not current
            or current["revision"] != self.email["revision"]
            or current["latest_run_id"] != self.run_id
            or active["status"] != "RUNNING"
        )
        if success and stale and not self.email.get("baseline_id"):
            raise DatasetError("stale_run", "This result is no longer current.", 409)
        errors = [*run["issues"], *(d["error"] for d in run["documents"] if d["error"])]
        error = (
            None
            if success
            else next(
                iter(errors),
                {"code": "interrupted", "message": "Analysis was interrupted. Run it again."},
            )
        )
        if error and error["code"] in {"EXTRACTION_TIMEOUT", "RUN_TIMEOUT"}:
            error = {**error, "code": "analysis_timeout"}
        result = run.get("analysis")
        if result:
            result["timings_ms"] = {"total": run.get("elapsed_ms", 0)}
        db.execute(
            "UPDATE mailbox.runs SET status=?,finished_at=?,result=?,error=? WHERE id=?",
            (
                "SUCCEEDED" if success else "FAILED",
                run["finished_at"],
                encode(result) if result else None,
                encode(error) if error else None,
                self.run_id,
            ),
        )
        if success and self.email.get("baseline_id") and not self.email.get("pair_selected"):
            pair = {}
            for role in ("si", "bl"):
                options = [
                    doc["id"] for doc in (result or {}).get("documents", []) if doc["role"] == role
                ]
                pair[role] = self.email.get(f"current_{role}_id") or (
                    options[0] if len(options) == 1 else None
                )
            db.execute(
                "UPDATE mailbox.runs SET current_si_id=?,current_bl_id=? WHERE id=?",
                (pair["si"], pair["bl"], self.run_id),
            )
            if not stale:
                db.execute(
                    "UPDATE mailbox.emails SET current_si_id=?,current_bl_id=?,pair_selected=? "
                    "WHERE id=?",
                    (pair["si"], pair["bl"], int(all(pair.values())), self.email["id"]),
                )
        if success and not stale:
            db.execute(
                "UPDATE mailbox.emails SET current_run_id=? WHERE id=?",
                (self.run_id, self.email["id"]),
            )
