# DraftGuard API — judge-facing demo container.
#
# The frozen demo store (SQLite + source objects) is baked into the image, so
# every visitor starts from the same known-good state: the reviewed email_512
# scan, the email_004 v1/v2/v3 revision history, and the provided 520-email
# sample mailbox. Session writes live in the container and reset when the
# instance restarts; durable persistence is a roadmap item, not a claim here.
FROM python:3.12-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.9.29 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /srv

# Resolve dependencies from the lockfile before copying sources so edits to the
# application do not invalidate the dependency layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY evaluation ./evaluation
RUN uv sync --frozen --no-dev


FROM python:3.12-slim AS runtime

# Run unprivileged; the app only writes inside its own data directory.
RUN useradd --create-home --uid 10001 draftguard
WORKDIR /srv

COPY --from=build --chown=draftguard:draftguard /srv /srv
# The baked demo store. Replace this directory to ship a different baseline.
COPY --chown=draftguard:draftguard demo-store /srv/demo-store

ENV PATH="/srv/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_ENV=demo \
    ENABLE_DEV_EXTRACTION=true \
    LOCAL_DATA_DIR=/srv/demo-store/mailbox \
    DEV_AUDIT_DB=/srv/demo-store/extraction-audit.sqlite3 \
    PORT=8080

USER draftguard
EXPOSE 8080

# Cloud Run supplies PORT. One worker keeps a single SQLite writer, which is
# why the service must also run with a single instance.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --workers 1 --no-access-log
