# DraftGuard

DraftGuard is an AI-assisted shipping document verification workspace. The repository contains an interactive UI prototype and a FastAPI scaffold. The UI uses team-authored sample data; real document ingestion, extraction, and cloud services are not connected yet.

## Requirements

- Node.js 24 (also recorded in `.node-version`)
- pnpm 11.25.0
- uv 0.12.16; uv manages Python 3.12 for the backend

## Setup

Run from the repository root:

```sh
cd frontend
pnpm install --frozen-lockfile
cp .env.example .env
cd ../backend
uv python install 3.12
uv sync --frozen
cp .env.example .env
```

Environment files are optional for the scaffold: the defaults work without cloud credentials. Keep real secrets in local environment files or platform secret settings.

## Start development

In terminal 1, from the repository root:

```sh
cd backend
uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In terminal 2, from the repository root:

```sh
cd frontend
pnpm dev
```

Open <http://localhost:5173>. The frontend works independently of the backend for this prototype. It opens the Overview work queue, with an auxiliary Inbox and a dedicated verification workspace. No cloud credentials are needed.

Try these sample workflows:

- **DG-004:** Inspect two discrepancies, then load sample BL v2 (two resolved, one new weight error) and v3. Complete the current review; older revisions stay read-only.
- **DG-160:** Correct the misread BL gross weight from `88,570 KG` to the actual sample source value `88,750 KG`, enter a source reference, and save.
- **DG-512:** Confirm the illustrative AI candidate against the sample text, then complete the review. This is not a real PDF or AI call.
- **DG-516:** Supply missing information with provenance. It stays unresolved because external evidence cannot be verified in this prototype.

Edits create local working copies saved in this browser. Refresh preserves them; **Reset demo** restores the baseline. Original machine results remain intact. Search and filters live in the URL; return navigation restores the queue state. Use **Print report** in a task to print or save the sample report as PDF.

If the default ports are occupied, leave the other application running. Start this backend with `--port 8001` and run the frontend with `API_PROXY_TARGET=http://127.0.0.1:8001 pnpm dev --port 5174`. Open <http://localhost:5174> in that case. `API_PROXY_TARGET` is a development-server environment override, not a browser variable.

The backend serves:

- `GET /api/health`: `{"status":"ok","service":"draftguard-api"}`
- `/docs`: interactive API documentation

Health reports process liveness only. It does not verify Supabase, Gemini, or document-processing readiness.

## Configuration

The Vite development server proxies `/api` to `http://127.0.0.1:8000`. Leave `VITE_API_BASE_URL` empty to use this proxy. For a separately hosted API, set it to the backend origin (for example, `https://api.example.com`), without `/api`. Restart Vite after changing environment files. Vite public variables are bundled into the frontend; never store secrets in them.

The backend loads `backend/.env`, with process environment variables taking precedence. `APP_ENV` defaults to `development`. `ALLOWED_ORIGINS` is a JSON array, defaulting to localhost and 127.0.0.1 on port 5173; configure the frontend origin when hosting separately. CORS currently permits GET requests for the health endpoint.

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and `DEMO_SESSION_SECRET` are reserved server-side settings. They are optional and unused in this scaffold. No provider clients are initialized.

The Vite proxy is development-only. A production frontend will require a separately hosted backend with the appropriate base URL and CORS configuration, or a host-level `/api` proxy. Deployment is a later milestone.

## Checks

Frontend, from `frontend/`:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
```

Backend, from `backend/`:

```sh
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest
```

Run these checks locally; no cloud credentials are required. Frontend tests cover review safety, version transitions, persistence, and user journeys. Backend tests cover the health response without provider configuration and allowed-origin behavior. The frontend production build is written to `frontend/dist/`.

## Repository layout

- `frontend/`: React, TypeScript, Vite, and ESLint
- `backend/app/`: FastAPI entrypoint, environment configuration, and HTTP routes
- `backend/tests/`: backend smoke tests
- `docs/`: existing product requirements and historical scope confirmation

## Current scope

Implemented: Overview, Inbox, seven-field workspace, sample evidence, local review editing, scan-candidate confirmation, revision demonstrations, completion checks, printable reports, environment templates, dependency locks, and local quality checks.

Not implemented: actual email connection, file upload, parsing, AI extraction, external evidence verification, private cloud storage, or deployment. The PRD's real-data deployment gate is still outstanding. UI sample labels and timestamps must not be presented as live processing results. The health API remains available separately at `/api/health`.

See [the PRD](docs/PRD.md) and [the UI implementation notes](docs/UI.md). New code, comments, logs, UI copy, and documentation use English.
