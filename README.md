# DraftGuard

DraftGuard turns the organizer's shipping-document dataset into a local demo mailbox. It imports original email JSON and attachments, runs real rule-based classification and seven-field SI / draft-BL comparison, and saves results in SQLite. Overview, Inbox, and the verification workspace use the backend API; no personal Gmail account is connected.

This is a **local development milestone**. Cloud persistence, Gemini, public deployment, and human review writes are not connected. A match means **Ready for review**, never completed or approved.

## Requirements and installation

- Node.js 24 (recorded in `.node-version`)
- pnpm 11.25.0
- uv 0.12.16; uv manages Python 3.12

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

Environment files are optional; the development defaults need no cloud credentials. Keep actual secrets out of the repository and browser variables.

## Import and preanalyze the mailbox

The organizer dataset is an external development input, not committed in this repository. Obtain the provided `data_v2` folder, keeping its `inbox/` and `attachments/` structure. In this workspace it is at `../problem-statement/sdoc-hackathon-docker/data_v2` relative to the repository root.

From `backend/`:

```sh
uv run --frozen python -m app.cli import-dataset \
  --source ../../problem-statement/sdoc-hackathon-docker/data_v2 --analyze
```

For another checkout, replace `--source` with the absolute path to the provided dataset. The importer reads **only** inbox JSON and explicitly referenced attachments; it never reads `ground_truth.json`, sample submissions, or generator internals. Expected input: 520 emails and 250 attachments.

- Without `--analyze`, import leaves new records unprocessed.
- Repeating the command with unchanged input does not duplicate emails, document versions, or successful current runs.
- Changed email content or attachments advance the source revision; original attachment snapshots and prior runs remain available. Import is an upsert, not a deletion/synchronization command.
- `--analyze` handles missing results or changed pipeline versions. Add `--rerun` to recompute all records, including unchanged ones.
- A per-email processing failure is saved and does not stop the batch. The command prints the actual state totals; inconclusive classification and document review requirements are not successful comparisons.
- Starting the API does not import or analyze the dataset automatically.

The default store is `backend/.local/mailbox.sqlite3` plus content-hashed files under `backend/.local/objects/`. This directory is ignored by Git. No dataset or analysis data is put in the frontend bundle or browser localStorage.

## Team setup and data ownership

Each teammate uses their own copy of the organizer dataset. After installing dependencies, run the import command from `backend/`, supplying your own source directory:

```sh
uv run --frozen python -m app.cli import-dataset \
  --source "/absolute/path/to/data_v2" --analyze
```

The source path is a command argument, not a machine-specific path embedded in application code. Preserve the dataset's `inbox/` and `attachments/` structure. Keep the provided dataset outside the Git checkout; do not commit or force-add it.

Import copies referenced attachments into `backend/.local/objects/` and stores their hashes and metadata in SQLite. Analysis and original-file viewing subsequently read those managed copies, not the original dataset directory. Reimport explicitly to capture changed source files as new revisions.

Cloning or pulling the repository does not transfer the dataset, local database, attachments, or analysis history. Each teammate's local mailbox is independent. The organizer's `loader.py` supports local and HTTP reads, but this milestone uses our validated local importer; no organizer HTTP service is required or connected.

This storage setup is for local development. Before deployment, implement persistent database/object storage, access controls, and session isolation against the PRD. Supabase database and Storage remain planned integrations. A shared data loader alone would not synchronize analysis or future human-review changes between teammates.

## Start development in two terminals

Terminal 1, from the repository root:

```sh
cd backend
uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
```

Terminal 2:

```sh
cd frontend
pnpm dev
```

Open <http://localhost:5173/overview>. Both services are needed. Before import the UI shows an empty-mailbox explanation; when the backend is unavailable it offers a connection retry, without fabricated fallback results.

If the default ports are occupied, run the backend on 8001 and the frontend on 5174:

```sh
# Backend terminal
ALLOWED_ORIGINS='["http://localhost:5174","http://127.0.0.1:5174"]' \
  uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8001 --no-access-log
```

```sh
# Frontend terminal
API_PROXY_TARGET=http://127.0.0.1:8001 pnpm dev --host 127.0.0.1 --port 5174
```

