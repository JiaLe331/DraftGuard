"""Durable run snapshots, append-only events, and immutable source documents."""

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


def now() -> str:
    return datetime.now(UTC).isoformat()


def event(stage, status, message, **details):
    return {
        "timestamp": now(),
        "stage": stage,
        "status": status,
        "message": message,
        "details": details,
    }


def interrupt(run, message):
    run.update(processing_status="INTERRUPTED", finished_at=now(), needs_review=True)
    run["issues"].append({"code": "RUN_INTERRUPTED", "message": message})
    for document in run["documents"]:
        if document["processing_status"] in {"PENDING", "RUNNING"}:
            document.update(
                processing_status="INTERRUPTED",
                error={
                    "code": "RUN_INTERRUPTED",
                    "message": message,
                },
            )


class AuditStore:
    def __init__(self, path: Path):
        self.path = path
        self._initialized = False
        self._initialization_lock = threading.Lock()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def ensure_initialized(self):
        with self._initialization_lock:
            if not self._initialized:
                self.initialize()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                    status TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS originals (
                    run_id TEXT NOT NULL REFERENCES runs(run_id),
                    document_id TEXT NOT NULL, filename TEXT NOT NULL, content BLOB NOT NULL,
                    PRIMARY KEY(run_id, document_id)
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    run_id TEXT NOT NULL REFERENCES runs(run_id),
                    sequence INTEGER NOT NULL, document_id TEXT, payload TEXT NOT NULL,
                    PRIMARY KEY(run_id, sequence)
                );
                CREATE TRIGGER IF NOT EXISTS immutable_finished_run
                BEFORE UPDATE ON runs WHEN OLD.status != 'RUNNING'
                BEGIN SELECT RAISE(ABORT, 'Completed runs are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS immutable_original
                BEFORE UPDATE ON originals
                BEGIN SELECT RAISE(ABORT, 'Originals are immutable'); END;
            """)
            db.execute("BEGIN IMMEDIATE")
            if db.execute("PRAGMA user_version").fetchone()[0] < 1:
                # Import real legacy events, without rewriting historical payloads.
                for row in db.execute("SELECT payload FROM runs").fetchall():
                    run = json.loads(row["payload"])
                    records = [
                        {
                            **item,
                            "document_id": doc["document_id"],
                            "document_sequence": item["sequence"],
                            "origin": "legacy",
                        }
                        for doc in run["documents"]
                        for item in doc.get("events", [])
                    ]
                    records.sort(key=lambda item: item["timestamp"])
                    self._append(db, run, records)
                db.execute("PRAGMA user_version=1")
            for name, operation in [
                ("immutable_event_update", "UPDATE"),
                ("immutable_event_delete", "DELETE"),
            ]:
                db.execute(f"""CREATE TRIGGER IF NOT EXISTS {name}
                    BEFORE {operation} ON audit_events
                    BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END""")
            db.execute("""CREATE TRIGGER IF NOT EXISTS no_events_after_completion
                BEFORE INSERT ON audit_events
                WHEN (SELECT status FROM runs WHERE run_id=NEW.run_id) != 'RUNNING'
                BEGIN SELECT RAISE(ABORT, 'The run has finished'); END""")
            for row in db.execute("SELECT payload FROM runs WHERE status='RUNNING'").fetchall():
                run = json.loads(row["payload"])
                message = "The backend restarted before this run finished. Start a new extraction."
                interrupt(run, message)
                self._append(db, run, [event("run", "INTERRUPTED", message)])
                self._write(db, run)

        self._initialized = True

    @staticmethod
    def _append(db, run, records):
        sequence = db.execute(
            "SELECT COALESCE(MAX(sequence), 0) FROM audit_events WHERE run_id=?",
            (run["run_id"],),
        ).fetchone()[0]
        for item in records:
            sequence += 1
            record = {
                **item,
                "event_id": str(uuid4()),
                "sequence": sequence,
                "run_id": run["run_id"],
                "request_id": run["request_id"],
                "document_id": item.get("document_id"),
                "duration_ms": item.get("details", {}).get("duration_ms"),
            }
            db.execute(
                "INSERT INTO audit_events VALUES (?, ?, ?, ?)",
                (
                    run["run_id"],
                    sequence,
                    record["document_id"],
                    json.dumps(record),
                ),
            )

    @staticmethod
    def _write(db, run):
        cursor = db.execute(
            "UPDATE runs SET status=?, payload=? WHERE run_id=?",
            (
                run["processing_status"],
                json.dumps(run),
                run["run_id"],
            ),
        )
        if cursor.rowcount != 1:
            raise sqlite3.IntegrityError("Missing run")

    def create(self, run: dict, records=(), commit=None):
        with self.connect() as db:
            db.execute(
                "INSERT INTO runs VALUES (?, ?, ?, ?)",
                (
                    run["run_id"],
                    run["created_at"],
                    run["processing_status"],
                    json.dumps(run),
                ),
            )
            self._append(db, run, records)
            if commit:
                commit(db, run)

    def save(self, run: dict, records=(), original=None, commit=None):
        # Source checkpoints, events, and final results become visible atomically.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if original is not None:
                db.execute("INSERT INTO originals VALUES (?, ?, ?, ?)", original)
            self._append(db, run, records)
            if commit:
                commit(db, run)
            self._write(db, run)

    def save_original(self, run_id: str, doc_id: str, filename: str, content: bytes):
        with self.connect() as db:
            db.execute(
                "INSERT INTO originals VALUES (?, ?, ?, ?)", (run_id, doc_id, filename, content)
            )

    def get(self, run_id: str):
        with self.connect() as db:
            db.execute("BEGIN")
            row = db.execute("SELECT payload FROM runs WHERE run_id=?", (run_id,)).fetchone()
            if not row:
                return None
            run = json.loads(row["payload"])
            if run.get("audit_version") == 2:
                run["events"] = [
                    json.loads(row[0])
                    for row in db.execute(
                        "SELECT payload FROM audit_events WHERE run_id=? ORDER BY sequence",
                        (run_id,),
                    )
                ]
                for doc in run["documents"]:
                    doc["events"] = [
                        e for e in run["events"] if e["document_id"] == doc["document_id"]
                    ]
            return run

    def events(self, run_id, after_sequence=0, limit=100):
        with self.connect() as db:
            db.execute("BEGIN")
            run = db.execute(
                "SELECT status, payload FROM runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if run is None:
                return None
            records = [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT payload FROM audit_events WHERE run_id=? AND sequence>? "
                    "ORDER BY sequence LIMIT ?",
                    (run_id, after_sequence, limit + 1),
                )
            ]
            items = records[:limit]
            return {
                "items": items,
                "has_more": len(records) > limit,
                "next_after_sequence": items[-1]["sequence"] if items else after_sequence,
                "processing_status": run["status"],
                "trace_mode": "live"
                if json.loads(run["payload"]).get("audit_version") == 2
                else "legacy",
            }

    def list(self, limit: int, offset: int, q="", status=None, source_type=None, needs_review=None):
        where, values = [], []
        if q:
            where.append("""(instr(lower(run_id), lower(?)) > 0 OR
                instr(lower(json_extract(payload, '$.source_label')), lower(?)) > 0 OR
                instr(lower(COALESCE(json_extract(payload, '$.email.email_id'), '')),
                      lower(?)) > 0 OR EXISTS (
                    SELECT 1 FROM json_each(runs.payload, '$.documents')
                    WHERE instr(lower(json_extract(value, '$.filename')), lower(?)) > 0))""")
            values.extend([q] * 4)
        if status:
            where.append("status=?")
            values.append(status)
        if source_type:
            where.append("json_extract(payload, '$.source_type')=?")
            values.append(source_type)
        if needs_review is not None:
            where.append("json_extract(payload, '$.needs_review')=?")
            values.append(int(needs_review))
        clause = " WHERE " + " AND ".join(where) if where else ""
        with self.connect() as db:
            db.execute("BEGIN")
            total = db.execute("SELECT COUNT(*) FROM runs" + clause, values).fetchone()[0]
            rows = db.execute(
                "SELECT payload FROM runs"
                + clause
                + " ORDER BY created_at DESC, run_id DESC LIMIT ? OFFSET ?",
                [*values, limit, offset],
            ).fetchall()
        items = []
        for row in rows:
            run = json.loads(row["payload"])
            item = {
                key: run[key]
                for key in (
                    "run_id",
                    "created_at",
                    "finished_at",
                    "processing_status",
                    "needs_review",
                    "source_type",
                    "source_label",
                    "document_count",
                )
            }
            item["trace_mode"] = "live" if run.get("audit_version") == 2 else "legacy"
            items.append(item)
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    def original(self, run_id: str, document_id: str):
        with self.connect() as db:
            return db.execute(
                "SELECT filename, content FROM originals WHERE run_id=? AND document_id=?",
                (run_id, document_id),
            ).fetchone()
