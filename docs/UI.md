# DraftGuard UI prototype

## Product direction

DraftGuard is an independent document-review workspace with a familiar email-inspired visual language. Overview is the default destination: users see classified tasks, outstanding findings, and their next action before opening a document. Inbox is an alternative view of the same tasks. No real mailbox is connected.

## Visual system

Use white panels on a pale gray-blue canvas, blue primary actions, system sans-serif typography, and a consistent Phosphor regular icon set. Status uses both text and an icon. Red denotes discrepancies, amber pending review, blue readiness, and green completion. Typography is at least 12px, with 14–16px body text and larger headings. CSS variables define the semantic palette. Respect reduced motion.

At 1280px and above, the workspace uses a comparison/evidence split. At intermediate widths evidence appears below the comparison. On small phones, fields become paired SI/BL cards and navigation uses a drawer. Selecting a field on a narrower screen moves to its evidence. Print CSS removes navigation and includes sample labels and version information.

## Implementation boundaries

- `frontend/src/demo/fixtures.ts` defines 13 team-authored emails and their source snippets. It does not load organizer ground truth or call an AI provider.
- `frontend/src/demo/model.ts` defines typed tasks, revisions, evidence, review events, deterministic sample comparison, and completion gates.
- The demo adapter separates baseline source versions from review overlays and persists local working copies. External supplied information remains unverified. Production parsing and normalization still need their own implementation and validation.
- The browser snapshot is a convenience for UI exploration, not an authenticated audit trail. No sensitive operational documents should be stored in it.
- Corrections must match the selected sample evidence; they cannot rewrite a source to erase a genuine discrepancy. Loading the next sample revision changes the current source pair and invalidates prior completion.
- Historical revisions are read-only. Candidate confirmation, correction, and completion are scoped to the current revision. A stored review does not mutate the original machine value.
- The printable report is a sample seven-field report, not release authorization or a legal review.

## Navigation and states

Routes: `/overview`, `/inbox`, `/tasks/:taskId`. Query parameters preserve search, filters, sorting, source selection, and revision. Returning from a task retains the queue context. Next task uses the originating filtered queue and skips completed or non-comparison tasks.

The development **Local extraction** screens use `/extraction` and `/extraction/runs/:runId` and follow the same visual system. They use real documents and backend audit history, kept separate from sample reviews and **Reset demo**. Section, inbox search/filter/page, selected email, attachment, and source evidence are stored in the URL. Returning from a run restores the originating inbox or history view.

Extraction fields and evidence appear side by side from 1280px; evidence sits below at narrower widths. Below 768px, each field becomes a card pairing its original and normalized values for the selected attachment. Evidence selection moves focus to the source panel on narrower screens. Blue marks an extracted value available for inspection, amber marks an unresolved value or processing problem, and green marks completed extraction. Each status also has text and a regular Phosphor icon; extraction completion does not indicate shipment approval. Printed extraction views retain the local-extraction label, run ID, pipeline version, and selected filename.

The workspace has explicit loading, missing-task, missing-source, historical, unsaved-edit, storage-failure, and completion states. Storage writes complete before the UI announces success. Save failures retain the editable draft. Reset removes only this prototype's local storage key.

## Verification

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, and `pnpm build` from `frontend/`. Component tests cover direct issue navigation, scan confirmation and completion, failed saves, and unsaved navigation. Domain tests cover filtering, immutable machine results, missing information, invalid corrections, revisions, completion gates, and storage restoration.
