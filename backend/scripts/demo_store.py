#!/usr/bin/env python3
"""Create, verify, or safely restore a reproducible local DraftGuard demo store."""

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

MANIFEST = "manifest.json"


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def source_files(mailbox_dir: Path, audit_db: Path) -> list[tuple[Path, str]]:
    mailbox_dir = mailbox_dir.resolve()
    audit_db = audit_db.resolve()
    database = mailbox_dir / "mailbox.sqlite3"
    if not database.is_file():
        raise ValueError(f"Mailbox database not found: {database}")
    files = [(database, "mailbox/mailbox.sqlite3")]
    objects = mailbox_dir / "objects"
    if objects.is_dir():
        files.extend(
            (path, f"mailbox/objects/{path.relative_to(objects).as_posix()}")
            for path in sorted(objects.rglob("*"))
            if path.is_file()
        )
    if audit_db.is_file():
        files.append((audit_db, "audit.sqlite3"))
    databases = [database, audit_db]
    sidecars = [Path(f"{path}{suffix}") for path in databases for suffix in ("-wal", "-shm")]
    if any(path.exists() for path in sidecars):
        raise ValueError("Stop the backend and checkpoint SQLite before freezing the demo store.")
    return files


def create_archive(mailbox_dir: Path, audit_db: Path, archive: Path) -> dict:
    if archive.exists():
        raise ValueError("The archive already exists; choose a new path.")
    files = source_files(mailbox_dir, audit_db)
    archive.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path, name in files:
            content = path.read_bytes()
            bundle.writestr(name, content)
            entries.append({"path": name, "bytes": len(content), "sha256": digest(content)})
        manifest = {
            "version": 1,
            "created_at": datetime.now(UTC).isoformat(),
            "files": entries,
        }
        bundle.writestr(MANIFEST, json.dumps(manifest, indent=2) + "\n")
    return manifest


def verify_archive(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as bundle:
        names = set(bundle.namelist())
        if MANIFEST not in names:
            raise ValueError("The demo archive has no manifest.")
        manifest = json.loads(bundle.read(MANIFEST))
        expected = {item["path"] for item in manifest.get("files", [])}
        if names != expected | {MANIFEST}:
            raise ValueError("The demo archive contains unmanifested or missing files.")
        for item in manifest["files"]:
            name = item["path"]
            parts = PurePosixPath(name).parts
            if not parts or name.startswith("/") or ".." in parts:
                raise ValueError("The demo archive contains an unsafe path.")
            content = bundle.read(name)
            if len(content) != item["bytes"] or digest(content) != item["sha256"]:
                raise ValueError(f"Demo archive integrity failed for {name}.")
    return manifest


def restore_archive(archive: Path, target: Path) -> dict:
    manifest = verify_archive(archive)
    if target.exists():
        raise ValueError("The restore target already exists; restoration never overwrites data.")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{target.name}-", dir=target.parent))
    try:
        with zipfile.ZipFile(archive) as bundle:
            for item in manifest["files"]:
                destination = temporary / item["path"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(bundle.read(item["path"]))
        temporary.rename(target)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("--mailbox-dir", type=Path, default=Path(".local"))
    create.add_argument("--audit-db", type=Path, default=Path(".local/extraction-audit.sqlite3"))
    create.add_argument("--archive", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--archive", type=Path, required=True)
    restore = commands.add_parser("restore")
    restore.add_argument("--archive", type=Path, required=True)
    restore.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "create":
            manifest = create_archive(args.mailbox_dir, args.audit_db, args.archive)
        elif args.command == "verify":
            manifest = verify_archive(args.archive)
        else:
            manifest = restore_archive(args.archive, args.target)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.exit(1, f"demo_store: {exc}\n")
    print(json.dumps({"command": args.command, "files": len(manifest["files"])}, indent=2))


if __name__ == "__main__":
    sys.exit(main())
