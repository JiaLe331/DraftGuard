import json
import zipfile
from pathlib import Path

import pytest

from scripts.demo_store import create_archive, restore_archive, verify_archive


def make_store(root: Path):
    mailbox = root / "mailbox"
    objects = mailbox / "objects/aa"
    objects.mkdir(parents=True)
    (mailbox / "mailbox.sqlite3").write_bytes(b"mailbox")
    (objects / "source").write_bytes(b"document")
    audit = root / "audit.sqlite3"
    audit.write_bytes(b"audit")
    return mailbox, audit


def test_demo_store_round_trip_is_verified_and_never_overwrites(tmp_path):
    mailbox, audit = make_store(tmp_path)
    archive = tmp_path / "freeze/demo.zip"
    manifest = create_archive(mailbox, audit, archive)
    assert len(manifest["files"]) == 3
    assert verify_archive(archive)["files"] == manifest["files"]

    target = tmp_path / "restored"
    restore_archive(archive, target)
    assert (target / "mailbox/mailbox.sqlite3").read_bytes() == b"mailbox"
    assert (target / "mailbox/objects/aa/source").read_bytes() == b"document"
    assert (target / "audit.sqlite3").read_bytes() == b"audit"
    with pytest.raises(ValueError, match="never overwrites"):
        restore_archive(archive, target)
    with pytest.raises(ValueError, match="already exists"):
        create_archive(mailbox, audit, archive)


def test_demo_store_rejects_unmanifested_content_and_live_sidecars(tmp_path):
    mailbox, audit = make_store(tmp_path)
    archive = tmp_path / "demo.zip"
    create_archive(mailbox, audit, archive)
    with zipfile.ZipFile(archive, "a") as bundle:
        bundle.writestr("unexpected", b"data")
    with pytest.raises(ValueError, match="unmanifested"):
        verify_archive(archive)

    archive.unlink()
    Path(f"{mailbox / 'mailbox.sqlite3'}-wal").write_bytes(b"live")
    with pytest.raises(ValueError, match="Stop the backend"):
        create_archive(mailbox, audit, archive)


def test_demo_store_rejects_tampered_manifest_hash(tmp_path):
    mailbox, audit = make_store(tmp_path)
    archive = tmp_path / "demo.zip"
    create_archive(mailbox, audit, archive)
    rewritten = tmp_path / "tampered.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(rewritten, "w") as target:
        manifest = json.loads(source.read("manifest.json"))
        manifest["files"][0]["sha256"] = "0" * 64
        for name in source.namelist():
            target.writestr(
                name,
                json.dumps(manifest).encode() if name == "manifest.json" else source.read(name),
            )
    with pytest.raises(ValueError, match="integrity failed"):
        verify_archive(rewritten)
