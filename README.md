# DraftGuard

DraftGuard turns the organizer's shipping-document dataset into a local demo mailbox. It imports original email JSON and attachments, runs rule-first classification and seven-field SI / draft-BL comparison, uses server-side Gemini only for ambiguous classification, bounded readable-text fallback, or image-only PDFs, and saves machine results plus human review overlays in SQLite. Overview, Inbox, and the verification workspace use the backend API; no personal Gmail account is connected.

This is a **localhost-first development milestone**. Organizer samples are read only; create a working copy or a blank local task before analysis or review. Gemini paths are available only when both server-side settings are supplied. Local tasks support rule/text/visual source-backed correction, visual confirmation, externally supplied information with provenance, reviewer-controlled copy-only amendment drafts, exact-run completion acknowledgment, and reviewed current/historical reports. Cloud persistence, session ownership, and public deployment are intentionally deferred. `CHECK_COMPLETE` means the bounded seven-field check was acknowledged; it is not legal or cargo-release approval.

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

Environment files are optional; rule-only development and automated tests need no cloud credentials. Keep actual secrets out of the repository and browser variables. Tests inject fake semantic/vision providers and never call Gemini.

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

## Interactive demo mailbox

To start with both pending and precomputed emails, use a separate local store. Set `LOCAL_DATA_DIR=.local/demo-mailbox` in `backend/.env`, then run from `backend/`:

```sh
uv run --frozen python -m app.cli import-dataset \
  --source "/absolute/path/to/data_v2" --analyze --defer-first 20
```

On a fresh store, the first 20 emails in dataset order remain genuinely unclassified and unanalyzed; the other 500 are precomputed. This is an import policy, not a hardcoded result or per-ID classification. The option never deletes existing runs: after a user analyzes a pending email, repeated imports preserve that result. Restart the backend after changing stores. The previous `.local/mailbox.sqlite3` and objects remain intact; switch `LOCAL_DATA_DIR` back to `.local` to reopen them.

Choose a sample, select **Create working copy**, then run analysis in the task workspace. Alternatively, use the Inbox's primary **Create local task** action and enter subject, sender, and body before uploading SI/BL sources. Samples remain read only. Real filenames, formats, and sizes link to the existing preview. Only two attachments initially appear; expand to see more. Tasks without attachments can still be classified.

The request starts immediately. A scan animation represents overall processing, not measured stages or percentages. Successful manual runs have a minimum four-second presentation window: if the backend finishes early, the UI continues the captions with **Preparing your results…** and opens the result automatically. There is no skip button or save announcement during loading. Slow requests have no additional wait. Errors appear immediately; reanalysis preserves the prior result. Backend timestamps and processing time are unchanged. Reduced motion disables animation and the presentation hold. Refreshing a saved task shows results immediately without replaying the animation.

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

## Gemini configuration and local acceptance

Do not configure a key for automated development: the provider and review tests use an injected fake. For a real manual check, edit `backend/.env` on your machine and set both values explicitly:

```dotenv
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=your-explicit-model-id
GEMINI_TIMEOUT_SECONDS=30
GEMINI_TEXT_MAX_CHARS=100000
```

The frontend needs no provider variable. Restart the backend after every setting change:

```sh
cd backend
uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
```

To rebuild the full organizer mailbox first:

```sh
cd backend
uv run --frozen python -m app.cli import-dataset \
  --source "/absolute/path/to/data_v2"
```

Manual acceptance uses the organizer's original `email_512` SI and draft-BL PDFs; ground truth is never read at runtime.

