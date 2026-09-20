"""Isolated, time-bounded parser worker. No network or evaluation data access."""

import json
import sys

from app.documents.analysis import analyze

if __name__ == "__main__":
    payload = json.load(sys.stdin)
    json.dump(analyze(payload["email"], payload["documents"]), sys.stdout)
