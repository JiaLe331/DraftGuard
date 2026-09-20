# DraftGuard — Product Requirements Document

**Version:** 1.0  
**Date:** 20 September 2026  
**Milestone:** Averis × Monash Hackathon preliminary submission  
**Deadline:** 22 September 2026, 12:00 PM MYT (UTC+08:00)  
**Team:** Four contributors  
**Status:** Implementation specification based on the agreed, reduced scope. Requirements and targets below are not claims of completed implementation or measured performance.

## 1. Product summary

DraftGuard helps shipping documentation staff turn an incoming document-check request into an evidence-backed comparison of a Shipping Instruction (SI) and a draft Bill of Lading (BL).

The product classifies incoming emails, reads the relevant attachments, compares seven shipment fields, and shows the source behind each finding. When information is missing or uncertain, it gives a reviewer a concrete next action. When a revised document arrives, it checks all seven fields again and distinguishes resolved, remaining, and newly introduced discrepancies.

**Product promise:** Show what differs, where the evidence is, and whether the revised version actually resolves the problem.

**Primary demonstration:** Two company-name discrepancies are corrected in a revised BL, but a new weight discrepancy is introduced. DraftGuard identifies both the fixes and the new error.

The system supports a bounded document check. It does not certify a complete BL, determine legal validity, authorize cargo release, or issue transport documents.

## 2. Users and jobs to be done

| User | Situation | Required outcome |
|---|---|---|
| Shipping documentation reviewer | A mixed inbox contains a request to compare SI and draft BL | Find the request and identify document discrepancies |
| Shipping documentation reviewer | A file is missing, unreadable, incomplete, or visually extracted | Understand the blocker and confirm, correct, or request the missing information |
| Shipping documentation reviewer | A carrier or forwarder supplies a revised draft | Verify the current version and detect newly introduced errors |
| Colleague receiving a handover | A task has already been checked | See the source files, remaining issues, and review actions for that version |
| Hackathon judge | Opens the submitted deployment link | Use representative workflows immediately, without registration |

These workflows are supported by the challenge and published shipping-document processes. No customer interview or operational deployment has been completed unless separately documented.

## 3. Goals, success conditions, and exclusions

### 3.1 Goals

1. Deliver one reliable online flow: email/task → attachments → comparison → human review → revised-version recheck → report.
2. Make every supported field result inspectable against its actual source.
3. Avoid displaying a completed check when required documents, values, evidence, or confirmations are missing.
4. Use rules for deterministic work and Gemini for meaningful semantic and visual understanding.
5. Make the prototype accessible without sign-in and preserve saved results across refreshes.
6. Produce reproducible validation evidence, including failures and limitations.

### 3.2 Release conditions

- All eight P0 features pass the acceptance cases in this document on the deployed release.
- The primary revision scenario and at least one real visual-extraction scenario run through the real pipeline.
- No critical acceptance case displays completion while an unresolved discrepancy or review requirement remains.
- A new browser session can access the public demo without registration or deployment-provider authentication.
- API keys are server-side; a visitor cannot edit shared baseline examples or access another demo session's private files.
- The final video target is at most 4:30, leaving margin below the organizer's 5:00 maximum.

These are release targets, not guarantees about unseen documents. Accuracy, latency, AI usage, and cost must be measured before they appear as numerical claims.

### 3.3 Explicitly out of scope

- Durable background queues, Cron scheduling, automatic background recovery, and a general job orchestration framework.
- Registration, account management, role-based team workflows, and verified reviewer identities.
- LlamaIndex, pgvector, correction-memory retrieval, model fine-tuning, and learning-effect experiments.
- Automated amendment emails, email sending, live mailbox OAuth integration, and ERP integration.
- Invoice processing or SI creation beyond email classification.
- Pixel-perfect rendering and bounding-box highlights for every document format.
- Automatic BL issuance, approval by a carrier, or cargo release.

Basic access controls, version consistency, and visible failures remain required despite these exclusions.

## 4. Product scope: eight P0 capabilities

| ID | Capability | Required behavior | Acceptance reference |
|---|---|---|---|
| F01 | Email classification and task list | Classify five email categories; route document-comparison requests to the checking workflow | AC01–AC03 |
| F02 | Four-format document reading | Read TXT, PDF, DOCX, and XLSX; distinguish usable text, no usable text, and parsing failure | AC04–AC06 |
| F03 | Seven-field comparison | Show SI and BL values side by side, normalize conservatively, and identify field-level findings | AC07–AC10 |
| F04 | Source evidence | Provide format-appropriate source references and original excerpts | AC11–AC12 |
| F05 | Exceptions and human review | Identify the four challenge exception reasons; allow attributable confirmation or correction | AC13–AC17 |
| F06 | Revised-document recheck | Recheck all seven fields and show resolved, persistent, and new discrepancies | AC18–AC21 |
| F07 | Vision-assisted scanned documents | Obtain actual Gemini candidates; require human confirmation before completing the check | AC22–AC24 |
| F08 | Printable report | Export the current comparison, source versions, review actions, and unresolved items through a printable page | AC25–AC26 |

