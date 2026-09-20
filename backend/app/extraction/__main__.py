"""Run with python -m app.extraction FILE [--role SI|BL]."""

import argparse
import json
import sys
from pathlib import Path
from uuid import uuid4

from . import ExtractionLimits, extract_document


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract seven shipment fields from one document.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--role", choices=["SI", "BL"])
    parser.add_argument("--document-id", help="Immutable source ID; defaults to a local UUID.")
    args = parser.parse_args()
    limits = ExtractionLimits()
    try:
        # Bounded read also protects the CLI before the library checks the input size.
        with args.file.open("rb") as stream:
            content = stream.read(limits.max_file_bytes + 1)
    except OSError:
        print(
            json.dumps(
                {
                    "error": {
                        "code": "FILE_READ_FAILED",
                        "message": "The input file could not be read.",
                        "next_action": "Check the file path and read permissions.",
                    }
                }
            )
        )
        return 2
    if len(content) > limits.max_file_bytes:
        # Do not publish a hash of truncated bytes as the hash of the source file.
        print(
            json.dumps(
                {
                    "error": {
                        "code": "RESOURCE_LIMIT",
                        "message": "The file exceeds the configured byte limit.",
                        "next_action": "Upload a smaller document.",
                    }
                }
            )
        )
        return 2
    try:
        result = extract_document(
            content,
            args.file.name,
            args.document_id or f"local-{uuid4()}",
            args.role,
            limits=limits,
        )
    except ValueError as exc:
        parser.error(str(exc))
    # ASCII escapes make the JSON portable across Windows terminal encodings.
    print(json.dumps(result.model_dump(mode="json"), ensure_ascii=True, indent=2))
    return 2 if result.parsing_status in {"REJECTED", "FAILED"} else 0


if __name__ == "__main__":
    sys.exit(main())
