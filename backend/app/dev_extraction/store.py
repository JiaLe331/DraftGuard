"""SQLite history: immutable completed runs and exact original attachments."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path


def now() -> str:
    return datetime.now(UTC).isoformat()


class AuditStore:
    def __init__(self, path: Path):
        self.path = path

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
                CREATE TRIGGER IF NOT EXISTS immutable_finished_run
                BEFORE UPDATE ON runs WHEN OLD.status != 'RUNNING'
                BEGIN SELECT RAISE(ABORT, 'Completed runs are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS immutable_original
                BEFORE UPDATE ON originals
                BEGIN SELECT RAISE(ABORT, 'Originals are immutable'); END;
            """)
            for row in db.execute("SELECT payload FROM runs WHERE status = 'RUNNING'").fetchall():
                run = json.loads(row["payload"])
                run.update(processing_status="INTERRUPTED", finished_at=now(), needs_review=True)
                run["issues"].append(
                    {
                        "code": "RUN_INTERRUPTED",
                        "message": (
                            "The backend restarted before this run finished. "
                            "Start a new extraction."
                        ),
                    }
                )
                for document in run["documents"]:
                    if document["processing_status"] in {"PENDING", "RUNNING"}:
                        document["processing_status"] = "INTERRUPTED"
                        document["error"] = {
                            "code": "RUN_INTERRUPTED",
                            "message": "Extraction was interrupted.",
                        }
                db.execute(
                    "UPDATE runs SET status=?, payload=? WHERE run_id=?",
                    (
                        run["processing_status"],
                        json.dumps(run),
                        run["run_id"],
                    ),
                )

    def create(self, run: dict):
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

    def save(self, run: dict):
        with self.connect() as db:
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

    def save_original(self, run_id: str, doc_id: str, filename: str, content: bytes):
        with self.connect() as db:
            db.execute(
                "INSERT INTO originals VALUES (?, ?, ?, ?)", (run_id, doc_id, filename, content)
            )

    def get(self, run_id: str):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM runs WHERE run_id=?", (run_id,)).fetchone()
            return json.loads(row["payload"]) if row else None

    def list(self, limit: int, offset: int):
        with self.connect() as db:
            total = db.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
            rows = db.execute(
                "SELECT payload FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        items = []
        for row in rows:
            run = json.loads(row["payload"])
            items.append(
                {
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
            )
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    def original(self, run_id: str, document_id: str):
        with self.connect() as db:
            return db.execute(
                "SELECT filename, content FROM originals WHERE run_id=? AND document_id=?",
                (run_id, document_id),
            ).fetchone()
