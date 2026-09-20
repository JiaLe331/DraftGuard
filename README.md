# DraftGuard

DraftGuard is an AI-assisted shipping document verification workspace. The repository contains an interactive sample workspace and a working local extraction flow for TXT, PDF, DOCX, and XLSX. The **Local extraction** page supports uploads, supplied dataset emails, source evidence, and saved SQLite audit history.

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
uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
```

In terminal 2, from the repository root:

```sh
cd frontend
pnpm dev
```

Open <http://localhost:5173>. The sample workspace works independently of the backend. The extraction page requires the backend and the enablement settings below. No Docker or cloud credentials are needed.

Try these sample workflows:

- **DG-004:** Inspect two discrepancies, then load sample BL v2 (two resolved, one new weight error) and v3. Complete the current review; older revisions stay read-only.
- **DG-160:** Correct the misread BL gross weight from `88,570 KG` to the actual sample source value `88,750 KG`, enter a source reference, and save.
- **DG-512:** Confirm the illustrative AI candidate against the sample text, then complete the review. This is not a real PDF or AI call.
- **DG-516:** Supply missing information with provenance. It stays unresolved because external evidence cannot be verified in this prototype.

Edits create local working copies saved in this browser. Refresh preserves them; **Reset demo** restores the baseline. Original machine results remain intact. Search and filters live in the URL; return navigation restores the queue state. Use **Print report** in a task to print or save the sample report as PDF.

If the default ports are occupied, leave the other application running. Start this backend with `--port 8001` and run the frontend with `API_PROXY_TARGET=http://127.0.0.1:8001 pnpm dev --port 5174`. Open <http://localhost:5174> in that case. `API_PROXY_TARGET` is a development-server environment override, not a browser variable.

The backend serves:

- `GET /api/health`: liveness plus `capabilities.development_extraction` and `capabilities.upload_limit_bytes`
- `/docs`: interactive API documentation
- `/api/v1/dev/*`: uploads, supplied emails, and saved extraction history when explicitly enabled

Health reports process liveness and configured feature availability. It does not check dataset files or cloud services.

## Local extraction

In `backend/.env`, set `APP_ENV=development` and `ENABLE_DEV_EXTRACTION=true`, then
restart the backend. Open <http://127.0.0.1:5173/extraction>:

- **Dataset inbox:** select `email_004` and click **Extract attachments** to process both listed files automatically. The default bundle is the sibling `sdoc-hackathon-bundle`; override with `DATASET_DIR` if needed.
- **Upload a document:** choose `backend/tests/fixtures/extraction/email_160_SI.pdf` to inspect seven fields, page evidence, and the original PDF.
- **History:** reopen saved runs and download the full audit JSON. History survives backend restarts in `backend/.local/extraction-audit.sqlite3` (override with `DEV_AUDIT_DB`). The sample workspace's **Reset demo** does not affect it.

The routes are unavailable in production or when the feature flag is off. Development
history is shared by callers of the local backend. Each rerun creates a new record.
See [the extraction setup guide](docs/EXTRACTION.md) for API requests, configuration,
review states, resource limits, and frontend integration examples.

The standalone CLI also remains available from `backend/`:

```sh
uv run --frozen python -m app.extraction tests/fixtures/extraction/email_160_SI.pdf --role SI
```

The command prints seven fields, original/canonical values, source evidence, and review issues as JSON. A successful command can still report missing or ambiguous values; inspect `needs_review`. See [the extraction guide](docs/EXTRACTION.md) for all formats, limits, tests, and the Python interface for backend integration.

## Configuration

The Vite development server proxies `/api` to `http://127.0.0.1:8000`. Leave `VITE_API_BASE_URL` empty to use this proxy. For a separately hosted API, set it to the backend origin (for example, `https://api.example.com`), without `/api`. Restart Vite after changing environment files. Vite public variables are bundled into the frontend; never store secrets in them.

The backend loads `backend/.env`, with process environment variables taking precedence. `APP_ENV` defaults to `development`; `ENABLE_DEV_EXTRACTION` defaults to `false`. `ALLOWED_ORIGINS` is a JSON array, defaulting to localhost and 127.0.0.1 on port 5173; configure the frontend origin for direct cross-origin calls. CORS permits GET and, when development extraction is enabled, POST.

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

Run these checks locally; no cloud credentials are required. Frontend tests cover sample review safety and real extraction journeys, uploads, evidence, history, and failed saves. Backend tests cover health/CORS, four-format extraction, the development API, local persistence, restart recovery, timeouts, uncertainty, malformed inputs, resource limits, and the CLI. The frontend production build is written to `frontend/dist/`.

## Repository layout

- `frontend/`: React, TypeScript, Vite, and ESLint
- `backend/app/`: FastAPI entrypoint, environment configuration, HTTP routes, and standalone extraction
- `backend/tests/`: backend and extraction tests with source fixtures
- `docs/`: existing product requirements and historical scope confirmation

## Current scope

Implemented: sample Overview/Inbox/review workflows, standalone four-format rule-based extraction, and the separate Local extraction API and UI with dataset attachments, manual upload, original files, evidence, and persistent local audit history.

Not implemented: live email connection, classification, production SI/BL comparison, AI extraction, external evidence verification, private cloud storage, or deployment. The PRD's real-data deployment gate is still outstanding. Sample workspace labels and timestamps remain illustrative; Local extraction shows actual runs and recorded evidence.

See [the PRD](docs/PRD.md) and [the UI implementation notes](docs/UI.md). New code, comments, logs, UI copy, and documentation use English.
