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
  CHECK_COMPLETE: 'Check complete',
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
  record_kind: 'sample' | 'task'
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
  verification_source?: 'source_text' | 'ai_visual_candidate' | 'human_visual'
}
export interface ReviewAction {
  id: string
  task_id: string
  revision: number
  run_id: string
  document_id: string
  field: FieldKey
  action: 'CONFIRM_CANDIDATE' | 'CORRECT_EXTRACTION' | 'SUPPLY_INFORMATION'
  machine_raw_value: string | null
  raw_value: string
  normalized_value: string | null
  page: number | null
  unit_id: string | null
  provenance_source?: string | null
  provenance_reference?: string | null
  provenance_note?: string | null
  actor: string
  created_at: string
}
export interface Extraction {
  raw_value: string | null
  normalized_value: string | null
  value_state: 'PRESENT' | 'MISSING' | 'UNREADABLE' | 'AMBIGUOUS'
  method: 'rule' | 'gemini_text' | 'gemini_vision' | 'human'
  requires_human_confirmation: boolean
  reason: string
  evidence: Evidence[]
  review?: ReviewAction
  supplied_information?: ReviewAction
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
  field?: FieldKey
  retryable?: boolean
  next_action?: string
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
export interface RevisionDelta {
  baseline_run_id: string | null
  resolved: FieldKey[]
  persisting: FieldKey[]
  new: FieldKey[]
  uncertain: FieldKey[]
}
export interface Result {
  revision_delta?: RevisionDelta | null
  classification: {
    category: Category | null
    method: 'rule' | 'gemini'
    status: string
    reason: string
  }
  documents: ParsedDocument[]
  fields: FieldResult[]
  review_requirements: Problem[]
  known_defect_fields: FieldKey[]
  coverage: { checked: number; total: number }
  workflow_state: Workflow
  processing_status: string
  provider_calls?: Array<{
    operation: 'email_classification' | 'text_extraction' | 'vision_extraction' | 'amendment_email'
    document_id: string | null
    provider: 'gemini'
    configured_model: string
    model_version: string | null
    response_id: string | null
    prompt_version: string
    duration_ms: number
    usage: Record<string, number | null> | null
    cost_usd: number | null
  }>
}
export type AmendmentIssueKind =
  | 'mismatch'
  | 'missing_value'
  | 'unreadable'
  | 'ambiguous'
  | 'supplied_information'
  | 'pending_review'
  | 'document_requirement'
export interface AmendmentIssue {
  id: string
  field: FieldKey | null
  field_label: string
  kind: AmendmentIssueKind
  source_role: 'si' | 'bl' | null
  si_value: string | null
  bl_value: string | null
  summary: string
  requested_action: string
}
export interface AmendmentDraft {
  id: string
  task_id: string
  revision: number
  run_id: string
  recipient: string
  subject: string
  opening: string
  closing: string
  issue_items: AmendmentIssue[]
  generation_method: 'gemini' | 'standard'
  provider_call: NonNullable<Result['provider_calls']>[number] | null
  user_edited: boolean
  created_at: string
  updated_at: string
}
export interface RunSummary {
  audit_run_id?: string | null
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
  reviewed_result?: Result | null
  review_actions?: ReviewAction[]
  review_progress?: {
    total: number
    reviewed: number
    confirmed: number
    corrected: number
    supplied?: number
    pending: number
  }
  completion?: {
    id: string
    task_id: string
    revision: number
    run_id: string
    actor: string
    acknowledged_at: string
  } | null
  completion_eligibility?: {
    eligible: boolean
    blockers: Array<{ code: string; message: string }>
  }
  error: Problem | null
  document_ids: string[]
}
export interface SampleDetail extends Sample {
  baseline_id?: string
  current_si_id?: string | null
  current_bl_id?: string | null
  is_historical?: boolean
  body: string
  documents: DocumentVersion[]
  current_run: Run | null
  latest_run: Run | null
  runs: RunSummary[]
  amendment_draft?: AmendmentDraft | null
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
  if (sample.workflow_state === 'CHECK_COMPLETE') return 'View completed check'
  if (sample.known_defect_fields.length) return 'Review differences'
  return 'Inspect results'
}