## 5. User experience

### 5.1 Language and layout

The initial interface uses English for judge accessibility. This PRD and developer-facing API identifiers use English. Translation is not a preliminary-round requirement.

Build two main views:

**Inbox**

- Read-only organizer examples, clearly labeled as sample data.
- Subject, sender, category, task state, and last analysis time.
- Filter by category and actionable state.
- An entry point to create a personal demo task or copy a sample into the current demo session.
- Precomputed predictions labeled with their run time and pipeline version.

**Verification Workspace**

- Task header: email context, current SI/BL versions, actual processing state, and last saved result.
- Seven-field comparison table: original values, normalized values, finding, and evidence links.
- Source panels: original PDF where supported; extracted document sections for TXT, DOCX, and XLSX.
- A review panel for missing or uncertain values and visual candidates.
- Revision history with resolved / remaining / new findings.
- A printable report view within the same workspace.

Use text labels as well as color. “Needs review,” “Missing document,” and “Mismatch” must be visually and semantically distinct. Processing controls must show busy states and prevent duplicate clicks.

### 5.2 Main journey

1. Open the demo without signing in.
2. Select a sample or create a task with email context and attachments.
3. For a comparison request, identify the SI and BL roles. If multiple attachments or ambiguous roles exist, ask the user to select the pair; do not guess silently.
4. Upload files or use the task's current file versions.
5. Run a synchronous analysis for that pair.
6. Inspect the comparison and source evidence.
7. Resolve extraction questions or supply missing documents. Preserve unresolved discrepancies.
8. Upload a revised SI or BL and rerun all seven checks.
9. Confirm review of the current version when all required items are resolved.
10. Print or save the report as PDF.

### 5.3 No-login demo identity

The backend issues an unguessable demo-session capability. The frontend supplies it on subsequent task and file requests. The backend checks ownership on every private operation.

The displayed actor is **“Demo reviewer — unverified.”** A display name is not authenticated identity. Shared sample records remain read-only; modifications create session-owned copies.

## 6. Functional requirements

### F01 — Email classification

Supported categories:

`BL_COMPARISON`, `SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM`.

- Use deterministic rules for explicit, unambiguous cases.
- Use Gemini when rules are inconclusive or conflicting.
- Preserve the input subject/body and the actual classification method.
- Only `BL_COMPARISON` continues into seven-field checking.
- A request that is genuinely waiting for a draft must show **“Waiting for BL”**, not “All fields match.”
- When classification fails because an external service is unavailable, show a processing failure; do not silently return `GENERAL` as a successful inference.
- The inbox can load offline-generated predictions, but those must not be represented as new live inference.

### F02 — Document ingestion and parsing

Accept `.txt`, `.pdf`, `.docx`, and `.xlsx` only. Validate content sufficiently to reject obvious type spoofing and malformed files. Reject unsupported or encrypted inputs with an actionable message; never display their contents as successfully parsed by default.

For each uploaded version, retain role, original filename, detected format, content hash, object-storage reference, creation time, and its task association.

| Format | Initial parser | Evidence unit |
|---|---|---|
| TXT | Standard text decoding | Line number and original excerpt |
| PDF | pypdf | Page number and extracted excerpt |
| DOCX | python-docx | Paragraph index or table / row / cell reference |
| XLSX | openpyxl | Sheet name and cell coordinates |

- Preserve extraction units instead of flattening away all source references.
- A PDF with no useful text is a candidate for visual processing, not automatically a readable scan.
- A corrupt PDF is a parsing exception, not a successful empty document.
- Blank cells and placeholder values remain missing. Do not infer them from the paired document.
- Validate document identity using content. A filename containing `BL` is not sufficient evidence that the document is a BL.
- Do not treat “Bill of Lading Instruction” as a BL solely because it contains those words; document role detection must account for instruction documents.
- Bound file size, page count, workbook dimensions, and archive expansion. Initial operational defaults: 10 MB per object, 20 PDF pages, and 10 attachments per task. These are application limits and may be revised after actual deployment testing.
- Larger files use authorized direct-to-Storage uploads. Any multipart development endpoint must impose a smaller payload limit appropriate to its host.

### F03 — Extraction, normalization, and comparison

The seven fields are:

| Field | Meaning | Normalized type |
|---|---|---|
| `shipper` | Shipment sender | String |
| `consignee` | Named consignee | String |
| `notify_party` | Arrival-notification recipient | String |
| `port_of_loading` | Loading port | String |
| `port_of_discharge` | Discharge port | String |
| `container_count` | Number of containers, not packages or container IDs | Non-negative integer represented consistently |
| `gross_weight_kg` | Total gross weight in kilograms | Exact decimal representation |