1. First leave both Gemini settings empty, restart, create an `email_512` working copy, explicitly select its SI and draft-BL attachments as the current pair, and analyze it. Verify `AI_NOT_CONFIGURED`, no fabricated candidates, and a visible retry path.
2. Set the key and explicit model, restart, and reanalyze the same current revision. Audit Trail must show two separate PDF calls—one SI and one BL—with prompt/model/response/timing and available usage metadata, but no key or full document content.
3. Verify 14 pending candidates. Select every SI/BL cell, compare it with the embedded original page, then choose **Confirm candidate** or **Correct extraction** with the actual page.
4. Confirm a field remains **Needs review** until both sides are handled. After all 14 actions, expect 7/7 checked and either **Ready for review** or **Discrepancies found**.
5. If all seven findings match, use the eligibility card and acknowledgment dialog to complete the exact current run. Verify the state becomes `CHECK_COMPLETE`; a mismatch, pending candidate, or supplied-information event blocks completion.
6. Refresh the browser and restart the backend. Verify the machine result, reviewed comparison, completion, and append-only review activity all return; open an older run and verify it is read only.
7. Open the report and verify its designation, exact source versions/hashes, reviewed values, full Confirm/Correct/Supply ledger, and completion acknowledgment or blockers.
8. On an actionable current run, open **Draft amendment email**. Verify Gemini changes only subject/opening/closing, the evidence-backed issue list is locked, edited wording survives refresh, and **Copy email** produces plain text. Force a provider failure and deliberately choose **Generate standard draft**; nothing should be sent.
9. Inspect 1440, 1024, 768, and 375 px layouts, 200% zoom, keyboard focus, 44 px actions, landscape, print pagination, and reduced-motion behavior.

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
- **email_160:** The PDF SI yields seven fields; its actual gross weight is `23,702 KG`. Open the original PDF in the in-page viewer at the evidence page.
- **email_055:** XLSX SI and DOCX BL. Six fields match; the SI weight `243588` has no explicit unit, so weight remains unresolved. The BL's explicit KGS label supports normalization of `243,588`. No unit is guessed to force a match.
- **email_501:** An invoice supplied instead of the BL requires replacement.
- **email_512:** The real SI and draft-BL attachments are image-only PDFs. Without a configured key, analysis ends with `AI_NOT_CONFIGURED` and no candidates. With Gemini configured, use a local working copy to review 14 source-specific visual candidates against the embedded PDF pages.
- **email_516:** SI weight remains missing; BL weight is not copied into it.

Use **Reanalyze** to run the same pipeline on the stored immutable sources. It saves a new run, marks it **On demand · Rules**, and refreshes the current result. Import-time runs are labeled **Precomputed · Rules**. A failed rerun keeps the last successful result visible with an explicit failure notice. Refreshes and backend restarts preserve saved results.

For an unfinished current comparison with discrepancies or review requirements, **Draft amendment email** creates a local, copy-only request. DraftGuard deterministically owns the issue list; Gemini sees only the original subject plus issue counts/types and may polish only the subject, opening, and closing. The reviewer can edit and save that wording, copy the complete plain-text email, retry a failed Gemini call, or explicitly choose a standard template. Samples, historical/completed/clean runs, and stale revisions are rejected. A new source revision or changed current run invalidates the old draft. DraftGuard never opens a mail client or sends the message.

**Print report** opens an in-page reviewed-report preview using the same component and table styling as printing. **Print / Save PDF** invokes the browser print dialog where supported. The report identifies machine-only, human-reviewed, or completed output and includes exact source versions/hashes, machine and reviewed values, evidence, the complete review ledger, revision changes, and completion acknowledgment or blockers. The in-app browser may not expose a system print dialog; use a normal browser to print or save a PDF.

The former hand-authored prototype and browser snapshots are no longer used. Local tasks support source replacement, revision comparison, append-only correction for rule/text/visual extraction, visual-candidate confirmation, and exact-run completion as described below.

## Local task revisions

Open a sample workspace and create a local task copy before changing sources, or use **Create local task** for a blank revision-one task. The sample's files and results remain intact. Copies retain email context and immutable source bytes, but their first analysis runs the real pipeline rather than copying predictions. Local tasks are available from Inbox and survive refreshes and backend restarts.

In a local task, add or replace SI/BL files, or explicitly select the pair when attachments are ambiguous. A source change advances the task revision and automatically requests a full seven-field analysis. If analysis submission fails, the source revision remains saved and can be retried. Selecting a role does not override content-based document validation. Development uploads use the configured smaller upload limit, not the PRD's eventual cloud upload allowance.

Revision changes compare against the saved prior-version baseline: resolved, persisting, new confirmed discrepancies, and fields that became uncertain. An uncertain field is never counted as resolved. Reanalyzing the same revision retains its comparison baseline. Results from older revisions stay historical and cannot replace the current result. The history selector opens the exact run's files, evidence, and report; a new revision without a successful result is not presented as a completed check.

Try the primary revision scenario with `email_004` and the explicitly team-created fixtures under `backend/tests/fixtures/revisions/`: v2 fixes the two names but changes gross weight to `130,058 KG`; v3 restores `131,058 KG`. Process these through normal task upload. Visual candidates can be confirmed or corrected against a PDF page; rule and Gemini-text values can be corrected only against a selected source unit containing the value. Machine output remains immutable and the reviewed result is derived from saved events. A current run with seven matches, no pending review, and no supplied-information blocker can be acknowledged as `CHECK_COMPLETE`. Reanalysis or a source replacement creates a new current run that requires its own acknowledgment.

