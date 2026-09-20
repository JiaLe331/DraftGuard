export const fieldLabels = {
  shipper: 'Shipper',
  consignee: 'Consignee',
  notify_party: 'Notify party',
  port_of_loading: 'Port of loading',
  port_of_discharge: 'Port of discharge',
  container_count: 'Container count',
  gross_weight_kg: 'Gross weight (kg)',
} as const
export type FieldKey = keyof typeof fieldLabels
export const categoryLabels = {
  BL_COMPARISON: 'BL comparison',
  SI_REQUEST: 'SI request',
  INVOICE_QUERY: 'Invoice query',
  GENERAL: 'General',
  SPAM: 'Spam',
} as const
export type Category = keyof typeof categoryLabels
export const statusLabels = {
  NOT_ANALYZED: 'Not analyzed',
  RUNNING: 'Analyzing',
  FAILED: 'Analysis failed',
  WAITING_DOCUMENT: 'Awaiting documents',
  REVIEW_REQUIRED: 'Needs review',
  DISCREPANCIES_FOUND: 'Discrepancies found',
  READY: 'Ready for review',
  NOT_APPLICABLE: 'Classified',
  MATCH: 'Match',
  MISMATCH: 'Mismatch',
  NEEDS_REVIEW: 'Needs review',
  NOT_CHECKED: 'Not checked',
} as const
export type Workflow = Exclude<
  keyof typeof statusLabels,
  'MATCH' | 'MISMATCH' | 'NEEDS_REVIEW' | 'NOT_CHECKED'
>
export type Finding = 'MATCH' | 'MISMATCH' | 'NEEDS_REVIEW' | 'NOT_CHECKED'
export interface Summary {
  total: number
  attachments: number
  states: Partial<Record<Workflow, number>>
}
export interface Sample {
  id: string
  subject: string
  sender: string
  revision: number
  attachment_count: number
  category: Category | null
  workflow_state: Workflow
  last_analyzed: string | null
  mode: 'precomputed' | 'interactive' | null
  known_defect_fields: FieldKey[]
  coverage: { checked: number; total: number }
}
export interface SampleList {
  items: Sample[]
  total: number
  page: number
  limit: number
  summary: Summary
}
export interface SourceUnit {
  id: string
  document_id: string
  locator: string
  text: string
  page?: number
  line?: number
  sheet?: string
  cells?: string[]
}
export interface Evidence extends SourceUnit {
  excerpt: string
  verified: boolean
}
export interface Extraction {
  raw_value: string | null
  normalized_value: string | null
  value_state: 'PRESENT' | 'MISSING' | 'UNREADABLE' | 'AMBIGUOUS'
  method: string
  requires_human_confirmation: boolean
  reason: string
  evidence: Evidence[]
}
export interface FieldResult {
  key: FieldKey
  si: Extraction
  bl: Extraction
  finding: Finding
}
export interface Problem {
  code: string
  message: string
  document_id?: string
}
export interface ParsedDocument {
  id: string
  role: 'si' | 'bl' | 'other' | null
  state: string
  units: SourceUnit[]
  error: Problem | null
}
export interface DocumentVersion {
  id: string
  filename: string
  sha256: string
  byte_count: number
  version: number
  created_at: string
}
export interface Result {
  classification: { category: Category | null; method: string; status: string; reason: string }
  documents: ParsedDocument[]
  fields: FieldResult[]
  review_requirements: Problem[]
  known_defect_fields: FieldKey[]
  coverage: { checked: number; total: number }
  workflow_state: Workflow
  processing_status: string
}
export interface RunSummary {
  id: string
  revision: number
  pipeline_version: string
  mode: 'precomputed' | 'interactive'
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  started_at: string
  finished_at: string | null
}
export interface Run extends RunSummary {
  result: Result | null
  error: Problem | null
  document_ids: string[]
}
export interface SampleDetail extends Sample {
  body: string
  documents: DocumentVersion[]
  current_run: Run | null
  latest_run: Run | null
  runs: RunSummary[]
}
export function analyzedAt(value: string | null) {
  return value
    ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not analyzed'
}
export function taskAction(sample: Sample) {
  if (sample.workflow_state === 'FAILED') return 'Retry analysis'
  if (sample.workflow_state === 'NOT_ANALYZED') return 'Analyze email'
  if (!sample.category) return 'Review classification'
  if (sample.category !== 'BL_COMPARISON') return 'Read email'
  if (sample.workflow_state === 'WAITING_DOCUMENT') return 'View missing documents'
  if (sample.known_defect_fields.length) return 'Review differences'
  return 'Inspect results'
}