Rules are the default extraction path. Gemini text extraction is used only when the source may contain the required information but rules cannot reliably locate or interpret it. Explicit missing values are not a request for the model to invent a value.

Normalization requirements:

- Retain both the original value and the canonical value.
- Normalize harmless whitespace and supported formatting differences.
- Distinguish label aliases from value equivalence. Recognizing `POL` as a label does not permit arbitrary port substitutions.
- Treat commas as grouping separators only when the numeric format is unambiguous; ambiguous decimal/grouping conventions require review.
- Convert explicit supported weight units deterministically; do not guess an absent unit.
- Select an explicitly identified total gross weight over an individual container's weight. Multiple conflicting totals require review.
- Do not remove company-name tokens merely to make two legal entities match.
- Port-code/name equivalence must follow a documented, bounded mapping or verified textual normalization; do not use unconstrained fuzzy matching.
- The prototype's mapping of dataset labels, including `To the Order of`, supports the seven-field task only and does not resolve negotiability or legal title.

Comparison outcomes per field:

`MATCH`, `MISMATCH`, `NEEDS_REVIEW`, `NOT_CHECKED`.

`MISMATCH` requires usable values from both sources that differ after supported normalization. `NEEDS_REVIEW` covers missing, unreadable, ambiguous, or unconfirmed values. A known discrepancy on one field must remain visible while another field needs review.

### F04 — Evidence

Each extracted value must reference the specific document version and an evidence unit. Evidence contains the original excerpt and a locator that the UI can actually display.

- Text-derived model quotes must be verified against extracted source text, allowing only documented whitespace normalization.
- Model-generated page numbers or locations are candidates until verified.
- PDF v1 requires page-level navigation and excerpts, not universal bounding-box accuracy.
- DOCX v1 requires structured extracted content, not a full Word renderer.
- For scans, show the original PDF and candidate evidence for human checking. A model's asserted location is not automatically verified.
- Missing evidence blocks automatic completion for the affected field.

### F05 — Exceptions and human review

Challenge exception reasons:

| Reason | Example | Required next action |
|---|---|---|
| `wrong_doc_type` | An invoice or packing list supplied as a BL | Replace or reassign the document |
| `missing_attachment` | SI or BL absent from a comparison request | Upload the missing source |
| `unreadable` | Corrupt file or unconfirmed visual reading | Replace the file or review a usable visual candidate |
| `missing_value` | SI weight is `N/A` | Supply an authoritative value with provenance or upload a revised source |

Maintain a list of reasons internally when multiple conditions apply. Technical service failures such as a Gemini timeout also have explicit operational error codes; do not mislabel them as a confirmed document defect.

Review actions:

1. **Confirm candidate:** affirm a value against the current source and attach evidence.
2. **Correct extraction:** replace a misread value with a value actually present in that source.
3. **Supply information:** record a new business value and its stated external source; do not present it as extracted from the original file.
4. **Replace document:** create a new immutable document version and rerun the comparison.

Preserve original machine outputs. Apply review actions as an overlay and recompute the comparison. Acknowledging a discrepancy is not resolving it.

Supplied information without checkable source evidence remains unresolved. A replacement source document is the preferred completion path for genuinely missing business data.

### F06 — Revisions and completion

- Every source replacement increments the task revision and identifies a new current SI/BL pair.
- Recheck all seven fields, including previously matching fields.
- Findings are compared by field against the prior comparable run: resolved, persisting, newly introduced. Show transitions into uncertainty separately from confirmed mismatches.
- Before linking a result as current, the backend verifies that the analyzed task revision is still current.
- A stale run remains historical and cannot replace the current result or complete the new revision.
- Review actions and completion acknowledgments require the expected task revision and run ID. A stale write returns a conflict.
- An old completion acknowledgment never applies to a new source version.

Completion requires: both source documents present; all seven fields checkable with required evidence; zero unresolved discrepancies; zero pending review requirements; and confirmation for every mandatory human-review item.

### F07 — Visual assistance

- Gemini receives the actual PDF through supported PDF input. Local PDF rasterization is not a prerequisite.
- Analyze SI and BL separately to avoid copying a value from one into a missing value in the other.
- Validate response structure; preserve the model identifier, prompt version, provider usage, and timing when available.
- Display visual values as **“AI candidate — confirm against source.”**
- A scanned-document task remains `NEEDS_REVIEW` before the required human confirmations, even if candidate values appear to agree.
- Do not use a model's self-reported confidence percentage as permission to complete a check.
- If the API key is missing or the provider fails, return an explicit feature-unavailable or retryable failure. Do not substitute fabricated vision results.

AI is functionally demonstrated through actual semantic or visual work, not merely explanation wording. There is no target percentage of requests that must call an LLM.

### F08 — Report

The printable report includes:

