export type Locator = {
  page: number | null
  line: number | null
  paragraph: number | null
  table: number | null
  row: number | null
  column: number | null
  sheet: string | null
  cell: string | null
}
export type SourceUnit = Locator & {
  unit_id: string
  document_id: string
  text: string
  is_formula: boolean
}
export type Evidence = Locator & {
  unit_id: string
  document_id: string
  excerpt: string
  verified: boolean
}
export type ExtractedField = {
  field: string
  raw_value: string | null
  normalized_value: string | null
  value_state: 'PRESENT' | 'MISSING' | 'UNREADABLE' | 'AMBIGUOUS'
  method: string
  evidence: Evidence[]
}
export type Issue = { code: string; message: string; next_action?: string; field?: string | null }
export type ExtractionResult = {
  document_id: string
  detected_format: string | null
  detected_role: string | null
  parsing_status: string
  fields: ExtractedField[]
  source_units: SourceUnit[]
  issues: Issue[]
  needs_review: boolean
}
export type AuditEvent = {
  event_id?: string
  run_id?: string
  request_id?: string
  document_id?: string | null
  duration_ms?: number | null
  sequence: number
  timestamp: string
  elapsed_ms?: number
  stage: string
  status: string
  message: string
  details: Record<string, unknown>
}
export type AuditEventPage = {
  items: AuditEvent[]
  has_more: boolean
  next_after_sequence: number
  processing_status: string
  trace_mode: 'live' | 'legacy'
}
export type ExtractedDocument = {
  source_units?: SourceUnit[]
  document_id: string
  filename: string
  content_sha256: string | null
  byte_count: number | null
  has_original: boolean
  processing_status: string
  result: ExtractionResult | null
  events: AuditEvent[]
  error: Issue | null
}
export type EmailSummary = {
  email_id: string
  from: string
  subject: string
  attachment_count: number
}
export type DatasetEmail = Omit<EmailSummary, 'attachment_count'> & {
  body: string
  attachments: string[]
}
export type RunSummary = {
  trace_mode?: 'live' | 'legacy'
  run_id: string
  source_type: string
  source_label: string
  created_at: string
  finished_at: string | null
  processing_status: string
  needs_review: boolean
  document_count: number
}
export type ExtractionRun = RunSummary & {
  mailbox?: { email_id: string; run_id: string; revision: number; mode: string }
  audit_version?: number
  events?: AuditEvent[]
  request_id: string
  pipeline_version: string
  email: DatasetEmail | null
  documents: ExtractedDocument[]
  issues: Issue[]
  elapsed_ms?: number
}
export type Page<T> = {
  items: T[]
  total: number
  offset: number
  limit: number
  dataset_total?: number
}
export type Health = {
  capabilities?: { development_extraction: boolean; upload_limit_bytes: number }
}

export function apiUrl(path: string): string {
  return `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}${path}`
}
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init)
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload?.error?.message ??
      (response.status === 404
        ? 'This resource is unavailable. Check that local extraction is enabled and the saved run exists.'
        : 'The request could not be completed. Please retry.')
    throw new Error(
      payload?.error?.request_id ? `${message} Request: ${payload.error.request_id}` : message,
    )
  }
  return payload as T
}
export function locationLabel(locator: Locator) {
  if (locator.page) return `Page ${locator.page}`
  if (locator.sheet) return `${locator.sheet} · ${locator.cell}`
  if (locator.table) return `Table ${locator.table}, row ${locator.row}, cell ${locator.column}`
  if (locator.paragraph) return `Paragraph ${locator.paragraph}`
  return `Line ${locator.line}`
}
export function runLabel(run: RunSummary) {
  if (run.processing_status === 'RUNNING') return 'Processing'
  if (run.processing_status === 'INTERRUPTED') return 'Interrupted'
  if (run.processing_status === 'FAILED') return 'Finished with errors'
  return run.needs_review
    ? 'Needs review'
    : run.source_type === 'mailbox_email'
      ? 'Analysis finished'
      : 'Extraction finished'
}
