#!/usr/bin/env python3
"""Copy the local demo store into backend/demo-store for the container image.

The image must not carry SQLite sidecars from a running server, so this refuses
to copy while a -wal or -shm file is present. Stop the backend first.
"""

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]


def check_live(database: Path) -> None:
    for suffix in ("-wal", "-shm"):
        sidecar = database.with_name(database.name + suffix)
        if sidecar.exists():
            raise SystemExit(f"{sidecar} exists; stop the backend before baking the store.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mailbox-dir", type=Path, default=HERE / ".local/demo-mailbox")
    parser.add_argument("--audit-db", type=Path, default=HERE / ".local/extraction-audit.sqlite3")
    parser.add_argument("--out", type=Path, default=HERE / "demo-store")
    args = parser.parse_args()

    mailbox_db = args.mailbox_dir / "mailbox.sqlite3"
    if not mailbox_db.exists():
        raise SystemExit(f"{mailbox_db} not found.")
    check_live(mailbox_db)
    if args.audit_db.exists():
        check_live(args.audit_db)

    if args.out.exists():
        shutil.rmtree(args.out)
    (args.out / "mailbox").mkdir(parents=True)

    shutil.copy2(mailbox_db, args.out / "mailbox/mailbox.sqlite3")
    objects = args.mailbox_dir / "objects"
    if objects.exists():
        shutil.copytree(objects, args.out / "mailbox/objects")
    if args.audit_db.exists():
        shutil.copy2(args.audit_db, args.out / "extraction-audit.sqlite3")

    emails = sqlite3.connect(f"file:{args.out / 'mailbox/mailbox.sqlite3'}?mode=ro", uri=True)
    counts = {
        table: emails.execute(f"select count(*) from {table}").fetchone()[0]
        for table in ("emails", "documents", "runs", "review_events")
    }
    size = sum(path.stat().st_size for path in args.out.rglob("*") if path.is_file())
    print(f"Baked {args.out} — {size / 1_048_576:.1f} MiB", file=sys.stderr)
    for table, count in counts.items():
        print(f"  {table}: {count}", file=sys.stderr)


if __name__ == "__main__":
    main()