- Task/email reference and report generation time.
- Exact SI and BL version references, filenames, and current revision.
- Seven-field table with original values, normalized values, findings, and source references.
- Outstanding exceptions and review requirements.
- Whether results are machine-only or include human confirmation/correction.
- Review actions, timestamps, and the unverified demo-reviewer designation.
- Revision changes where a prior run exists.
- Scope statement: a seven-field comparison, not a full legal or operational approval.

Report printing must exclude navigation and interactive controls. Historical reports must visibly identify themselves as historical.

## 7. State model and invariants

Do not overload a single status with processing, comparison, and human-review meaning.

| Dimension | Values |
|---|---|
| Processing | `IDLE`, `RUNNING`, `SUCCEEDED`, `FAILED` |
| Workflow | `NOT_APPLICABLE`, `WAITING_DOCUMENT`, `READY`, `REVIEW_REQUIRED`, `DISCREPANCIES_FOUND`, `CHECK_COMPLETE` |
| Per-field finding | `MATCH`, `MISMATCH`, `NEEDS_REVIEW`, `NOT_CHECKED` |
| Review | Pending requirements, immutable actions, optional completion acknowledgment for an exact run/revision |

The UI derives workflow from current results and outstanding requirements. If discrepancies and review requirements coexist, show both counts; use `REVIEW_REQUIRED` as the primary action state without hiding discrepancies.

Invariants:

1. A successful HTTP response or parser run does not imply a completed document check.
2. No attachment or no result must never display as seven matches.
3. A result applies only to its source versions.
4. Human edits do not erase the original machine result.
5. Correcting a source value triggers deterministic recomparison.
6. Only a current, fully resolved run can receive completion acknowledgment.
7. Ground truth is never an input to the production pipeline.

## 8. Data contracts

These contracts define the shared frontend/backend language. Database normalization may vary, but public semantics must remain consistent.

### 8.1 Entities

| Entity | Required attributes |
|---|---|
| Demo session | ID, hashed capability/token identifier, created time, expiration |
| Task | ID, owner session or sample-baseline marker, email metadata, category/method, current revision, current SI/BL IDs, current run ID |
| Document version | ID, task ID, role, version, original filename, format, byte count, SHA-256, private object key, creation time |
| Analysis run | ID, task ID, revision snapshot, SI/BL IDs, pipeline version, model/prompt metadata where used, start/end, processing state, machine result, timing/error details |
| Field result | Field key, SI extraction, BL extraction, finding, reason, normalization rule |
| Review event | ID, task/run/revision, document/field, action type, old/new values, evidence or supplied provenance, actor designation, timestamp |
| Completion acknowledgment | Task/run/revision, timestamp, unverified demo-session actor |

Runs and document versions are immutable once finalized. Store only the current pointers on the task; advance them with a revision check. JSONB is sufficient for the bounded seven-field result; do not add vector storage.

### 8.2 Extraction contract

```json
{
  "field": "gross_weight_kg",
  "raw_value": "23,702 KG",
  "normalized_value": "23702",
  "value_state": "PRESENT",
  "method": "rule",
  "requires_human_confirmation": false,
  "evidence": [{
    "document_id": "<immutable-document-id>",
    "page": 1,
    "line": 29,
    "sheet": null,
    "cell": null,
    "excerpt": "<exact excerpt returned by the parser>",
    "verified": true
  }]
}
```

The locator and excerpt above illustrate the schema; implementations generate actual locators and must not hard-code the illustrative line number. `normalized_value` uses a canonical string for exact numeric handling; consumers parse it according to the field type. Missing or unusable values use `null`, never `0` or an empty-string success value.

`value_state`: `PRESENT`, `MISSING`, `UNREADABLE`, `AMBIGUOUS`.  
`method`: `rule`, `gemini_text`, `gemini_vision`, `human`.

### 8.3 Analysis response

Include `run_id`, `task_id`, `task_revision`, `document_ids`, `processing_status`, `workflow_state`, `coverage`, `fields`, `review_requirements`, `known_defect_fields`, `revision_delta`, `timings_ms`, and actual method/provider metadata.

`coverage` explicitly counts checked fields out of seven. Provider token/cost fields are nullable when unavailable; unknown cost is not reported as zero.

### 8.4 Evaluation export

Keep challenge export separate from the richer product state:

`category`, `status`, `review_reason`, `has_defect`, `defect_fields`, optional `decided_by`.

- Export machine results before human corrections for automated evaluation.
- `decided_by` describes the classification decision and is consistently populated for all exported records where a classification was made.
- The scorer's `rule_pct` counts supplied `decided_by` values; it is not proof of zero AI usage across the workflow.
- For unresolved review conditions, export `NEEDS_REVIEW` under the dataset convention (`has_defect=false`, `defect_fields=[]`); retain known discrepancies in the internal result and report them separately. Do not reinterpret this export as a clean task.
- For multiple reasons, use documented deterministic precedence: missing attachment, wrong document type, unreadable, missing value. Report all reasons internally.
- A genuine waiting-for-draft email may need `OK` in the dataset export while the product remains `WAITING_DOCUMENT`. Derive the waiting intent from the actual input, never an email ID or answer key.
- Record export limitations for mixed cases; do not modify product truth to improve the scorer.

