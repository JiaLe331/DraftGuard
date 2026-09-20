"""Optional structured tracing; document details never go to application logs."""

from collections.abc import Callable
from datetime import UTC, datetime
from time import perf_counter


class Trace:
    def __init__(self, observer: Callable[[dict], None] | None = None):
        self.observer = observer
        self.started = perf_counter()
        self.sequence = 0

    def emit(self, stage: str, status: str, message: str, **details):
        if self.observer is None:
            return
        self.sequence += 1
        self.observer(
            {
                "sequence": self.sequence,
                "timestamp": datetime.now(UTC).isoformat(),
                "elapsed_ms": round((perf_counter() - self.started) * 1000, 3),
                "stage": stage,
                "status": status,
                "message": message,
                "details": details,
            }
        )
