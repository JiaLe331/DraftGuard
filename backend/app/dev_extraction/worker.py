"""One bounded subprocess invocation; stdout is a structured event/result stream."""

import base64
import json
import sys

from app.extraction import ExtractionLimits, extract_document


def send(kind: str, payload: dict):
    print(json.dumps({"type": kind, "payload": payload}, ensure_ascii=True), flush=True)


def main():
    try:
        request = json.load(sys.stdin)
        result = extract_document(
            base64.b64decode(request["content"], validate=True),
            request["filename"],
            request["document_id"],
            request["expected_role"],
            limits=ExtractionLimits(max_file_bytes=request["max_file_bytes"]),
            observer=lambda event: send("event", event),
        )
        send("result", result.model_dump(mode="json"))
        return 0
    except Exception:
        send("error", {"code": "WORKER_FAILED", "message": "The extraction worker failed."})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