## 9. API contract

Use `/api/v1` for product endpoints. Except session creation and read-only sample endpoints, requests require the demo-session capability. Secrets used to access Supabase or Gemini are never accepted from or returned to the browser.

| Method / endpoint | Purpose |
|---|---|
| `GET /health` | Process health and non-sensitive capability flags |
| `POST /api/v1/sessions` | Issue an expiring demo-session capability |
| `GET /api/v1/samples` | Read sample tasks and labeled precomputed results |
| `POST /api/v1/tasks` | Create a session-owned task or clone a sample |
| `GET /api/v1/tasks` | List current session tasks |
| `GET /api/v1/tasks/{task_id}` | Read task, current versions, and current result |
| `POST /api/v1/tasks/{task_id}/uploads` | Validate upload metadata and issue a scoped Storage upload authorization |
| `POST /api/v1/tasks/{task_id}/documents` | Verify uploaded object and attach an immutable SI/BL version with expected revision |
| `POST /api/v1/tasks/{task_id}/classify` | Run rule/Gemini email classification |
| `POST /api/v1/tasks/{task_id}/analyze` | Synchronously analyze the selected current pair, requiring expected revision |
| `GET /api/v1/tasks/{task_id}/runs/{run_id}` | Read a current or historical run belonging to the task |
| `POST /api/v1/tasks/{task_id}/reviews` | Record a candidate confirmation, extraction correction, or supplied information with evidence |
| `POST /api/v1/tasks/{task_id}/complete` | Acknowledge an eligible current run; reject unresolved or stale runs |
| `GET /api/v1/tasks/{task_id}/documents/{document_id}/access` | Issue short-lived read access after ownership validation |
| `GET /api/v1/tasks/{task_id}/report` | Return structured report content for the printable frontend view |

The initial development probe may expose a bounded `POST /api/v1/dev/extract` multipart endpoint. It must be labeled as development-only, disabled by default in production, and is not a substitute for session-owned persistence or the public deployment gate.

Error responses use a stable code, actionable message, retryable flag, and request ID. Never return secret-bearing stack traces. Typical HTTP codes: `400` invalid request, `401` missing/expired capability, `404` missing or inaccessible resource, `409` stale revision/unresolved completion, `413` oversized input, `415` unsupported format, `422` invalid structure, `429` rate limit, `502/504` provider error/timeout.

Supported malformed documents can also produce successful analysis responses with explicit document-review findings. An operational failure must not masquerade as a successful comparison.

## 10. Architecture and deployment

```text
React workspace (Vercel)
  ├─ authorized direct file upload → Supabase private Storage
  └─ task / review / analysis API → FastAPI (Vercel Functions)
                                     ├─ parsers + rule extraction
                                     ├─ Gemini semantic / PDF vision path
                                     ├─ deterministic comparison
                                     └─ Supabase Postgres + Storage

Fallback: move FastAPI to Cloud Run; keep the frontend and Supabase.
```

### 10.1 Stack

- Frontend: React, TypeScript, Vite.
- Backend: Python, FastAPI, Pydantic.
- Parsing: pypdf, python-docx, openpyxl.
- AI: Gemini API using a tested model configured server-side.
- Persistence: Supabase Postgres and private Storage.
- Initial hosting: Vercel; portable Docker deployment for Cloud Run.
- Reports: browser print styles; no separate PDF-generation service.

### 10.2 Synchronous execution

One analysis request processes one document pair. Show actual progress/busy state without inventing granular percentages. Disable duplicate client submissions. Store run and revision identifiers and reject stale writes server-side.

Set bounded parser and provider timeouts. A browser disconnect is not a promise of durable background completion. The UI can reread a saved result; if none exists, offer a manual retry. Do not add queues or detached threads to disguise an unfinished synchronous implementation.

The full dataset can be analyzed using a separate development CLI. Its predictions may be loaded into Postgres as labeled, precomputed sample results.

### 10.3 Portability

- Keep extraction/comparison code separate from HTTP and platform entrypoints.
- Use environment configuration for origins, service URLs, keys, and model names.
- Do not depend on persistent instance-local files or in-memory state for shared results.
- Provide a container startup that binds to `0.0.0.0` and the platform-provided `PORT`.
- Changing the backend host requires updated API origins, access configuration, and a smoke test; do not assume a configuration-only move is risk-free.

### 10.4 Deployment gate

The first engineering checkpoint is a public, real-data slice:

1. Open the deployed interface without login.
2. Upload `email_160_SI.pdf` through the actual storage/API path.
3. Return seven extracted fields with real source references.
4. Save the result and read it back after refresh.
5. Verify no ground truth or hard-coded sample result is used.

