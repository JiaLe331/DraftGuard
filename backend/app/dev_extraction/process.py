"""Incremental subprocess output with a deadline independent of pipe reads/writes."""

import base64
import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

from app.extraction import DocumentExtraction


def run_worker(content, document, timeout, max_file_bytes, observer=None, stopping=None):
    payload = json.dumps(
        {
            "content": base64.b64encode(content).decode("ascii"),
            "filename": document["filename"],
            "document_id": document["document_id"],
            "expected_role": document["expected_role"],
            "max_file_bytes": max_file_bytes,
        }
    ).encode()
    process = subprocess.Popen(
        [sys.executable, "-m", "app.dev_extraction.worker"],
        cwd=Path(__file__).resolve().parents[2],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    lines = queue.Queue(maxsize=128)
    closed, expired = threading.Event(), threading.Event()

    def kill():
        try:
            process.kill()
        except OSError:
            pass

    def expire():
        expired.set()
        kill()

    def put(value):
        while not closed.is_set():
            try:
                lines.put(value, timeout=0.05)
                return
            except queue.Full:
                continue

    def read():
        try:
            while not closed.is_set():
                line = process.stdout.readline(32 * 1024 * 1024 + 1)
                if not line:
                    break
                if len(line) > 32 * 1024 * 1024:
                    put(b"invalid")
                    kill()
                    break
                put(line)
        finally:
            put(None)

    def write():
        try:
            process.stdin.write(payload)
            process.stdin.flush()
        except (OSError, ValueError):
            pass
        finally:
            try:
                process.stdin.close()
            except (OSError, ValueError):
                pass

    reader = threading.Thread(target=read, daemon=True)
    writer = threading.Thread(target=write, daemon=True)
    timer = threading.Timer(timeout, expire)
    timer.daemon = True
    events, result, error = [], None, None
    timer.start()
    reader.start()
    writer.start()
    try:
        while True:
            if stopping is not None and stopping.is_set():
                error = {"code": "RUN_INTERRUPTED", "message": "The backend is shutting down."}
                break
            try:
                line = lines.get(timeout=0.05)
            except queue.Empty:
                continue
            if line is None:
                break
            try:
                message = json.loads(line)
                if message["type"] == "event":
                    item = message["payload"]
                    # Observer errors must propagate as recording failures, not parser errors.
                    if not isinstance(item, dict):
                        raise ValueError("Invalid event")
                elif message["type"] == "result":
                    result = DocumentExtraction.model_validate(message["payload"]).model_dump(
                        mode="json"
                    )
                elif message["type"] == "error":
                    error = message["payload"]
                else:
                    raise ValueError("Unknown output")
            except (ValueError, KeyError, TypeError):
                error = {
                    "code": "INVALID_WORKER_OUTPUT",
                    "message": "The extraction output was incomplete.",
                }
                break
            if message["type"] == "event":
                if observer:
                    observer(item)
                events.append(item)
        if error is None:
            # A worker that closes stdout but stays alive is still subject to the timer.
            while process.poll() is None and not expired.is_set():
                if stopping is not None and stopping.wait(0.05):
                    error = {"code": "RUN_INTERRUPTED", "message": "The backend is shutting down."}
                    break
                if stopping is None:
                    try:
                        process.wait(timeout=0.05)
                    except subprocess.TimeoutExpired:
                        pass
        if expired.is_set():
            error = {"code": "EXTRACTION_TIMEOUT", "message": "Extraction exceeded its time limit."}
    finally:
        timer.cancel()
        closed.set()
        kill()
        process.wait()
        reader.join()
        writer.join()
        process.stdout.close()
    if error or process.returncode != 0 or result is None:
        return (
            None,
            events,
            error
            or {
                "code": "WORKER_FAILED",
                "message": "The extraction worker failed.",
            },
        )
    return result, events, None