Open <http://127.0.0.1:5174/overview>. Keep this development mailbox bound to loopback; it is a single local workspace with no multi-user authentication.

## Try the real examples

Search by email ID, subject, sender, or body. Inbox pages contain 50 emails in dataset order. Summary cards always cover the full mailbox. Dataset emails do not have a separate received-at field; the UI displays actual analysis times instead.

- **email_004:** Two differences: consignee and notify party. Inspect the real TXT excerpts.
- **email_160:** The PDF SI yields seven fields; its actual gross weight is `23,702 KG`. Open the original PDF at the evidence page.
- **email_055:** XLSX SI and DOCX BL. Six fields match; the SI weight `243588` has no explicit unit, so weight remains unresolved. The BL's explicit KGS label supports normalization of `243,588`. No unit is guessed to force a match.
- **email_501:** An invoice supplied instead of the BL requires replacement.
- **email_512:** Actual image-only PDFs display **Visual extraction required**. No invented AI candidates are shown.
- **email_516:** SI weight remains missing; BL weight is not copied into it.

Use **Reanalyze** to run the same pipeline on the stored immutable sources. It saves a new run, marks it **On demand · Rules**, and refreshes the current result. Import-time runs are labeled **Precomputed · Rules**. A failed rerun keeps the last successful result visible with an explicit failure notice. Refreshes and backend restarts preserve saved results.

**Print report** opens an in-page report preview using the same report component and table styling as printing. **Print / Save PDF** invokes the browser print dialog where supported. The report includes source versions, hashes, raw/normalized values, evidence, unresolved requirements, and the absence of human approval. The in-app browser may not expose a system print dialog; use a normal browser to print or save a PDF.

The former hand-authored prototype and browser snapshots are no longer used. Human corrections, completion acknowledgment, uploaded replacements, and revision-delta review are later milestones; no fake controls are exposed for them.

## Local extraction

In `backend/.env`, set `APP_ENV=development` and `ENABLE_DEV_EXTRACTION=true`, then
restart the backend. Open <http://127.0.0.1:5173/extraction>:

- **Dataset inbox:** select `email_004` and click **Extract attachments** to process both listed files automatically. The default bundle is the sibling `sdoc-hackathon-bundle`; override with `DATASET_DIR` if needed.
- **Upload a document:** choose `backend/tests/fixtures/extraction/email_160_SI.pdf` to inspect seven fields, page evidence, and the original PDF.
- **Audit Trail:** open `/audit` from the sidebar for live backend steps, source evidence, selection decisions, review reasons, and failures. Extraction results include a direct link to their audit. Processing continues through navigation and refresh.
- **History:** reopen saved runs and download the full audit JSON. History survives backend restarts in `backend/.local/extraction-audit.sqlite3` (override with `DEV_AUDIT_DB`). New mailbox analysis runs also appear in this audit history.

The Inbox's **Analyze / Reanalyze** action keeps email classification and SI/BL
comparison in `app.documents.analysis`, but uses the same `extract_document(...)`
and bounded run service as uploads and dataset extraction. Its **View live audit**
link opens the recorded classification, extraction, source evidence, and comparison
steps. Non-comparison emails record classification and retain their originals without
pretending extraction or comparison ran.

New mailbox runs use pipeline version `mailbox-shared-2`. Existing results and
originals remain unchanged; **Reanalyze** creates a new result using the shared rules.
Older mailbox runs have no invented audit history. Port codes remain in normalized
values, formulas always require review, and uncertain company boundaries remain
unresolved. These can change findings compared with an older mailbox analysis.

The routes are unavailable in production or when the feature flag is off. Development
history is shared by callers of the local backend. Each rerun creates a new record.
Two runs may process simultaneously; further submissions receive a retryable busy
response. Run only one backend process per mailbox/audit database pair. Stop the API before running the import/analysis CLI against those same databases. Existing history migrates
automatically and appears as Legacy trace, with original results and files preserved.
See [the extraction setup guide](docs/EXTRACTION.md) for API requests, configuration,
review states, resource limits, and frontend integration examples.

The standalone CLI also remains available from `backend/`:

