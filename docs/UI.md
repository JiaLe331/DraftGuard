# DraftGuard dataset mailbox

## Product direction and visual system

DraftGuard is an independent document-review workspace with a familiar email-inspired visual language. Overview summarizes the entire supplied mailbox; Inbox provides a searchable, paginated email view. Both lead into the same source-backed workspace. No personal Gmail or live mailbox is connected.

Keep white panels on a pale gray-blue canvas, blue primary actions, system sans-serif typography, Phosphor icons, and text/icon status labels. Red signals discrepancies or failures, amber review requirements, and blue readiness. Readiness is not completion. Respect reduced-motion preferences.

At 1280px and above, comparison and evidence sit side by side. Evidence moves below the comparison at intermediate widths. Phones use paired SI/BL value cards and a navigation drawer. Selecting a field focuses and scrolls to the evidence region.

## Real data and state ownership

The API, not the browser, owns classification, normalization, comparison, coverage, and workflow states. The UI has no fallback fixtures and does not load old localStorage reviews. Backend failure must never turn into apparently successful sample data.

Mailbox identity is labeled `Demo mailbox · Provided dataset`. The raw email body is rendered as text, without executing HTML or turning dataset links into automatic requests. Received times are not invented; `Last analyzed` describes the actual attempt time. Import-time results say `Precomputed · Rules`; manual runs say `On demand · Rules`.

The list uses 50-item server pagination and dataset order. Filters reset pagination. Search includes email ID, subject, sender, and body. Summary cards and sidebar counts use global totals, independently of the selected page and filters.

## Workspace and reports

- Show original email context, registered attachments, source revision, seven raw/normalized field pairs, coverage, known discrepancies, and concrete review requirements.
- Evidence references a specific immutable document and an actual line, PDF page, DOCX paragraph/table row, or XLSX sheet/cell range. PDF links include the page. Office formats use extracted text views rather than pretending to provide a full office renderer.
- Source selection does not reassign document roles. Unknown or ambiguous roles remain unresolved; the user can still inspect original attachments.
- Reanalysis is a synchronous, bounded backend operation. Busy controls prevent duplicate submissions. Completed attempts are saved before the current result is refreshed. A failed latest attempt leaves the previous successful result visible with a failure banner.
- `Ready for review` means seven fields match with supported evidence; it does not record human approval. Editing, completion, replacing attachments, and simulated revisions are not offered in this milestone.
- Print report opens a readable in-page preview. The browser print action uses the same report component, removes navigation, repeats table headers, and includes source IDs/hashes, evidence, unresolved items, actual run metadata, and the absence of a human completion acknowledgment. Native print dialogs depend on browser support.

## Routes and failures

Routes remain `/overview`, `/inbox`, `/tasks/:taskId`, with original dataset IDs such as `email_004`. URL parameters carry `q`, `category`, `status`, `page`, `field`, `source`, `document`, and `report`. Return navigation preserves the originating queue. Old numeric prototype task links are not mapped to invented results.

Handle loading, dataset not imported, no search results, invalid/missing task, API unavailable, no result, active analysis, missing source, scan requiring vision, and failed reanalysis explicitly. Inconclusive email classification remains a review requirement; a missing document never becomes seven matches.

## Verification and current limits

Run the frontend checks in README. Component tests exercise server totals/pagination, retry without fixture fallback, empty import, actual evidence links, removal of prototype-only actions, report preview, failed rerun recovery, and stale-response handling. Backend tests own the authoritative document and comparison rules.

This UI is backed by a local development mailbox. Multi-user sessions, cloud persistence, Gemini, human review writes, uploaded replacements, and the PRD's public deployment gate remain future work. Development runtime data is not part of the Git changes.

## Local extraction

The development **Local extraction** screens use `/extraction` and `/extraction/runs/:runId` and follow the same visual system. They use real documents and backend audit history, shared with new imported mailbox analyses. Section, inbox search/filter/page, selected email, attachment, and source evidence are stored in the URL. Returning from a run restores the originating inbox or history view.

Extraction fields and evidence appear side by side from 1280px; evidence sits below at narrower widths. Below 768px, each field becomes a card pairing its original and normalized values for the selected attachment. Evidence selection moves focus to the source panel on narrower screens. Blue marks an extracted value available for inspection, amber marks an unresolved value or processing problem, and green marks completed extraction. Each status also has text and a regular Phosphor icon; extraction completion does not indicate shipment approval. Printed extraction views retain the local-extraction label, run ID, pipeline version, and selected filename.

## Live Audit Trail

The main sidebar includes **Audit Trail** at `/audit` and `/audit/runs/:runId`, gated
by the same development capability as Extraction. It follows this visual system
and targets desktop. It includes new mailbox analyses alongside uploads and dataset extraction.

The list supports search, processing outcome, source type, review status, and
pagination. A run shows provenance and document identities, a filterable chronological
timeline, expandable recorded decisions/JSON, and a source-evidence panel. Search,
filters, attachment, expanded event, and evidence selection live in the URL.

Extraction starts a saved background run and stays in the results view. **View live
audit** opens the separate page; finished results use **View audit trail**. The former
embedded timeline is replaced by this link. History retains quick access to results.
Active runs poll every second and the list every five seconds while visible, without
overlapping requests. Previously displayed data survives connection failures, with a
visible retry state. Terminal runs stop polling after the remaining event pages load.
Legacy runs are identified explicitly; missing historical events are never simulated.
Inbox Analyze / Reanalyze starts a background run through the shared extractor.
The workspace links to its live audit and each historical run links to its own
record. Mailbox audit events include classification, unique SI/BL pair selection,
and comparison, with separate SI/BL evidence buttons. Audit runs link back to the
mailbox results. Earlier analyses have no invented trace. Sidebar counts refresh
after processing completes; the existing classification/comparison workflow remains.
