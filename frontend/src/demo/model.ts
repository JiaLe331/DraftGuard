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
export type Role = 'si' | 'bl'
export type Finding = 'MATCH' | 'MISMATCH' | 'NEEDS_REVIEW'
export type Category = 'BL_COMPARISON' | 'SI_REQUEST' | 'INVOICE_QUERY' | 'GENERAL' | 'SPAM'
export type Workflow = 'attention' | 'waiting' | 'ready' | 'completed' | 'other'
export type ReviewAction = 'correct' | 'supply' | 'confirm'
export interface Evidence {
  locator: string
  text: string
  value: string
}
export interface Extraction {
  raw: string
  evidence: Evidence | null
  candidate?: boolean
}
export interface FieldResult {
  key: FieldKey
  si: Extraction
  bl: Extraction
}
export interface DocumentVersion {
  id: string
  role: Role
  version: number
  filename: string
}
export interface Revision {
  number: number
  documents: DocumentVersion[]
  fields: FieldResult[]
  issue?: 'missing_attachment' | 'wrong_doc_type' | 'unreadable'
}
export interface ReviewEvent {
  id: string
  revision: number
  field: FieldKey
  role: Role
  action: ReviewAction
  value: string
  reason: string
  createdAt: string
  actor: string
}
export interface Task {
  id: string
  subject: string
  sender: string
  email: string
  initials: string
  color: string
  category: Category
  body: string
  updatedAt: string
  reference: string
  route: string
  currentRevision: number
  revisions: Revision[]
  reviews: ReviewEvent[]
  completedRevision?: number
  isCopy?: boolean
}
export const categoryLabels: Record<Category, string> = {
  BL_COMPARISON: 'BL comparison',
  SI_REQUEST: 'SI request',
  INVOICE_QUERY: 'Invoice query',
  GENERAL: 'General',
  SPAM: 'Spam',
}
export const workflowLabels: Record<Workflow, string> = {
  attention: 'Needs attention',
  waiting: 'Awaiting documents',
  ready: 'Ready for review',
  completed: 'Completed',
  other: 'Classified',
}
export const findingLabels: Record<Finding, string> = {
  MATCH: 'Match',
  MISMATCH: 'Mismatch',
  NEEDS_REVIEW: 'Needs review',
}
export function currentVersion(task: Task, revision = task.currentRevision) {
  return task.revisions.find((item) => item.number === revision)!
}
export function normalize(key: FieldKey, value: string): string {
  const text = value.trim().replace(/\s+/g, ' ').toUpperCase()
  if (key === 'gross_weight_kg' || key === 'container_count') {
    const numeric = text.replace(/\s*KG$/, '')
    if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(numeric)) {
      return numeric.replace(/,/g, '').replace(/\.0+$/, '')
    }
  }
  return text
}
export function effectiveValue(task: Task, field: FieldResult, role: Role, revision: number) {
  const review = task.reviews
    .filter((r) => r.revision === revision && r.field === field.key && r.role === role)
    .at(-1)
  return { value: review?.value ?? field[role].raw, review }
}
export function finding(task: Task, field: FieldResult, revision = task.currentRevision): Finding {
  const sides = (['si', 'bl'] as const).map((role) => {
    const { value, review } = effectiveValue(task, field, role, revision)
    const missing = !value.trim() || /^(N\/A|TBA)$/i.test(value.trim())
    return {
      value,
      pending:
        missing ||
        !field[role].evidence ||
        review?.action === 'supply' ||
        (field[role].candidate && !review),
    }
  })
  if (sides.some((side) => side.pending)) return 'NEEDS_REVIEW'
  return normalize(field.key, sides[0].value) === normalize(field.key, sides[1].value)
    ? 'MATCH'
    : 'MISMATCH'
}
export function counts(task: Task, revision = task.currentRevision) {
  const fields = currentVersion(task, revision).fields
  return fields.reduce(
    (result, field) => {
      result[finding(task, field, revision)]++
      return result
    },
    { MATCH: 0, MISMATCH: 0, NEEDS_REVIEW: 0 },
  )
}
export function canComplete(task: Task) {
  const version = currentVersion(task)
  return (
    task.category === 'BL_COMPARISON' &&
    !version.issue &&
    version.documents.length === 2 &&
    version.fields.length === 7 &&
    counts(task).MATCH === 7
  )
}
export function workflow(task: Task): Workflow {
  if (task.category !== 'BL_COMPARISON') return 'other'
  if (currentVersion(task).issue === 'missing_attachment') return 'waiting'
  if (!canComplete(task)) return 'attention'
  return task.completedRevision === task.currentRevision ? 'completed' : 'ready'
}
export function summary(task: Task): string {
  const issue = currentVersion(task).issue
  if (issue === 'missing_attachment') return 'Draft BL is missing'
  if (issue === 'wrong_doc_type') return 'Invoice supplied as draft BL'
  if (issue === 'unreadable') return 'Draft BL could not be read'
  if (task.category !== 'BL_COMPARISON') return 'No document check required'
  const result = counts(task)
  const parts = []
  if (result.MISMATCH)
    parts.push(`${result.MISMATCH} ${result.MISMATCH === 1 ? 'discrepancy' : 'discrepancies'}`)
  if (result.NEEDS_REVIEW)
    parts.push(
      `${result.NEEDS_REVIEW} ${result.NEEDS_REVIEW === 1 ? 'field needs' : 'fields need'} review`,
    )
  return (
    parts.join(' · ') ||
    (workflow(task) === 'completed' ? 'Current version reviewed' : 'All 7 fields match')
  )
}
export function actionLabel(task: Task): string {
  const issue = currentVersion(task).issue
  if (issue === 'missing_attachment') return 'View missing document'
  if (issue) return 'Review document'
  const state = workflow(task)
  if (state === 'other') return 'Read email'
  if (state === 'completed') return 'View report'
  if (state === 'ready') return 'Review & complete'
  if (counts(task).NEEDS_REVIEW) return 'Review values'
  return 'Review differences'
}
export function firstAttentionField(task: Task): FieldKey {
  const fields = currentVersion(task).fields
  return (
    fields.find((f) => finding(task, f) === 'NEEDS_REVIEW')?.key ??
    fields.find((f) => finding(task, f) === 'MISMATCH')?.key ??
    'shipper'
  )
}
export function applyReview(
  task: Task,
  input: Omit<ReviewEvent, 'id' | 'createdAt' | 'actor'>,
): Task {
  if (input.revision !== task.currentRevision)
    throw new Error('This version is historical. Return to the current version to edit.')
  const field = currentVersion(task).fields.find((f) => f.key === input.field)
  if (!field || !input.value.trim() || !input.reason.trim())
    throw new Error('Add a value and a source or explanation before saving.')
  const evidence = field[input.role].evidence
  if (
    input.action !== 'supply' &&
    (!evidence || normalize(input.field, input.value) !== normalize(input.field, evidence.value))
  ) {
    throw new Error(
      'This value does not match the sample source. Use Supply information for a value from another source.',
    )
  }
  if (input.action === 'confirm' && !field[input.role].candidate)
    throw new Error('This field has no AI candidate to confirm.')
  return {
    ...task,
    isCopy: true,
    completedRevision: undefined,
    updatedAt: new Date().toISOString(),
    reviews: [
      ...task.reviews,
      {
        ...input,
        value: input.value.trim(),
        reason: input.reason.trim(),
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        actor: 'Demo reviewer — unverified',
      },
    ],
  }
}
export function completeTask(task: Task): Task {
  if (!canComplete(task))
    throw new Error(
      'Resolve all discrepancies and review requirements before completing this check.',
    )
  return {
    ...task,
    isCopy: true,
    completedRevision: task.currentRevision,
    updatedAt: new Date().toISOString(),
  }
}
export function advanceRevision(task: Task): Task {
  if (!task.revisions.some((r) => r.number === task.currentRevision + 1))
    throw new Error('No further sample revision is available.')
  return {
    ...task,
    isCopy: true,
    currentRevision: task.currentRevision + 1,
    completedRevision: undefined,
    updatedAt: new Date().toISOString(),
  }
}
export function revisionDelta(task: Task, revision: number) {
  if (revision < 2) return null
  const previous = currentVersion(task, revision - 1)
  const now = currentVersion(task, revision)
  const delta = { resolved: 0, remaining: 0, introduced: 0, uncertain: 0 }
  for (const field of now.fields) {
    const before = previous.fields.find((f) => f.key === field.key)
    if (!before) continue
    const oldFinding = finding(task, before, revision - 1),
      newFinding = finding(task, field, revision)
    if (oldFinding === 'MISMATCH' && newFinding === 'MATCH') delta.resolved++
    if (oldFinding === 'MISMATCH' && newFinding === 'MISMATCH') delta.remaining++
    if (oldFinding !== 'MISMATCH' && newFinding === 'MISMATCH') delta.introduced++
    if (oldFinding !== 'NEEDS_REVIEW' && newFinding === 'NEEDS_REVIEW') delta.uncertain++
  }
  return delta
}
export interface Filters {
  query: string
  status: string
  category: string
  sort: string
}
export function filterTasks(tasks: Task[], filters: Filters) {
  const rank: Record<Workflow, number> = {
    attention: 0,
    waiting: 1,
    ready: 2,
    completed: 3,
    other: 4,
  }
  return tasks
    .filter(
      (task) =>
        (!filters.status || workflow(task) === filters.status) &&
        (!filters.category || task.category === filters.category) &&
        `${task.subject} ${task.sender} ${task.reference} ${task.email}`
          .toLowerCase()
          .includes(filters.query.toLowerCase()),
    )
    .sort((a, b) =>
      filters.sort === 'newest'
        ? b.updatedAt.localeCompare(a.updatedAt)
        : rank[workflow(a)] - rank[workflow(b)] || b.updatedAt.localeCompare(a.updatedAt),
    )
}
