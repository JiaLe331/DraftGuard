"""Local SQLite persistence for a single development mailbox."""

import hashlib
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from app.config import Settings
from app.dev_extraction.dataset import DatasetError
from app.dev_extraction.service import DocumentInput, RunService
from app.dev_extraction.store import AuditStore
from app.documents.analysis import PIPELINE_VERSION
from app.documents.workflow import MailboxWorkflow
from app.extraction.models import ExtractionLimits

EXTENSIONS = {".txt", ".pdf", ".docx", ".xlsx"}
MAX_BYTES = ExtractionLimits().max_file_bytes


class StoreError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status


def now() -> str:
    return datetime.now(UTC).isoformat()


def encode(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


class Store:
    def __init__(self, directory: Path, run_service: RunService | None = None):
        self.run_service = run_service
        self._service_lock = threading.Lock()
        self._owns_service = run_service is None
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.objects = self.directory / "objects"
        self.objects.mkdir(exist_ok=True)
        self.database = self.directory / "mailbox.sqlite3"
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS emails (
                    id TEXT PRIMARY KEY, subject TEXT NOT NULL, sender TEXT NOT NULL,
                    body TEXT NOT NULL, position INTEGER NOT NULL, revision INTEGER NOT NULL,
                    fingerprint TEXT NOT NULL, document_ids TEXT NOT NULL,
                    current_run_id TEXT, latest_run_id TEXT
                );
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY, email_id TEXT NOT NULL REFERENCES emails(id),
                    source_key TEXT NOT NULL, filename TEXT NOT NULL, sha256 TEXT NOT NULL,
                    byte_count INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(email_id, source_key, sha256)
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, email_id TEXT NOT NULL REFERENCES emails(id),
                    revision INTEGER NOT NULL, document_ids TEXT NOT NULL,
                    pipeline_version TEXT NOT NULL, mode TEXT NOT NULL,
                    status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
                    result TEXT, error TEXT
                );
                CREATE INDEX IF NOT EXISTS runs_by_email ON runs(email_id, started_at);
            """)
            if "audit_run_id" not in {row[1] for row in db.execute("PRAGMA table_info(runs)")}:
                db.execute("ALTER TABLE runs ADD COLUMN audit_run_id TEXT")
            # Leave time for the shared 60s run deadline and final persistence.
            cutoff = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
            db.execute(
                "UPDATE runs SET status='FAILED', finished_at=?, error=? "
                "WHERE status='RUNNING' AND started_at<?",
                (
                    now(),
                    encode(
                        {
                            "code": "interrupted",
                            "message": "Analysis was interrupted. Run it again.",
                        }
                    ),
                    cutoff,
                ),
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def import_dataset(self, root: Path) -> list[str]:
        """Read only inbox JSON and explicitly referenced attachment bytes."""
        root = root.resolve()
        paths = sorted((root / "inbox").glob("*.json"))
        if not paths:
            raise StoreError("invalid_dataset", "No inbox JSON files were found.")
        prepared, ids = [], set()
        for path in paths:
            if not path.resolve().is_relative_to(root / "inbox") or path.stat().st_size > MAX_BYTES:
                raise StoreError("invalid_dataset", "Email input is outside supported limits.")
            try:
                email = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError) as exc:
                raise StoreError(
                    "invalid_dataset", "An email JSON file could not be read."
                ) from exc
            if not isinstance(email, dict) or any(
                not isinstance(email.get(key), str)
                for key in ("email_id", "from", "subject", "body")
            ):
                raise StoreError("invalid_dataset", "Email metadata has invalid required fields.")
            email_id = email["email_id"]
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", email_id) or email_id in ids:
                raise StoreError("invalid_dataset", "Email IDs must be unique and path-safe.")
            ids.add(email_id)
            attachments = email.get("attachments")
            if (
                not isinstance(attachments, list)
                or len(attachments) > 10
                or any(not isinstance(a, str) for a in attachments)
                or len(set(attachments)) != len(attachments)
            ):
                raise StoreError(
                    "invalid_dataset", "Each email supports up to 10 unique attachments."
                )
            files = []
            for reference in attachments:
                relative = Path(reference)
                target = (root / relative).resolve()
                if (
                    relative.is_absolute()
                    or ".." in relative.parts
                    or relative.parts[:1] != ("attachments",)
                    or not target.is_relative_to(root / "attachments")
                ):
                    raise StoreError("unsafe_path", "An attachment reference leaves the dataset.")
                if not target.is_file() or target.stat().st_size > MAX_BYTES:
                    raise StoreError(
                        "invalid_attachment", "An attachment is missing or exceeds 10 MB."
                    )
                if target.suffix.lower() not in EXTENSIONS:
                    raise StoreError("unsupported_format", "An attachment format is not supported.")
                content = target.read_bytes()
                files.append(
                    {
                        "source_key": reference,
                        "filename": relative.name,
                        "sha256": hashlib.sha256(content).hexdigest(),
                        "content": content,
                    }
                )
            metadata = {key: email[key] for key in ("email_id", "from", "subject", "body")}
            fingerprint = hashlib.sha256(
                encode(
                    {
                        "email": metadata,
                        "attachments": [{k: f[k] for k in ("source_key", "sha256")} for f in files],
                    }
                ).encode()
            ).hexdigest()
            prepared.append((metadata, files, fingerprint))
        changed = []
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for position, (email, files, fingerprint) in enumerate(prepared):
                email_id = email["email_id"]
                previous = db.execute("SELECT * FROM emails WHERE id=?", (email_id,)).fetchone()
                if previous and previous["fingerprint"] == fingerprint:
                    continue
                if previous:
                    self._check_not_running(db, previous)
                revision = previous["revision"] + 1 if previous else 1
                db.execute(
                    """INSERT INTO emails
                    (id,subject,sender,body,position,revision,fingerprint,document_ids)
                    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                    subject=excluded.subject,sender=excluded.sender,body=excluded.body,
                    position=excluded.position,revision=excluded.revision,
                    fingerprint=excluded.fingerprint,document_ids='[]',
                    current_run_id=NULL,latest_run_id=NULL""",
                    (
                        email_id,
                        email["subject"],
                        email["from"],
                        email["body"],
                        position,
                        revision,
                        fingerprint,
                        "[]",
                    ),
                )
                document_ids = []
                for file in files:
                    existing = db.execute(
                        "SELECT id FROM documents WHERE email_id=? AND source_key=? AND sha256=?",
                        (email_id, file["source_key"], file["sha256"]),
                    ).fetchone()
                    if existing:
                        document_ids.append(existing["id"])
                        continue
                    version = db.execute(
                        "SELECT COALESCE(MAX(version),0)+1 FROM documents "
                        "WHERE email_id=? AND source_key=?",
                        (email_id, file["source_key"]),
                    ).fetchone()[0]
                    doc_id = str(uuid4())
                    destination = self.objects / file["sha256"]
                    if not destination.exists():
                        temp = self.objects / f".{uuid4()}.tmp"
                        temp.write_bytes(file["content"])
                        temp.replace(destination)
                    db.execute(
                        "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)",
                        (
                            doc_id,
                            email_id,
                            file["source_key"],
                            file["filename"],
                            file["sha256"],
                            len(file["content"]),
                            version,
                            now(),
                        ),
                    )
                    document_ids.append(doc_id)
                db.execute(
                    "UPDATE emails SET document_ids=? WHERE id=?", (encode(document_ids), email_id)
                )
                changed.append(email_id)
        return changed

    def _recover_expired(self, db):
        cutoff = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
        db.execute(
            "UPDATE runs SET status='FAILED', finished_at=?, error=? "
            "WHERE status='RUNNING' AND started_at<?",
            (
                now(),
                encode(
                    {"code": "interrupted", "message": "Analysis was interrupted. Run it again."}
                ),
                cutoff,
            ),
        )

    def _check_not_running(self, db, email):
        self._recover_expired(db)
        run = self._run(db, email["latest_run_id"])
        if run and run["status"] == "RUNNING":
            raise StoreError("analysis_running", "Analysis is already running for this email.", 409)

    def _run(self, db, run_id):
        row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            return None
        run = dict(row)
        for key in ("result", "error", "document_ids"):
            run[key] = json.loads(run[key]) if run[key] is not None else None
        return run

    def _email(self, db, email_id):
        row = db.execute("SELECT * FROM emails WHERE id=?", (email_id,)).fetchone()
        if row is None:
            raise StoreError("not_found", "This email could not be found.", 404)
        return dict(row)

    def _documents(self, db, email):
        return [
            dict(db.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone())
            for doc_id in json.loads(email["document_ids"])
        ]

    def document_path(self, document: dict) -> Path:
        path = (self.objects / document["sha256"]).resolve()
        if (
            not path.is_relative_to(self.objects)
            or not path.is_file()
            or hashlib.sha256(path.read_bytes()).hexdigest() != document["sha256"]
        ):
            raise StoreError(
                "source_unavailable", "The stored source is missing or has changed.", 409
            )
        return path

    def extraction_service(self):
        with self._service_lock:
            if self.run_service is None:
                settings = Settings(
                    local_data_dir=self.directory,
                    dev_audit_db=self.directory / "extraction-audit.sqlite3",
                    _env_file=None,
                )
                audit = AuditStore(settings.dev_audit_db)
                audit.initialize()
                self.run_service = RunService(audit, settings)
            return self.run_service

    def close(self):
        if self._owns_service and self.run_service:
            self.run_service.shutdown()

    def recover_audit_runs(self):
        """Called on application startup after audit interruption recovery."""
        with self.connect() as db:
            db.execute(
                "UPDATE runs SET status='FAILED',finished_at=?,error=? WHERE status='RUNNING'",
                (
                    now(),
                    encode(
                        {
                            "code": "interrupted",
                            "message": "Analysis was interrupted. Run it again.",
                        }
                    ),
                ),
            )

    def analyze(
        self,
        email_id: str,
        expected_revision: int,
        mode: str = "interactive",
        *,
        request_id=None,
        wait=True,
    ) -> dict:
        service = self.extraction_service()
        run_id = str(uuid4())
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            email = self._email(db, email_id)
            if email["revision"] != expected_revision:
                raise StoreError(
                    "stale_revision", "The source changed. Refresh before analyzing.", 409
                )
            self._check_not_running(db, email)
            docs = self._documents(db, email)
            db.execute(
                "INSERT INTO runs (id,email_id,revision,document_ids,pipeline_version,mode,"
                "status,started_at) VALUES (?,?,?,?,?,?,'RUNNING',?)",
                (
                    run_id,
                    email_id,
                    expected_revision,
                    email["document_ids"],
                    PIPELINE_VERSION,
                    mode,
                    now(),
                ),
            )
            db.execute("UPDATE emails SET latest_run_id=? WHERE id=?", (run_id, email_id))

        def read(document):
            try:
                return self.document_path(document).read_bytes()
            except StoreError as exc:
                raise DatasetError(exc.code, str(exc), exc.status) from exc

        inputs = [
            DocumentInput(doc["filename"], lambda doc=doc: read(doc), document_id=doc["id"])
            for doc in docs
        ]
        snapshot = {
            "email_id": email_id,
            "subject": email["subject"],
            "from": email["sender"],
            "body": email["body"],
            "attachments": [doc["filename"] for doc in docs],
        }
        try:
            service.run(
                inputs,
                "mailbox_email",
                email["subject"],
                snapshot,
                request_id or f"local-{uuid4()}",
                wait,
                workflow=MailboxWorkflow(self, email, run_id, mode),
                run_id=run_id,
            )
        except (DatasetError, sqlite3.Error) as exc:
            code = getattr(exc, "code", "AUDIT_SAVE_FAILED")
            message = getattr(exc, "message", "Audit recording failed; analysis stopped.")
            with self.connect() as db:
                db.execute(
                    "UPDATE runs SET status='FAILED',finished_at=?,error=? "
                    "WHERE id=? AND status='RUNNING'",
                    (now(), encode({"code": code, "message": message}), run_id),
                )
            raise StoreError(code, message, getattr(exc, "status", 503)) from exc
        return self.detail(email_id)

    def _summary(self, db, email):
        current = self._run(db, email["current_run_id"])
        latest = self._run(db, email["latest_run_id"])
        result = current["result"] if current else None
        state = result["workflow_state"] if result else "NOT_ANALYZED"
        if latest and latest["status"] in {"FAILED", "RUNNING"}:
            state = latest["status"]
        return {
            "id": email["id"],
            "subject": email["subject"],
            "sender": email["sender"],
            "revision": email["revision"],
            "attachment_count": len(json.loads(email["document_ids"])),
            "category": result["classification"]["category"] if result else None,
            "workflow_state": state,
            "last_analyzed": latest["finished_at"] if latest else None,
            "mode": current["mode"] if current else None,
            "known_defect_fields": result["known_defect_fields"] if result else [],
            "coverage": result["coverage"] if result else {"checked": 0, "total": 7},
        }

    def list_samples(self, q="", category="", status="", page=1, limit=50):
        with self.connect() as db:
            self._recover_expired(db)
            rows = db.execute("SELECT * FROM emails ORDER BY position,id").fetchall()
            items = [self._summary(db, row) for row in rows]
            summary = {
                "total": len(items),
                "attachments": sum(i["attachment_count"] for i in items),
                "states": {},
            }
            for item in items:
                state = item["workflow_state"]
                summary["states"][state] = summary["states"].get(state, 0) + 1
            matching_ids = {
                row["id"]
                for row in rows
                if q.casefold()
                in f"{row['id']} {row['subject']} {row['sender']} {row['body']}".casefold()
            }
            filtered = [
                i
                for i in items
                if i["id"] in matching_ids
                and (
                    not category
                    or i["category"] == category
                    or category == "UNCLASSIFIED"
                    and i["category"] is None
                )
                and (
                    not status
                    or i["workflow_state"] == status
                    or status == "ATTENTION"
                    and i["workflow_state"] in {"REVIEW_REQUIRED", "DISCREPANCIES_FOUND", "FAILED"}
                )
            ]
            start = (page - 1) * limit
            return {
                "items": filtered[start : start + limit],
                "total": len(filtered),
                "page": page,
                "limit": limit,
                "summary": summary,
            }

    def detail(self, email_id):
        with self.connect() as db:
            self._recover_expired(db)
            email = self._email(db, email_id)
            docs = self._documents(db, email)
            # Private source keys and local filesystem paths never leave the store.
            public_docs = [
                {
                    k: doc[k]
                    for k in ("id", "filename", "sha256", "byte_count", "version", "created_at")
                }
                for doc in docs
            ]
            runs = db.execute(
                "SELECT id,revision,pipeline_version,mode,status,started_at,finished_at,"
                "audit_run_id "
                "FROM runs WHERE email_id=? ORDER BY started_at DESC",
                (email_id,),
            )
            return {
                **self._summary(db, email),
                "body": email["body"],
                "documents": public_docs,
                "current_run": self._run(db, email["current_run_id"]),
                "latest_run": self._run(db, email["latest_run_id"]),
                "runs": [dict(row) for row in runs],
            }

    def get_document(self, email_id, document_id):
        with self.connect() as db:
            self._email(db, email_id)
            row = db.execute(
                "SELECT * FROM documents WHERE email_id=? AND id=?", (email_id, document_id)
            ).fetchone()
            if not row:
                raise StoreError("not_found", "This attachment could not be found.", 404)
            doc = dict(row)
            return doc, self.document_path(doc)