For a missing, ambiguous, or unreadable value on the current SI/BL side, **Supply information** records a value, source name, checkable reference, and optional note for handover. It does not edit the machine extraction, increase coverage, resolve `NEEDS_REVIEW`, or permit completion. Replace the formal source and reanalyze to resolve the blocker. HTTPS references are rendered as links; other references remain text and are not fetched or verified.

This is a single local development workspace, not session-isolated cloud storage. Keep it bound to loopback. Production task routes, no-login session ownership, and the public deployment gate remain separate work.

## Local extraction

In `backend/.env`, set `APP_ENV=development` and `ENABLE_DEV_EXTRACTION=true`, then
restart the backend. Open <http://127.0.0.1:5173/inbox>:

- **Inbox:** import the dataset as described above, select `email_004`, create a working copy, and run analysis to classify the email, extract its attachments, and compare SI/BL fields.
- **Upload document:** use the action in Inbox, then choose `backend/tests/fixtures/extraction/email_160_SI.pdf` to inspect seven fields, page evidence, and the original PDF.
- **Audit Trail:** open `/audit` from the sidebar for live backend steps, source evidence, selection decisions, review reasons, and failures. Extraction results include a direct link to their audit. Processing continues through navigation and refresh.
- **Saved history:** reopen runs through Audit Trail, choose **View extraction results**, or download the full audit JSON. History survives backend restarts in `backend/.local/extraction-audit.sqlite3` (override with `DEV_AUDIT_DB`). New mailbox analysis runs also appear in this audit history.

The separate Extraction sidebar entry has been removed. Old `/extraction` bookmarks redirect to Inbox; upload/history bookmarks redirect to the corresponding upload or audit screen. Existing `/extraction/runs/:runId` result links still work.

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

Attachment buttons and **Open original** now open an in-page preview: original TXT text, PDF.js-rendered PDF pages, or labeled extracted DOCX/XLSX content. PDF viewing does not depend on a browser PDF plugin. PDF pages automatically fit the preview width. Use **Download original** for the registered file. Missing/unreadable content shows an explicit message, not a blank tab.

## API and configuration

| Endpoint                                                   | Behavior                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                          | Process liveness plus local extraction capability and upload limit                                                            |
| `GET /api/v1/samples`                                      | `q`, `category`, `status`, `page`, `limit` (default 50, maximum 100); returns `items`, filtered `total`, and global `summary` |
| `GET /api/v1/samples/{id}`                                 | Original email, current documents, latest attempt, last successful result, and run summaries                                  |
| `GET /api/v1/samples/{id}/documents/{document_id}/content` | Original registered source, checked against its content hash                                                                  |
| `GET /api/v1/records/{id}`                                 | Unified sample/task read route; responses include explicit `record_kind`                                                      |
| `GET /api/v1/records/{id}/documents/{document_id}/content` | Unified immutable source route used without inferring kind from an ID prefix                                                  |
| `POST /api/v1/dev/samples/{id}/analyze`                    | Always returns 409 `sample_read_only`; create a working copy first                                                            |

Local task endpoints (development only):

