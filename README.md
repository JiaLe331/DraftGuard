# DraftGuard

DraftGuard is an AI-assisted shipping document verification workspace. This initial scaffold provides a runnable frontend and backend; document processing is not implemented yet.

## Requirements

- Node.js 24 and pnpm 11.25.0
- uv 0.12.16 and Python 3.12 (managed by uv)

## Setup

From the repository root:

```sh
cd frontend
pnpm install --frozen-lockfile
cp .env.example .env
cd ../backend
uv python install 3.12
uv sync --frozen
cp .env.example .env
```

Environment files are optional for this scaffold. Cloud credentials are not required.

## Development

Start the backend in one terminal, from the repository root:

```sh
cd backend
uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```sh
cd frontend
pnpm dev
```

Open <http://localhost:5173>. The placeholder page checks the backend and displays loading, connected, or unavailable. Stop the backend and retry to test failure, then restart and retry to test recovery.

The API exposes `GET /api/health` with `{"status":"ok","service":"draftguard-api"}` and interactive documentation at `/docs`. Health indicates process liveness, not provider readiness.

If ports are occupied, start the backend on 8001 and use `API_PROXY_TARGET=http://127.0.0.1:8001 pnpm dev --port 5174` for the frontend.

## Configuration

Vite proxies `/api` to the local backend during development. For a separately hosted API, set `VITE_API_BASE_URL` to its origin, without `/api`, and configure the backend's `ALLOWED_ORIGINS` JSON array. Vite variables are public; never put secrets in them.

Backend configuration reads `backend/.env`. Supabase, Gemini, and demo-session settings are reserved for future integrations and may remain empty. Production hosting must provide an API origin or its own proxy.

## Checks

From `frontend/`:

```sh
pnpm lint
pnpm typecheck
pnpm build
```

From `backend/`:

```sh
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest
```

GitHub Actions runs these checks using frozen lockfiles without cloud credentials.

## Scope

`frontend/` contains React, TypeScript, and Vite. `backend/app/` separates settings, HTTP routes, and the application entrypoint. See [the PRD](docs/PRD.md) for product requirements.

UI design, upload, parsing, comparison, AI processing, persistence, and deployment are subsequent milestones. The PRD's real-data deployment gate is not complete. New code, comments, and documentation use English.