```sh
uv run --frozen python -m app.extraction tests/fixtures/extraction/email_160_SI.pdf --role SI
```

The command prints seven fields, original/canonical values, source evidence, and review issues as JSON. A successful command can still report missing or ambiguous values; inspect `needs_review`. See [the extraction guide](docs/EXTRACTION.md) for all formats, limits, tests, and the Python interface for backend integration.


## API and configuration

| Endpoint | Behavior |
|---|---|
| `GET /api/health` | Process liveness plus local extraction capability and upload limit |
| `GET /api/v1/samples` | `q`, `category`, `status`, `page`, `limit` (default 50, maximum 100); returns `items`, filtered `total`, and global `summary` |
| `GET /api/v1/samples/{id}` | Original email, current documents, latest attempt, last successful result, and run summaries |
| `GET /api/v1/samples/{id}/documents/{document_id}/content` | Original registered source, checked against its content hash |
| `POST /api/v1/dev/samples/{id}/analyze` | JSON `{"expected_revision":1}`; synchronous by default; `?wait=false` returns 202 with the saved mailbox detail and `latest_run.audit_run_id`; 409 for an active run or stale revision, 503 when busy |

Interactive API documentation is at `/docs`. Local mailbox routes are registered **only when `APP_ENV=development`**. Other environments retain health but do not expose this unauthenticated local store. The PRD's public upload/save/read deployment gate remains outstanding.

The backend loads `backend/.env`; process variables take precedence. `LOCAL_DATA_DIR` defaults to the backend's `.local` directory. Relative configured paths are resolved from the backend directory. `ALLOWED_ORIGINS` is a JSON array of permitted frontend origins; GET and JSON POST are supported. Reanalysis also rejects an unlisted browser Origin.

Vite proxies `/api` to `http://127.0.0.1:8000` by default. `API_PROXY_TARGET` changes the development proxy. Leave `VITE_API_BASE_URL` empty for same-origin requests, or set an API origin without `/api` for a separately hosted frontend. Restart Vite after environment changes. Never place provider keys in `VITE_` variables.

Supabase, Gemini, and demo-session secret settings remain optional, server-only, and unused. This milestone does not initialize provider clients or deploy services.

## Mailbox processing limits and interpretation

- Accept TXT, PDF, DOCX, XLSX; at most 10 attachments per email and 10 MB per file.
- PDFs: at most 20 pages; encrypted, malformed, empty, and no-text sources are distinguished.
- Office archives: at most 1,000 entries and 50 MiB expanded; XLSX at most 10 sheets, 5,000 rows, 100 columns, and 100,000 inspected cells. Extracted text is bounded to 1,000,000 characters per document.
- All entry points share two active runs with no waiting queue, a 15-second document worker deadline, and a 60-second run deadline. Shutdown terminates workers; restart marks unfinished runs interrupted/failed without retry. A stale mailbox lease also expires after 120 seconds on read.
- XLSX formulas are neither evaluated nor resolved from cached values. Formulas, missing units, conflicting totals, unknown roles, or ambiguous pairs stay unresolved.
- Explicit total gross weight takes precedence over individual weights. Normalization preserves company-name tokens and agency clauses; uncertain boundaries require review. Port names/codes retain their tokens without fuzzy or code/name equivalence. Comparison requires two present values with no pending confirmation.
- Rules are a bounded baseline, not measured accuracy claims for arbitrary shipping documents. Runtime results are independent of evaluation ground truth.

## Local checks

From `frontend/`:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
```

From `backend/`:

```sh
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest
```

Tests cover ingestion boundaries, source versions, evidence, four formats, classification ambiguity, missing data, failed/stale/concurrent runs, persistence, API isolation, pagination, and frontend failure/retry/report journeys. The organizer-data integration test uses the workspace dataset when present; otherwise set `DATASET_DIR=/absolute/path/to/data_v2`. It explicitly skips when that external input is absent; synthetic unit tests still run without it.

There is no GitHub Actions workflow. Build output, environment files, dependencies, caches, and local mailbox data are ignored. See [the PRD](docs/PRD.md) for the eventual release requirements and [UI notes](docs/UI.md) for current behavior. New code, comments, logs, documentation, and UI copy use English.