| Endpoint                                                     | Behavior                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/dev/tasks`                                     | `{ "sample_id": "email_004" }`; creates a working copy with no copied analysis                                                                                                         |
| `POST /api/v1/dev/tasks/custom`                              | Required `subject` (1–500), `sender` (1–320), and `body` (1–50,000); creates an empty revision-one task                                                                                |
| `GET /api/v1/dev/tasks`                                      | Paginated local task list (`page`, `limit`)                                                                                                                                            |
| `GET /api/v1/dev/tasks/{id}`                                 | Current task, active attachments, pair IDs, runs, and saved results                                                                                                                    |
| `POST /api/v1/dev/tasks/{id}/documents`                      | Multipart `file`, `role` (`si`/`bl`), `expected_revision`; saves an immutable source and advances revision                                                                             |
| `POST /api/v1/dev/tasks/{id}/pair`                           | JSON `si_id`, `bl_id` (nullable), `expected_revision`; explicitly selects current attachments                                                                                          |
| `POST /api/v1/dev/tasks/{id}/analyze`                        | JSON `expected_revision`; `?wait=false` uses existing bounded background execution                                                                                                     |
| `POST /api/v1/dev/tasks/{id}/reviews`                        | Appends `CONFIRM_CANDIDATE`, `CORRECT_EXTRACTION`, or `SUPPLY_INFORMATION` for the current revision/run/document/field and returns the updated task; stale/completed writes return 409 |
| `POST /api/v1/dev/tasks/{id}/complete`                       | Acknowledges the exact eligible current run and seven-field scope; returns structured blockers for ineligible runs and is idempotent after success                                     |
| `POST /api/v1/dev/tasks/{id}/amendment-draft`                | Generates Gemini-polished or standard wording for the exact current actionable run; Gemini never receives field values or source excerpts                                             |
| `PUT /api/v1/dev/tasks/{id}/amendment-draft/{draft_id}`      | Saves recipient, subject, opening, and closing only; locked issues are rebuilt and stale revision/run/facts are rejected                                                               |
| `GET /api/v1/dev/tasks/{id}/runs/{run_id}`                   | Read-only snapshot with exact run sources, results, and historical designation                                                                                                         |
| `GET /api/v1/dev/tasks/{id}/documents/{document_id}/content` | Registered task source; `?download=true` downloads its immutable bytes                                                                                                                 |

The UI requests analysis after a successful source/pair write. A write response alone does not claim an analysis succeeded. Stale writes return 409. `development_tasks` in health advertises availability independently of the optional standalone extraction UI.

## Frozen local evaluation

From `backend/`, run:

```sh
uv run --frozen python scripts/evaluate_local.py
```

The tracked manifest covers all five categories, TXT/DOCX/XLSX/PDF, all seven fields, and a case-sensitive quote mismatch. Gitignored JSON, CSV, and Markdown artifacts are written under `.local/evaluation/`. They report the confusion matrix, per-class precision/recall/F1, extraction accuracy, value-state breakdown, evidence quote validity, and AI-call telemetry. The deterministic frozen run does not call Gemini and reports cost as unavailable. After a real smoke test, pass an ignored JSON array of provider metadata with `--provider-records .local/evaluation/provider-smoke.json` to include actual call count by operation—including `amendment_email`—latency, response/model IDs, and token usage without putting those records into Git. Evaluation ground truth is never loaded by runtime routes.

After the final demo scenarios pass, stop the backend and create a content-hashed store archive:

```sh
uv run --frozen python scripts/demo_store.py create \
  --mailbox-dir .local --audit-db .local/extraction-audit.sqlite3 \
  --archive .local/demo-freeze.zip
uv run --frozen python scripts/demo_store.py verify --archive .local/demo-freeze.zip
```

Restoration always targets a new directory and refuses to overwrite existing data:

```sh
uv run --frozen python scripts/demo_store.py restore \
  --archive .local/demo-freeze.zip --target .local/demo-restored
```

Point `LOCAL_DATA_DIR` at `.local/demo-restored/mailbox` and `DEV_AUDIT_DB` at `.local/demo-restored/audit.sqlite3`. Restoring again requires another empty target, so the original demo store cannot be destroyed accidentally.

Interactive API documentation is at `/docs`. Local mailbox routes are registered **only when `APP_ENV=development`**. Other environments retain health but do not expose this unauthenticated local store. The PRD's public upload/save/read deployment gate remains outstanding.

The backend loads `backend/.env`; process variables take precedence. `LOCAL_DATA_DIR` defaults to the backend's `.local` directory. Relative configured paths are resolved from the backend directory. `ALLOWED_ORIGINS` is a JSON array of permitted frontend origins; GET and JSON POST are supported. Reanalysis also rejects an unlisted browser Origin.

Vite proxies `/api` to `http://127.0.0.1:8000` by default. `API_PROXY_TARGET` changes the development proxy. Leave `VITE_API_BASE_URL` empty for same-origin requests, or set an API origin without `/api` for a separately hosted frontend. Restart Vite after environment changes. Never place provider keys in `VITE_` variables.

Gemini settings are optional and server-only. Set both `GEMINI_API_KEY` and an explicit `GEMINI_MODEL`; there is no silent model default or upgrade. `GEMINI_TIMEOUT_SECONDS` defaults to 30, `GEMINI_TEXT_MAX_CHARS` defaults to 100,000, and the SDK is configured for one attempt. Missing configuration, input-limit, timeout, quota, access, provider, quote-verification, and schema failures are saved under stable `AI_*` codes. Supabase and demo-session settings remain unused, and no service is deployed.

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

The analysis indicator uses one changing caption beneath its spinner instead of a static workflow explanation. Saved-run captions reflect actual classification, parsing, and comparison coverage; the four-second presentation does not change backend execution or timestamps.
