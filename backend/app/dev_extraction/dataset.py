"""Read only inbox JSON and its declared attachments; never consult answer keys."""

import json
import re
from pathlib import Path, PurePosixPath


class DatasetError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


class Dataset:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def email(self, email_id: str):
        if not re.fullmatch(r"email_\d+", email_id):
            raise DatasetError("EMAIL_NOT_FOUND", "Email not found.", 404)
        inbox = (self.root / "inbox").resolve()
        path = (inbox / f"{email_id}.json").resolve()
        if (
            not inbox.is_relative_to(self.root)
            or not path.is_relative_to(inbox)
            or not path.is_file()
        ):
            raise DatasetError("EMAIL_NOT_FOUND", "Email not found.", 404)
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            if record["email_id"] != email_id or not isinstance(record["attachments"], list):
                raise ValueError()
            if not all(isinstance(a, str) for a in record["attachments"]):
                raise ValueError()
            if not all(isinstance(record[key], str) for key in ("from", "subject", "body")):
                raise ValueError()
        except (ValueError, KeyError, TypeError, OSError) as exc:
            raise DatasetError("INVALID_EMAIL", "The dataset email is malformed.") from exc
        return {key: record[key] for key in ("email_id", "from", "subject", "body", "attachments")}

    def list(self, query: str, has_attachments: bool, limit: int, offset: int):
        if not (self.root / "inbox").is_dir():
            raise DatasetError(
                "DATASET_UNAVAILABLE", "Configure DATASET_DIR to the participant bundle.", 503
            )
        paths = sorted((self.root / "inbox").glob("email_*.json"))
        items = []
        for path in paths:
            email = self.email(path.stem)
            if has_attachments and not email["attachments"]:
                continue
            if (
                query.casefold()
                not in " ".join(email[k] for k in ("email_id", "from", "subject")).casefold()
            ):
                continue
            items.append(
                {
                    "email_id": email["email_id"],
                    "from": email["from"],
                    "subject": email["subject"],
                    "attachment_count": len(email["attachments"]),
                }
            )
        return {
            "items": items[offset : offset + limit],
            "total": len(items),
            "dataset_total": len(paths),
            "limit": limit,
            "offset": offset,
        }

    def attachment(self, reference: str, max_bytes: int) -> bytes:
        relative = PurePosixPath(reference.replace("\\", "/"))
        folder = (self.root / "attachments").resolve()
        path = (self.root / str(relative)).resolve()
        if (
            relative.is_absolute()
            or relative.parts[0:1] != ("attachments",)
            or not folder.is_relative_to(self.root)
            or not path.is_relative_to(folder)
        ):
            raise DatasetError(
                "ATTACHMENT_PATH_INVALID", "The attachment is outside the dataset folder."
            )
        try:
            with path.open("rb") as source:
                data = source.read(max_bytes + 1)
        except OSError as exc:
            raise DatasetError(
                "ATTACHMENT_UNAVAILABLE", "The listed attachment could not be read."
            ) from exc
        if len(data) > max_bytes:
            raise DatasetError(
                "RESOURCE_LIMIT", "The attachment exceeds the document size limit.", 413
            )
        return data
