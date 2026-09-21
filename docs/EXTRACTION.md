# Local document extraction

This milestone implements rule-first extraction from one TXT, PDF, DOCX, or XLSX
document. It returns seven shipment fields with original values, canonical values,
source evidence, and review issues. A development API connects that extractor to
Inbox uploads, dataset emails, and SQLite audit history. Valid PDFs with no usable
text can use the server-side Gemini adapter for visual candidates; those candidates
remain unverified until a human confirms or corrects them. There is no OCR/text
fallback, paired-document backfill, live mailbox connection, or automatic completion.

## Try it in the browser (no Docker needed)

1. From `backend/`, run `uv sync --frozen`. Create `backend/.env` from `.env.example`
   if it does not exist, then set:

   ```dotenv
   APP_ENV=development
   ENABLE_DEV_EXTRACTION=true
   ```

2. Start the backend from `backend/`:

   ```sh
   uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
   ```

3. In another terminal, from `frontend/`:

   ```sh
   pnpm install --frozen-lockfile
   pnpm dev --host 127.0.0.1
   ```

4. Open [Inbox](http://127.0.0.1:5173/inbox). **Upload document** and the **Audit Trail**
   sidebar link appear when the backend health response enables
   `capabilities.development_extraction`. No cloud credentials or Docker services are needed.

**Dataset emails:** import the dataset using the [README command](../README.md)
before starting the backend. Search `email_004` in Inbox, open the email, and click
**Analyze email**. This classifies the email, extracts both attachments, and compares
the SI/BL fields. Merely opening an email never processes it.

**Upload:** click **Upload document** in Inbox, select `backend/tests/fixtures/extraction/email_160_SI.pdf`, optionally
choose SI, and click **Extract document**. The result includes all seven fields,
page evidence, and an explicit total gross weight of `23702` kg. Open **View original
PDF** or download the original. Browser support determines whether PDF viewing is inline.

**History:** open **Audit Trail**, select a saved run, and choose **View extraction
results**, including after refreshing or restarting the backend. Click a field's evidence to select its retained source unit. Use the
attachment buttons to switch documents. Select **View live audit** while processing
or **View audit trail** afterward to open the separate Audit Trail page.
**Download audit JSON** exports the complete saved run; originals download separately.

**Audit Trail:** open the main sidebar link or `/audit`. Search by email ID, subject,
filename, or run ID; filter by source, outcome, or review requirement. Open a run to
inspect its ordered timeline. Filter by attachment, stage, outcome, or field, expand
an event, and click a page/cell/line reference to see the retained source text.
Timestamps include milliseconds in your local timezone; event JSON retains UTC.
Selections and filters are saved in the URL.

The frontend starts runs asynchronously and opens results immediately. Active
results and events refresh every second while visible; the audit list refreshes
every five seconds. Navigating away or refreshing does not cancel a saved run.
Completed runs stop polling. Connection failures retain the last displayed snapshot.
The separate Extraction page has been removed from navigation. Old `/extraction`
bookmarks redirect to Inbox; old upload/history bookmarks redirect to the upload or
audit screen. Saved `/extraction/runs/:runId` links still open their original results.

Try `email_055` for XLSX/DOCX evidence and the SI's `MISSING_WEIGHT_UNIT` issue;
try `email_516` for a missing SI weight which remains missing despite the BL value.
`email_512` includes separate image-only SI and BL PDFs. With no key it ends in
`AI_NOT_CONFIGURED` without candidates. With Gemini configured, each PDF is sent in
its own request and returns seven source-specific candidates for page-level review.
Inbox classifies emails without attachments and reports missing documents when a comparison was requested.
The direct dataset extraction API still supports explicit **No attachments** results.

Extraction finished means the processing completed. **Needs review** means one or
more values remain unresolved; **Finished with errors** means at least one attachment
failed or timed out. These are extraction states, not shipment approval or match states.
Rerunning creates another record. Imported mailbox analyses now share this audit
history and extractor, while retaining their mailbox comparison results.

## Inbox analysis and the shared extractor

1. Import the organizer mailbox using the command in [README](../README.md), before
   starting the API. Stop the API before running the CLI against its databases.
2. Open **Inbox**, select an email, and choose **Analyze email** or **Reanalyze**.
3. Open **View live audit** during processing or **View audit trail** afterward.
   Audit history can be filtered to **Mailbox analysis**. Each analysis-history row
   links to its own audit, and an audit links back to the mailbox results.
4. Expand a comparison event to see both original/normalized values and follow its
   SI or BL evidence. The original mailbox document IDs are retained throughout.

The frontend uses a saved background run. Synchronous API calls remain supported:

```sh
curl -X POST "http://127.0.0.1:8000/api/v1/dev/samples/email_004/analyze?wait=false" \
  -H "Content-Type: application/json" -d '{"expected_revision":1}'
```

The 202 response contains mailbox detail, including `latest_run.audit_run_id`.
Poll `/api/v1/samples/email_004` for results or
`/api/v1/dev/runs/{audit_run_id}/events` for the live trace. Omitting `wait=false`
waits for completion and returns 200. Duplicate/stale submissions return 409;
exhausted shared capacity returns retryable 503.

Classification rules and the seven-field comparison workflow are retained. Only
emails classified for BL comparison extract/compare their attachments; other
categories record classification and explicit skipped steps. Gemini is considered
only for a valid PDF whose parser returns `NO_USABLE_TEXT`; malformed, encrypted,
oversized, or readable documents are never sent to the vision provider. Missing
values and units remain unresolved.

New analyses use `mailbox-shared-2` and the exact shared document contract. Earlier
mailbox results remain readable with `audit_run_id: null` and no invented events;
reanalysis creates a new record. CLI `--analyze` also upgrades outdated pipeline
versions by creating new runs. Company boundaries, formula handling, and port text
now follow the shared rules, so older and newly analyzed findings can differ.

Mailbox result updates and the audit's terminal event/status use one attached
SQLite transaction, so ordinary save failures roll back success in both stores.
The last successful mailbox result survives a failed run. Startup recovers
unfinished mailbox attempts without rerunning them. This local development setup
is not a crash-proof distributed or production ledger.

## Development configuration and storage

| Setting | Default / behavior |
| --- | --- |
| `APP_ENV` | `development`; any other value disables these routes |
| `ENABLE_DEV_EXTRACTION` | `false`; must explicitly be `true` |
| `DATASET_DIR` | Sibling `sdoc-hackathon-bundle` directory, containing `inbox/` and `attachments/` |
| `DEV_AUDIT_DB` | `backend/.local/extraction-audit.sqlite3` |
| `ALLOWED_ORIGINS` | localhost and 127.0.0.1 on port 5173; GET/POST allowed when enabled |
| `DEV_UPLOAD_LIMIT` | 3 MiB per manual file, counted during multipart reception |
| `DEV_REQUEST_LIMIT` | 4 MiB per development POST request, counted while receiving |
| `DEV_DOCUMENT_TIMEOUT` | 15 seconds per extraction worker |
| `DEV_RUN_TIMEOUT` | 60 seconds for processing an email run |
| `GEMINI_API_KEY` | Empty; server-side only, required with `GEMINI_MODEL` for scan candidates |
| `GEMINI_MODEL` | Empty; must be an explicit model ID, with no code default or automatic upgrade |
| `GEMINI_TIMEOUT_SECONDS` | 30 seconds per provider call; capped below the local run deadline |

Use absolute paths for path overrides, for example
`DATASET_DIR="D:/Ash Stuff/Coding/2026 Averis Monash/sdoc-hackathon-bundle"`.
Only inbox records and their listed attachment references are read. Dataset files
are limited to 10 MiB each, with at most 10 attachments per email. Path traversal
outside the dataset attachment folder is rejected. Answer keys are never read.

If port 5173 is occupied, use `pnpm dev --host 127.0.0.1 --port 5174` and open that
port instead. The Vite `/api` proxy still reaches port 8000. For a different backend
port, set `$env:API_PROXY_TARGET='http://127.0.0.1:8001'` in PowerShell before starting
Vite. For direct cross-origin API calls, add the frontend origin to `ALLOWED_ORIGINS`.

SQLite stores run metadata, the email snapshot, exact original bytes and SHA-256,
the unchanged extraction result (including source units), and ordered timestamped
events in an append-only table. Each event is committed as it arrives from the
worker; parsed source units are saved before events reference them. The final
results, completion event, and terminal status commit together. Finished runs and
events are immutable through this service. History belongs to the
local backend and is shared by its callers; it is not authenticated or tamper-proof
production storage. Keep the documented server bound to localhost and run only one
backend process against a given audit database. On startup, unfinished runs become
**Interrupted**; they are never restarted automatically. Completed attachment results
already saved in an interrupted run remain available. The database, including SQLite
sidecar files under `.local/`, is ignored by Git.

Startup migrates existing history automatically and idempotently. Earlier run
payloads and original bytes stay unchanged. Their real recorded events are imported
and labeled **Legacy trace**; missing historical lifecycle events are not invented.
The audit is operational development history, not an authenticated production ledger.

At most two runs may process concurrently, with no waiting queue. Additional
submissions receive retryable HTTP 503 `EXTRACTION_BUSY`. Mailbox analysis, uploads, and dataset extraction, including synchronous and
asynchronous callers, share this limit. The application owns the background threads;
no Redis, Celery, external queue, or additional service is required.

Each document runs in a separate worker process. A timeout kills that worker,
retains its emitted events and any earlier completed attachments, and records an
error. A history write failure returns `AUDIT_SAVE_FAILED` instead of claiming the
run was saved. After asynchronous acceptance, a recording failure stops the run;
reads surface that error until its failure can be persisted or restart recovery
marks it interrupted. Graceful shutdown terminates active workers and records
interruption where storage is available. Document content stays in results/audit records, not application logs.
The startup command disables access logs so inbox search text is not logged in URLs.

## Development API and integration

The extraction and audit routes below return 404 unless both enablement settings
allow them. Mailbox routes require `APP_ENV=development`; their analyses still record
audits when the extraction UI flag is off. Enable the flag to inspect those audits.
Interactive request forms are at [API docs](http://127.0.0.1:8000/docs).

| Method and path | Response |
| --- | --- |
| `POST /api/v1/dev/extract` | Saved run for multipart `file` and optional `expected_role=SI\|BL` |
| `GET /api/v1/dev/emails?q=004&has_attachments=true&limit=20&offset=0` | Filtered, paginated inbox; `has_attachments=false` includes all emails |
| `GET /api/v1/dev/emails/{email_id}` | Email body and declared attachment paths |
| `POST /api/v1/dev/emails/{email_id}/extract` | One saved run covering all attachments independently |
| `GET /api/v1/dev/runs?limit=20&offset=0` | Newest runs first; optional `q`, `status`, `source_type`, and `needs_review` filters |
| `GET /api/v1/dev/runs/{run_id}/events?after_sequence=0&limit=100` | Ordered event page, continuation cursor, terminal status, and live/legacy trace mode |
| `GET /api/v1/dev/runs/{run_id}` | Full saved run, documents, extraction results, and events; `?download=true` downloads the audit JSON |
| `GET /api/v1/dev/runs/{run_id}/documents/{document_id}/original` | Exact original; `?disposition=inline` allows validated PDFs inline |
| `POST /api/v1/dev/tasks/{task_id}/reviews` | Append a current-run visual `CONFIRM_CANDIDATE` or `CORRECT_EXTRACTION` event and return full task detail |

Both POST extraction endpoints accept `?wait=false`: HTTP 202 returns the saved
initial run (including `run_id`) once processing has been scheduled. Uploaded bytes
are persisted before acceptance. Omit `wait` to retain synchronous HTTP 200 behavior.
The standalone extractor and final extraction result contract are unchanged.

The events endpoint returns `items`, `next_after_sequence`, `has_more`,
`processing_status`, and `trace_mode`. Request the next page with the returned cursor;
read all remaining pages before stopping when the run becomes terminal. `limit`
defaults to 100 and accepts 1–500; the cursor must be nonnegative. Sequences are
ordered across the entire run, not restarted per attachment. Events include run,
request, and document identities, timestamp, stage, outcome, message, structured
details, and measured duration where available. The `events` array on new full run
responses contains the same complete timeline; document event arrays remain available.

Request errors use `{ "error": { "code", "message", "retryable", "request_id" } }`
and an appropriate non-2xx status. Saved attempts return HTTP 200 even when an
attachment fails; inspect `processing_status`, `needs_review`, document `error`,
and `result.issues`. Each document has an immutable server-generated ID, hash,
`last_completed_stage`, and measured timing. Run results include `pipeline_version`,
source type, email snapshot where relevant, timestamps, and ordered document events.

From `backend/`, using PowerShell's native curl executable:

```powershell
curl.exe -F "file=@tests/fixtures/extraction/email_160_SI.pdf" -F "expected_role=SI" http://127.0.0.1:8000/api/v1/dev/extract
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/v1/dev/emails/email_004/extract
Invoke-RestMethod http://127.0.0.1:8000/api/v1/dev/runs
```

To start a background dataset run and retrieve its first event page:

```powershell
$run = Invoke-RestMethod -Method Post 'http://127.0.0.1:8000/api/v1/dev/emails/email_004/extract?wait=false'
Invoke-RestMethod "http://127.0.0.1:8000/api/v1/dev/runs/$($run.run_id)/events?after_sequence=0&limit=100"
```

A frontend can call the Vite proxy directly. Let the browser set the multipart boundary:

```typescript
const form = new FormData()
form.append('file', file)
form.append('expected_role', 'SI') // Optional; content still determines the role.
const response = await fetch('/api/v1/dev/extract?wait=false', { method: 'POST', body: form })
const payload = await response.json()
if (!response.ok) throw new Error(payload.error.message)
// HTTP 202: save payload.run_id and poll the run and events endpoints.
// A result may still be null until its attachment finishes processing.
```

`app.dev_extraction.service.RunService.run(...)` is the shared processing entry
point. Both adapters pass `DocumentInput(filename, read, expected_role, max_file_bytes)`
objects plus `source_type`, `source_label`, an optional email snapshot, and request ID.
A future email importer can supply attachment bytes through these readers and reuse
the worker/persistence pipeline. Pass `wait=False` for background processing, or
use its default `wait=True` from a worker thread for synchronous integration. `extract_document(...)` below remains independently importable and
does not write history. Its optional `observer` callback receives real processing
events; the API worker uses that callback to record the audit.

### Visual review overlay

The saved run's `result` is immutable machine output. Public task runs also expose
`reviewed_result`, `review_actions`, and `review_progress`. Review events are
append-only and bound to `task_id + revision + run_id + document_id + field`.
`CONFIRM_CANDIDATE` uses the server-side machine value and candidate page;
`CORRECT_EXTRACTION` requires a nonempty visible value and a real page in the same
PDF. Old revisions, historical runs, non-current documents, and baseline samples
cannot be written.

```json
{
  "expected_revision": 1,
  "run_id": "run-id",
  "document_id": "document-id",
  "field": "shipper",
  "action": "CORRECT_EXTRACTION",
  "raw_value": "Visible value from the source",
  "evidence": { "page": 1 }
}
```

One reviewed side does not establish a comparison. Both SI and BL must be present
and reviewed before the deterministic rules produce `MATCH` or `MISMATCH` and add
to coverage. A missing candidate cannot be confirmed as missing, but it can be
corrected when the reviewer sees a value. Later actions change the displayed overlay
without deleting earlier events. All visual candidates can lead to `READY` or
`DISCREPANCIES_FOUND`, never `CHECK_COMPLETE`.

## Setup and local command

Use the repository's Python 3.12 and uv setup. From `DraftGuard/backend`:

```sh
uv sync --frozen
uv run --frozen python -m app.extraction tests/fixtures/extraction/email_160_SI.pdf --role SI
uv run --frozen python -m app.extraction tests/fixtures/extraction/email_055_SI.xlsx --role SI --document-id local-si-v2
```

The command accepts a local file, optional `--role SI|BL`, and optional
`--document-id`. Without an ID it generates a `local-<UUID>` identifier for that
invocation. Real integrations must supply the immutable document-version ID from
their own storage layer. No provider credentials are needed.

JSON goes to stdout; library diagnostics can go to stderr. Exit code 0 means a
structured result was obtained, **not** that all values are usable. Always inspect
`parsing_status`, `needs_review`, and `issues`. Rejected files, parsing failures,
unreadable file paths, and invalid arguments exit with code 2. File-read and size
errors discovered before extraction have an `error` object rather than a document
result. Oversized files are not read in full or assigned an incomplete content hash.

## Python interface for Person B

```python
from app.extraction import ExtractionLimits, extract_document

result = extract_document(
    content=file_bytes,
    filename="shipping-instruction.pdf",
    document_id="immutable-document-version-id",
    expected_role="SI",  # Optional; never overrides content-based role detection.
    limits=ExtractionLimits(),  # Optional configurable limits.
)
payload = result.model_dump(mode="json")
```

The function uses no HTTP, database, filesystem, paired document, or external API.
Document defects return structured results. Invalid caller arguments (such as an
empty document ID or an invalid expected role) raise `ValueError`; non-byte content
raises `TypeError`. Parser errors do not include source bodies or local paths in
their public messages.

`DocumentExtraction` and the field models are Pydantic contracts. A result includes:

- Document ID, basename, SHA-256, validated format, detected/expected role, and
  pipeline version `rules-1`.
- Parsing status: `READABLE`, `NO_USABLE_TEXT`, `FAILED`, or `REJECTED`. `READABLE`
  describes parsing, not successful extraction of every field.
- Original `source_units`, seven `fields` in PRD order, and actionable `issues`.
- `needs_review`, which remains true for an unknown/mismatched document role or any
  missing, unreadable, or ambiguous field.

Each field follows PRD section 8.2: `field`, `raw_value`, `normalized_value`,
`value_state`, `method`, `requires_human_confirmation`, and `evidence`. Numeric
canonical values are strings, never binary floating-point results. Rule-readable
documents use `method="rule"`. Visual candidates use `method="gemini_vision"`,
`requires_human_confirmation=true`, and
`verification_source="ai_visual_candidate"`. A human correction is normalized by
the same deterministic rules and becomes `method="human"`; it does not mutate the
machine result.

An issue includes a stable `code`, message, next action, optional field, and
challenge reason. Missing labels mean "not located by these rules", not proof
that the business information does not exist anywhere in the original document.
There is no task completion or match status in an extraction response.

## Source evidence

Every evidence object identifies its document and source `unit_id` and retains its
locator. `verification_source="source_text"` with `verified=true` means an excerpt
was checked against the retained text unit. `ai_visual_candidate` is an unverified
model excerpt anchored to a real page; it is never presented as PDF text-layer
evidence. `human_visual` records the page selected for a correction. None of these
states is a completion acknowledgment.

All numeric locations start at 1:

| Format | Unit and locator |
|---|---|
| TXT | Original decoded line, including indentation; `line` |
| PDF | Extracted page text; `page` |
| DOCX | Body paragraph (`paragraph`) or table cell (`table`, `row`, `column`) |
| XLSX | Nonempty cell (`sheet`, `cell`, `row`, `column`); formulas are marked |

Word tables are numbered in traversal order, including nested tables. Merged
Word cells are emitted once at their first logical coordinate. For Word/Excel
label/value pairs, evidence includes both cells, including the label that states
a weight unit. Full source blocks remain available even when only the company
identity is used as the canonical value. Multiple agreeing occurrences keep all
their evidence; conflicting occurrences preserve their original candidates and
remain ambiguous.

## Supported rules and limitations

- Labels are case-insensitive and support the explicit aliases in `rules.py`,
  including POL, POD, Notify, To the Order of, and bilingual label decorations.
  Inline colon-separated values, labels split over two lines, values beneath
  labels, and immediately adjacent Word/Excel cells are supported. A blank
  neighboring cell is never skipped to borrow a value from a later column.
- SI/BL roles come from explicit document headings. Shipping Instruction, BL
  Instruction, and Bill of Lading Instruction identify an SI. Invoice, packing
  list, and certificate headings are not accepted as an SI or BL. Filename IDs
  and expected roles never determine an extracted value or detected role.
- Company values preserve legal-name tokens and explicit agency clauses.
  Clearly delimited address continuations are excluded only from the canonical
  identity, with the raw block/evidence preserved. Unclear continuations require
  review. This is bounded layout handling, not general entity recognition.
- String canonicalization collapses whitespace and changes case to uppercase.
  Port names/codes retain their punctuation and tokens; no fuzzy or port-code
  equivalence mapping is implemented.
- Container quantities accept explicit integer counts under container-only labels
  and expressions such as `6 x 40'HC`. An undifferentiated quantity under
  "Containers or Packages", container IDs, and package counts require review.
- Weight values require explicit supported units in the value or its associated
  label: kg/kgs/kilograms, g/grams, or t/mt/mts/tonnes/metric tons. Decimal
  arithmetic converts grams and metric tonnes to kg without rounding. Plain
  "tons", pounds, missing units, and conflicting units are not inferred.
- Numbers use a documented English convention: decimal point and optional
  correctly grouped thousands commas (`243,588`, `1,234.50`). Decimal commas,
  mixed/invalid grouping, negative values, and scientific notation require review.
  Zero is a value, not a missing placeholder.
- Explicit total gross weight takes precedence over individual-container weights.
  Conflicting totals remain ambiguous. A container-table weight alone does not
  establish a shipment total.
- Blank values and N/A, TBA, TBD, NONE, NULL, NOT AVAILABLE, NOT PROVIDED, or
  underscore/dash placeholders remain missing. Original placeholders are retained.
- Workbook formulas are not evaluated and their cached values are not trusted.
  External-link loading is disabled. Formula candidates require a literal,
  authoritative replacement source.
- PDF extraction reads its text layer first. Only a valid PDF with
  `NO_USABLE_TEXT` may enter Gemini vision. SI and BL bytes are sent separately with
  strict seven-field/role/page schema validation and no SDK retry. A candidate does
  not affect comparison coverage until reviewed. No claim is made that an empty
  text layer proves a scan.
- Word extraction covers body paragraphs/tables, not headers, footers, floating
  text boxes, or tracked-change content. Arbitrary complex layouts may require
  review or a clearer source.

The real `email_055_SI.xlsx` supplies `243588` without a weight unit. Its result
retains the number, has no canonical kg value, and reports `MISSING_WEIGHT_UNIT`.
The paired Word fixture states KGS in its label, so `243,588` becomes `243588` kg.
The extractor never uses the paired file to resolve the missing SI unit.

## Bounds and integration responsibilities

`ExtractionLimits` defaults to 10 MiB per input, 20 PDF pages, 50 MiB total expanded
Office content, 1,000 archive entries, 10 sheets, 5,000 rows, 100 columns, and
100,000 inspected workbook cells. Workbook bounds check declared dimensions and
actual XML coordinates, including misleading dimension metadata. Additional
bounds are 20,000 source units, 1,000,000 extracted characters, and 10 MiB decoded
content per PDF page. Office XML is checked with `defusedxml` before parsing.

These limits reduce resource exposure. The development API adds reception limits,
worker timeouts, immutable document IDs, and local persistence. The standalone
library itself is not a process sandbox. A future public service still needs
ownership, access control, production storage, and review/completion policy. A
local extraction result alone does not pass the PRD deployment gate.

## Validation

From `DraftGuard/backend`:

```sh
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest
```

Tests include organizer fixtures for all four formats and actual image-only PDFs,
plus an injected fake vision provider and explicitly team-created edge cases. Assertions cover source
locators, missing values, exact normalization, role detection, conflicts, formulas,
malformed/encrypted inputs, resource limits, and CLI output/exit codes. No runtime
module imports fixtures, reads ground truth, or branches on an email ID.

API tests also cover exact originals, persistence/restarts, immutable reruns,
per-attachment failures, request limits during reception, timeouts, dataset path
containment, feature gating, and CORS. From `frontend/`, run `pnpm test`, `pnpm lint`,
`pnpm typecheck`, `pnpm format:check`, and `pnpm build`. Frontend tests cover dataset
selection, multipart upload, duplicate submissions, source evidence, history, and
failed saves. Vision tests cover separate calls, strict response/page/role checks,
provider metadata and error mapping, immutable machine results, partial/full review,
corrections, stale writes, and restart recovery without a Gemini key. The browser
workflow above exercises the actual API and supplied files.