A local parser or `/health` endpoint alone does not pass this gate.

Timebox initial Vercel deployment investigation to approximately two focused hours. If there is a concrete platform blocker, use the prepared Cloud Run backend rather than spending the remaining build window on repeated configuration attempts. Check fallback project and deployment permissions early.

Other contributors may work on interface contracts, UI layout, fixtures, and acceptance tests while the deployment owner handles the gate. After the PDF gate, immediately smoke-test a DOCX/XLSX pair and one image-only PDF online.

### 10.5 Configuration

Server-only configuration includes `APP_ENV`, `ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and `DEMO_SESSION_SECRET`.

Public frontend configuration may contain `VITE_API_BASE_URL`; never place provider or service-role secrets in a `VITE_` variable. Commit `.env.example` with placeholders, not real keys. Keep a test/staging environment separate from any real operational data.

## 11. Access, reliability, and operational requirements

- Default-deny direct anonymous database access. Keep simple RLS/grant protection without building a full account product.
- Backend service keys bypass RLS, so verify capability ownership for every task/file operation.
- Use private object storage and short-lived, path-scoped upload/read authorizations.
- Do not trust object keys, task IDs, document roles, or revision numbers merely because the client supplied them.
- Prevent filename/path traversal and reject uploaded scripts or unsupported types.
- Keep organizer baseline examples read-only; sample clones and uploads belong to an individual demo session.
- Bound uploads and provider requests; return an actionable rate-limit state rather than continuing unlimited calls.
- Avoid logging document bodies, session tokens, provider keys, or signed URLs. Log request IDs, stages, timings, and non-sensitive error codes.
- Define application limits in configuration. Validate actual platform quotas before the judging period; free plans do not imply unlimited availability.
- Do not promise verified human accountability when the demo has no authenticated users.

## 12. Acceptance test matrix

Tests below are required behavior, not completed test results. Use real fixtures where specified and mark team-created fixtures explicitly.

| ID | Given / when | Then |
|---|---|---|
| AC01 | Representative emails from all five categories are processed | Category and actual decision method are recorded; only comparison tasks enter field checking |
| AC02 | An inconclusive email requires Gemini, but the provider is unavailable | Visible failure/retry state; no fabricated successful classification |
| AC03 | A request is waiting for a draft | UI shows waiting for the document with incomplete coverage, not seven matches |
| AC04 | The real `email_160_SI.pdf` is parsed online | Seven fields and source references are returned and saved |
| AC05 | `email_055_SI.xlsx` and `email_055_BL.docx` are processed | Both formats parse; grouping punctuation in weight does not create a false discrepancy |
| AC06 | A corrupt PDF or a no-text PDF is processed | Parsing failure and visual-reading candidate are distinguished; neither silently becomes a clean result |
| AC07 | Original `email_004` is compared | Exactly consignee and notify_party are the known mismatches in the seven-field scope |
| AC08 | `243588` and `243,588` are compared in unambiguous kg context | Match after documented normalization, with both originals preserved |
| AC09 | Individual-container weights and an explicit total occur together | Total gross weight is selected; ambiguous or conflicting totals require review |
| AC10 | One field mismatches and another is missing | Both the known discrepancy and the unresolved requirement remain visible |
| AC11 | A user opens evidence for a field | The locator refers to the correct immutable source version and actual excerpt |
| AC12 | A Gemini text quote cannot be located in the source | It cannot support automatic completion; mark the affected result for review |
| AC13 | An invoice is supplied as the BL | Report wrong_doc_type and require replacement, regardless of filename |
| AC14 | A comparison request lacks an attachment | Identify the missing role and prevent completion |
| AC15 | Real `email_516` is processed | SI weight remains missing; BL 235,550 KG is not copied into SI; missing_value requires review |
| AC16 | A reviewer corrects a misread source value | Preserve the machine output, store evidence and review action, and recompute results |
| AC17 | A reviewer supplies a value absent from the source | Label it as supplied information; require checkable provenance or a replacement source before resolution |
| AC18 | Team-created email_004 BL v2 fixes two names but changes weight to 130,058 KG | Show two resolved discrepancies and one new gross-weight discrepancy |
| AC19 | Team-created BL v3 restores weight to 131,058 KG and all seven fields are consistent | Current version is eligible for completion after required review |
| AC20 | An older run completes after a newer revision exists | Older result is historical and cannot overwrite the current result |
| AC21 | A source changes after completion or a stale review is submitted | Old completion is not reused; stale review/completion request returns conflict |
| AC22 | A real image-only PDF is sent through Gemini | Actual visual candidates are shown alongside the source and marked unconfirmed |
| AC23 | Visual candidates match but have not been confirmed | Task remains NEEDS_REVIEW; self-reported model confidence cannot bypass review |
| AC24 | Required visual candidates are confirmed or corrected | Reviewed result is recomputed; original pre-review machine result remains exportable |
| AC25 | The current report is printed | Version references, findings, evidence, unresolved items, and review designation are readable |
| AC26 | A historical report is opened | Historical status is clear and it cannot be mistaken for the current check |
| AC27 | Another demo session requests a private task/file | Access is denied; shared baseline data remains unmodified |
| AC28 | A saved task is reopened after page refresh | Persisted current result is recovered; no fake completion for a failed/unsaved request |
| AC29 | The submitted URL is opened in a fresh browser session | The demo is accessible without registration or platform login |
| AC30 | AI usage and timings are displayed | Numbers come from actual stage logs; precomputed/cached results are labeled |

## 13. Evaluation and measurement

### 13.1 Data boundaries

- Use the supplied 520 emails and attachments for development and regression.
- Ground truth belongs exclusively to offline evaluation. Do not ship it with the runtime application or read it from extraction/classification code.
- Freeze a second generated dataset before final testing. Report its seed, generator version, manifest, and pipeline version.
- Different seeds from the same generator test in-distribution variation, not real-world template generalization.
- Add explicit revision, missing-evidence, malformed-input, and normalization fixtures outside the generator's happy path.
- The reported 100% rule result from another implementation is unverified for this implementation until its scripts and outputs are reproduced.

### 13.2 Metrics

| Metric | Definition |
|---|---|
| Classification | Accuracy and per-category precision/recall/F1 on the declared sample set |
| Field extraction | Correct canonical values, with missing and ambiguous cases reported separately |
| Discrepancy detection | Field-level false positives, false negatives, and exact defect-set matches |
| Review handling | Correct escalation for each exception reason and scan-confirmation policy |
| False completion | Cases marked complete despite unresolved missing data, evidence, discrepancies, or required review |
| Evidence validity | Values whose declared source references can actually be checked |
| Revision correctness | Expected resolved/new/persistent findings and rejection of stale completion |
| Performance | Parser, model, storage, and end-to-end timings; include sample count and distribution |
| AI usage | Actual model calls/tokens per stage and fraction of whole tasks with no model calls |
| Operational value | Timed internal task completion and remaining manual actions; identify participants and sample size |

Rule processing has zero LLM token cost, not necessarily zero operating cost. Do not publish the illustrative “94% rules / 6% AI / 40 ms” values without measurement.

The bundled `scoring.py` is a self-evaluation tool. Current challenge/rubric materials do not specify a direct conversion of its `final_score` into the preliminary 100-point rubric. Treat that as an interpretation of the supplied documents, and confirm any additional organizer scoring rule during Q&A.

## 14. Demo script: 4:30 target

| Time | Action | Intended proof |
|---|---|---|
| 0:00–0:20 | Explain mixed inboxes and repeated draft corrections | Clear user and job |
| 0:20–0:40 | Open the no-login inbox and choose a comparison | Accessible working entry point |
| 0:40–1:35 | Compare original email_004 and open evidence | Two actual discrepancies, with verifiable sources |
| 1:35–2:35 | Upload constructed BL v2, then corrected v3 | Fixing earlier errors can introduce a new one; all seven fields are rechecked |
| 2:35–3:00 | Open email_516 | Missing SI data is not invented from BL |
| 3:00–3:35 | Run or clearly identify a prior real Gemini scan result; confirm a candidate | Actual vision assistance with a human decision boundary |
| 3:35–4:05 | Show architecture and measured validation | Meaningful integration and reproducible evidence |
| 4:05–4:30 | Print report, state measured value and next steps | Usable handover and credible scope |

Original email_004 values: SI consignee/notify `EAST BRIGHT FZ-LLC`; BL consignee/notify `UAB NOVAKOPA`; both weights `131,058 KG`.

Constructed v2 fixes the names but changes BL weight to `130,058 KG`. Constructed v3 restores `131,058 KG`. Label both files as team-created test revisions and process them normally. Do not route by filename to a preset result. The original discrepant v1 was not approved; do not claim its approval is being revoked.

An unchanged address beside a changed company name may be shown as an observable fixture detail, not a verified real-world error history or an additional scored field.

The video may use edits to remove waiting, with honest timing labels. Precomputed, cached, or previously recorded results are identified as such. The live URL must still perform real processing.

## 15. Judging evidence allocation

| Criterion | Maximum | Primary evidence |
|---|---:|---|
| System Design & Architecture | 15 | Implemented data flow, source/result version binding, synchronous boundaries, portable deployment |
| Working Core Prototype | 25 | Public end-to-end workflow including review, revision, and report |
| Technology Integration | 15 | Actual parser/rule/Gemini/storage execution trace and visual-candidate handling |
| Technical Feasibility & Validation | 15 | Frozen test manifests, acceptance tests, measured errors and timings |
| Problem Statement Understanding | 10 | Correct handling of missing sources, draft revisions, and human responsibilities |
| Innovation & Solution Approach | 10 | Revision-change findings and explicit evidence-based confirmation behavior |
| Practical Value & Potential | 10 | Measured manual effort, usable reports, and a realistic mailbox-integration path |

These are maximum criterion weights, not promised scores. The same numerical result or demo clip is not presented as the sole proof for several independent criteria. Human review is already encouraged by the challenge; do not market it as automatic innovation points or a globally novel invention.

## 16. Delivery plan and ownership

| Owner | Primary work | Integration responsibility |
|---|---|---|
| A — Extraction and AI | Parsers, rule extraction, Gemini semantic/visual paths | Shared extraction schema; real PDF and scan fixtures |
| B — Backend and deployment | FastAPI, Supabase, session access, synchronous runs, version writes | First online deployment gate and persistence |
| C — Frontend | Inbox, comparison, evidence panels, review, revision display, print styles | Real API integration, busy/error states, fresh-session accessibility |
| D — Validation and submission | Regression runner, fixtures, acceptance evidence, README, slides, video | Test from the first slice; reproduce claimed metrics and maintain demo narrative |

### Milestones

1. **M0: Contract and deployment probe.** Shared field schema, actual PDF extraction, public upload/save/read gate. Target the first focused development block.
2. **M1: Core comparison.** Four formats, deterministic seven-field results, evidence, and the four exception reasons.
3. **M2: Human and revision loop.** Candidate confirmation, correction provenance, version recheck, stale-result protection, printable report.
4. **M3: Actual AI path.** Real Gemini scan and semantic fallback, usage traces, provider-failure behavior. Can develop alongside M1/M2 after contracts are stable.
5. **M4: Freeze and submit.** Run acceptance tests, capture measurements, record the 4:30 demo, verify all links.

Plan to freeze new features on the evening of 21 September and use the morning of 22 September for deployment checks and submission. Re-estimate using actual remaining time and member availability; do not treat rough timeboxes as guaranteed completion times.

### Required submission artifacts

- Public GitHub repository with reproducible setup instructions and `.env.example`.
- Publicly accessible, functional deployment URL throughout judging.
- Slide deck covering architecture, implementation, challenges, and roadmap.
- Public or unlisted YouTube demo within five minutes; target 4:30.
- Project description and any other fields required by the submission form.

## 17. Risks and decisions

| Risk | Decision / response |
|---|---|
| Python deployment or parser dependencies fail on Vercel | Validate early with real documents; switch backend to prepared Cloud Run container if blocked |
| AI calls hit quota or timeouts | Bounded calls, visible failures, manual retry; never fabricate output |
| Rule accuracy reflects generator templates only | Declare evaluation distribution; test unknown labels and explicit edge cases |
| Removing login exposes mutable shared data | Read-only baselines, session-owned tasks, backend ownership checks, private Storage |
| Synchronous work exceeds runtime limits | Bound document size/pages and provider duration; preserve visible failure instead of adding hidden background work |
| Source coordinates are unreliable | Promise page/excerpt-level evidence first; do not invent precision |
| Manual review hides extraction errors in metrics | Separate pre-review machine results and reviewed outcomes |
| Scope grows again | Any new feature replaces existing scope or moves to roadmap; do not silently add queues, memory, or account systems |

## 18. Inputs still needed for deployment

Development can proceed locally while the team supplies existing project configuration through local environment files or platform secret settings:

- Supabase project URL, server-side secret, and a private bucket.
- Gemini API access and a tested model/quota selection.
- Vercel project/deployment access.
- Cloud Run fallback project and deployment/ billing eligibility if needed.

Do not paste secrets into the PRD, repository, demo video, or chat. Missing configuration must be visible in development status and must not be described as a completed deployment gate.

## 19. Sources and traceability

- [Agreed reduced scope](</Users/jiale/Workspace/Hackathon/averis/docs/solution-confirmation.md>).
- [Official use case](</Users/jiale/Workspace/Hackathon/averis/problem-statement/Shipping Document Verification Use Case.pdf>).
- [Preliminary judging rubric](</Users/jiale/Workspace/Hackathon/averis/problem-statement/Averis x Monash Hackathon 2026 - Preliminary Judging Rubric .md>).
- [Rules and submission requirements](</Users/jiale/Workspace/Hackathon/averis/problem-statement/Averis x Monash Hackathon Rules and Regulations.pdf>).
- [Scoring implementation](</Users/jiale/Workspace/Hackathon/averis/problem-statement/sdoc-hackathon-docker/server/scoring.py>).
- [FastAPI file uploads](https://fastapi.tiangolo.com/tutorial/request-files/), [Vite environment variables](https://vite.dev/guide/env-and-mode).
- [pypdf extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html), [Gemini document processing](https://ai.google.dev/gemini-api/docs/document-processing).
- [Supabase data access](https://supabase.com/docs/guides/database/secure-data), [Vercel FastAPI](https://vercel.com/docs/frameworks/backend/fastapi), [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract).
