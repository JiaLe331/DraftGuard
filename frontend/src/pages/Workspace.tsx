import { useEffect, useRef, useState } from 'react'
import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FileTextIcon,
  CheckCircleIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  PrinterIcon,
  PencilSimpleIcon,
  WarningCircleIcon,
  CheckIcon,
  EnvelopeSimpleIcon,
  ArrowSquareOutIcon,
  FilesIcon,
} from '@phosphor-icons/react'
import { useDemo } from '../demo/context'
import {
  advanceRevision,
  canComplete,
  categoryLabels,
  completeTask,
  counts,
  currentVersion,
  effectiveValue,
  fieldLabels,
  finding,
  firstAttentionField,
  normalize,
  revisionDelta,
  summary,
  workflow,
  type FieldKey,
  type ReviewAction,
  type Role,
  type Task,
} from '../demo/model'
import { Avatar, Dialog, EmptyState, StatusBadge } from '../components/Primitives'
import { ReviewEditor } from '../components/ReviewEditor'
import { Report } from '../components/Report'

export function Workspace() {
  const { taskId } = useParams(),
    { tasks } = useDemo()
  const task = tasks.find((item) => item.id === taskId)
  if (!task)
    return (
      <div className="page">
        <EmptyState title="This task could not be found">
          <p>The sample may have been reset or the link is incorrect.</p>
          <Link className="button primary" to="/overview">
            Return to overview
          </Link>
        </EmptyState>
      </div>
    )
  return <TaskWorkspace key={task.id} task={task} />
}
function TaskWorkspace({ task }: { task: Task }) {
  const { tasks, update } = useDemo()
  const navigate = useNavigate(),
    location = useLocation()
  const [params, setParams] = useSearchParams()
  const requested = Number(params.get('revision') ?? task.currentRevision)
  const revision = task.revisions.some(
    (r) => r.number === requested && r.number <= task.currentRevision,
  )
    ? requested
    : task.currentRevision
  const version = currentVersion(task, revision),
    historical = revision !== task.currentRevision
  const selected =
    version.fields.find((f) => f.key === params.get('field')) ??
    version.fields.find((f) => f.key === firstAttentionField(task)) ??
    version.fields[0]
  const defaultRole =
    selected && (!selected.si.raw || /^(N\/A|TBA)$/.test(selected.si.raw) || selected.si.candidate)
      ? 'si'
      : 'bl'
  const role: Role =
    params.get('source') === 'si' ? 'si' : params.get('source') === 'bl' ? 'bl' : defaultRole
  const evidenceRef = useRef<HTMLElement>(null)
  const [editing, setEditing] = useState<{
    field: FieldKey
    role: Role
    action: ReviewAction
  } | null>(null)
  const [dirty, setDirty] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [completeOpen, setCompleteOpen] = useState(false)
  const blocker = useBlocker(dirty)
  const context = location.state as { from?: string; taskIds?: string[] } | null
  const from =
    context?.from?.startsWith('/inbox') || context?.from?.startsWith('/overview')
      ? context.from
      : '/overview'
  const queue =
    context?.taskIds ??
    tasks.filter((t) => !['other', 'completed'].includes(workflow(t))).map((t) => t.id)
  const nextId = queue
    .slice(queue.indexOf(task.id) + 1)
    .find((id) => tasks.some((t) => t.id === id && !['other', 'completed'].includes(workflow(t))))
  const resultCounts = counts(task, revision),
    delta = revisionDelta(task, revision)
  const isComparison = task.category === 'BL_COMPARISON'
  const canLoadNext = task.revisions.some((r) => r.number === task.currentRevision + 1)
  useEffect(() => {
    if (!dirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function goTo(values: Record<string, string>) {
    if (!dirty) setEditing(null)
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) next.set(key, value)
    setParams(next, { state: context, preventScrollReset: true })
  }
  function closeEdit() {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setEditing(null)
    setDirty(false)
  }
  function mutate(operation: () => Task, success: string) {
    try {
      update(operation())
      setError('')
      setMessage(success)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const fieldPriority = { NEEDS_REVIEW: 0, MISMATCH: 1, MATCH: 2 }
  const sortedFields = [...version.fields].sort(
    (a, b) => fieldPriority[finding(task, a, revision)] - fieldPriority[finding(task, b, revision)],
  )
  const editField = version.fields.find((f) => f.key === editing?.field)
  return (
    <div className="page workspace-page">
      <div className="workspace-breadcrumb">
        <Link to={from}>
          <ArrowLeftIcon size={17} />
          {from.startsWith('/inbox') ? 'Inbox' : 'Work queue'}
        </Link>
        <CaretRightIcon size={12} />
        <span>{task.reference}</span>
        <div className="breadcrumb-actions">
          {isComparison && (
            <button className="button compact" disabled={dirty} onClick={() => window.print()}>
              <PrinterIcon size={17} />
              Print report
            </button>
          )}
          <button
            className="button compact"
            disabled={!nextId}
            onClick={() => navigate(`/tasks/${nextId}`, { state: context })}
          >
            Next task
            <ArrowRightIcon size={16} />
          </button>
        </div>
      </div>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">
            {categoryLabels[task.category]} · {task.reference}
          </div>
          <h1>{task.subject}</h1>
          <div className="workspace-byline">
            <Avatar initials={task.initials} color={task.color} />
            <span>{task.sender}</span>
            <span className="dot-separator">·</span>
            <span>{task.route}</span>
          </div>
        </div>
        <div className="workspace-status">
          <>
            {historical ? (
              <span className="badge neutral">Historical revision</span>
            ) : (
              <StatusBadge status={workflow(task)} />
            )}
          </>
          <small>{task.isCopy ? 'Local working copy' : 'Original sample'}</small>
        </div>
      </div>
      <details className="email-context">
        <summary>
          <EnvelopeSimpleIcon size={18} />
          Email context<span>{task.email}</span>
          <CaretRightIcon size={16} />
        </summary>
        <div className="email-body">
          <p className="small-text">
            From: {task.sender} &lt;{task.email}&gt;
            <br />
            Subject: {task.subject}
          </p>
          <p className="preserve-lines">{task.body}</p>
          <div className="attachment-list">
            {version.documents.map((d) => (
              <span key={d.id}>
                <FileTextIcon size={18} />
                {d.filename}
              </span>
            ))}
          </div>
        </div>
      </details>
      {message && (
        <div className="notice success" role="status">
          <CheckCircleIcon size={18} />
          {message}
          <button className="text-button" onClick={() => setMessage('')}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      {!isComparison ? (
        <section className="panel classification-panel">
          <span className="stat-icon blue">
            <EnvelopeSimpleIcon size={25} />
          </span>
          <h2>Classified as {categoryLabels[task.category].toLowerCase()}</h2>
          <p>
            This email does not require an SI / BL comparison. Its original context is available
            above.
          </p>
          <span className="badge neutral">Team-authored classification</span>
        </section>
      ) : (
        <>
          <div className="version-bar">
            <div className="document-pair">
              {(['si', 'bl'] as const).map((side) => {
                const doc = version.documents.find((d) => d.role === side)
                return (
                  <span key={side}>
                    <FileTextIcon size={18} />
                    <strong>
                      {side === 'si' ? 'Shipping instruction' : 'Draft bill of lading'}
                    </strong>
                    <span className="version-chip">{doc ? `v${doc.version}` : 'Missing'}</span>
                  </span>
                )
              })}
            </div>
            <label className="version-picker">
              <ClockCounterClockwiseIcon size={17} />
              <span className="sr-only">View revision</span>
              <select value={revision} onChange={(e) => goTo({ revision: e.target.value })}>
                {task.revisions
                  .filter((r) => r.number <= task.currentRevision)
                  .map((r) => (
                    <option key={r.number} value={r.number}>
                      Revision {r.number}
                      {r.number === task.currentRevision ? ' · Current' : ' · Historical'}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {historical && (
            <div className="notice warning">
              Historical revision {revision} — read only. Completion and edits apply only to the
              current version.
              <button
                className="text-button"
                onClick={() => goTo({ revision: String(task.currentRevision) })}
              >
                Return to current
              </button>
            </div>
          )}
          {version.issue && (
            <div className="notice warning">
              <WarningCircleIcon size={22} />
              <div>
                <strong>{summary(task)}</strong>
                <p>
                  {version.issue === 'missing_attachment'
                    ? 'Provide the missing draft BL before this check can continue.'
                    : version.issue === 'wrong_doc_type'
                      ? 'Replace the invoice with the correct draft bill of lading.'
                      : 'Replace the unreadable draft with a usable source document.'}{' '}
                  File upload will be connected in a later milestone.
                </p>
              </div>
            </div>
          )}
          {delta && (
            <div className="revision-delta">
              <span>
                <CheckCircleIcon size={17} />
                {delta.resolved} resolved
              </span>
              <span>{delta.remaining} remaining</span>
              <span className={delta.introduced ? 'danger-text' : ''}>
                {delta.introduced} new {delta.introduced === 1 ? 'discrepancy' : 'discrepancies'}
              </span>
              {delta.uncertain > 0 && <span>{delta.uncertain} newly uncertain</span>}
            </div>
          )}
          <div className="verification-layout">
            <section className="panel comparison-panel" aria-labelledby="comparison-title">
              <div className="panel-heading">
                <div>
                  <h2 id="comparison-title">Seven fields. One clear picture.</h2>
                  <p>Select a value to inspect its source.</p>
                </div>
                <span className="count-pill">{version.fields.length} fields</span>
              </div>
              <div className="result-counts">
                <span className="success-text">
                  <CheckCircleIcon size={15} />
                  {resultCounts.MATCH} matched
                </span>
                <span className="danger-text">{resultCounts.MISMATCH} discrepancies</span>
                <span className="warning-text">{resultCounts.NEEDS_REVIEW} to review</span>
              </div>
              <div className="comparison-table" role="table" aria-label="Seven field comparison">
                <div className="comparison-grid comparison-head" role="row">
                  <span role="columnheader">FIELD</span>
                  <span role="columnheader">SI</span>
                  <span role="columnheader">DRAFT BL</span>
                  <span role="columnheader">FINDING</span>
                </div>
                <div role="rowgroup">
                  {sortedFields.map((field) => (
                    <div
                      className={`comparison-grid comparison-row ${field.key === selected?.key ? 'selected' : ''}`}
                      role="row"
                      key={field.key}
                    >
                      <strong role="rowheader">{fieldLabels[field.key]}</strong>
                      {(['si', 'bl'] as const).map((side) => (
                        <div role="cell" key={side}>
                          <span className="mobile-field-label">{side.toUpperCase()}</span>
                          <button
                            className={`field-value ${side === role && field.key === selected?.key ? 'active' : ''}`}
                            aria-label={`${fieldLabels[field.key]}, ${side.toUpperCase()}: ${effectiveValue(task, field, side, revision).value || 'Missing'}. View source`}
                            onClick={() => {
                              goTo({ field: field.key, source: side })
                              if (!dirty && window.matchMedia('(max-width: 1279px)').matches)
                                requestAnimationFrame(() => {
                                  evidenceRef.current?.scrollIntoView({ block: 'start' })
                                  evidenceRef.current?.focus({ preventScroll: true })
                                })
                            }}
                          >
                            {effectiveValue(task, field, side, revision).value || (
                              <span className="missing-value">Missing</span>
                            )}
                            <ArrowSquareOutIcon size={12} />
                          </button>
                          {effectiveValue(task, field, side, revision).review && (
                            <span className="reviewed-label">Reviewed value</span>
                          )}
                        </div>
                      ))}
                      <div role="cell">
                        <StatusBadge status={finding(task, field, revision)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="comparison-footer">
                <FilesIcon size={17} />
                <span>
                  Comparing the current source pair. All seven fields are checked on every revision.
                </span>
              </div>
            </section>
            <aside
              ref={evidenceRef}
              tabIndex={-1}
              className="panel evidence-panel"
              aria-labelledby="evidence-title"
            >
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">SOURCE EVIDENCE</div>
                  <h2 id="evidence-title">
                    {selected ? fieldLabels[selected.key] : 'Document source'}
                  </h2>
                </div>
                <span className="badge neutral">Sample source</span>
              </div>
              <div className="source-tabs" role="group" aria-label="Source document">
                <button
                  className={role === 'si' ? 'active' : ''}
                  aria-pressed={role === 'si'}
                  onClick={() => goTo({ source: 'si' })}
                >
                  Shipping instruction
                </button>
                <button
                  className={role === 'bl' ? 'active' : ''}
                  aria-pressed={role === 'bl'}
                  onClick={() => goTo({ source: 'bl' })}
                >
                  Draft BL
                </button>
              </div>
              {selected?.[role].evidence ? (
                <>
                  <div className="source-toolbar">
                    <FileTextIcon size={17} />
                    <span>{version.documents.find((d) => d.role === role)?.filename}</span>
                    <span>{selected[role].evidence.locator}</span>
                  </div>
                  <div className="source-canvas">
                    <div className="source-paper">
                      <div className="source-paper-heading">
                        <span>DOCUMENT SAMPLE</span>
                        <strong>
                          {role === 'si' ? 'SHIPPING INSTRUCTION' : 'DRAFT BILL OF LADING'}
                        </strong>
                      </div>
                      <div className="source-reference">Reference: {task.reference}</div>
                      {version.fields.map((field) => (
                        <div
                          className={`source-line ${selected.key === field.key ? 'highlighted' : ''}`}
                          key={field.key}
                        >
                          <span className="source-line-number">
                            {field[role].evidence?.locator.replace('Line ', '') ?? '—'}
                          </span>
                          <div>
                            <span>{fieldLabels[field.key]}</span>
                            <strong>{field[role].evidence?.value ?? 'No source value'}</strong>
                          </div>
                        </div>
                      ))}
                      <div className="source-paper-footer">
                        Team-authored text fixture · For UI demonstration
                      </div>
                    </div>
                  </div>
                  <div className="evidence-detail">
                    <div>
                      <span>Original value</span>
                      <strong>{selected[role].raw || 'Missing'}</strong>
                    </div>
                    <div>
                      <span>Normalized value</span>
                      <strong>
                        {normalize(
                          selected.key,
                          effectiveValue(task, selected, role, revision).value,
                        ) || 'Missing'}
                      </strong>
                    </div>
                    <div>
                      <span>Extraction</span>
                      <strong>
                        {selected[role].candidate ? 'AI candidate · sample' : 'Rule · sample'}
                      </strong>
                    </div>
                  </div>
                </>
              ) : (
                <div className="no-evidence">
                  <FileTextIcon size={36} />
                  <h3>No usable source</h3>
                  <p>A source document is needed to verify this value.</p>
                </div>
              )}
              {selected && !historical && !version.issue && (
                <div className="evidence-actions">
                  {selected[role].candidate &&
                    !effectiveValue(task, selected, role, revision).review && (
                      <>
                        <div className="notice warning">
                          <WarningCircleIcon size={17} />
                          AI candidate — confirm against source. This is an illustrative text
                          fixture.
                        </div>
                        <button
                          className="button primary full-width"
                          onClick={() => {
                            if (dirty) return
                            setEditing({ field: selected.key, role, action: 'confirm' })
                          }}
                          disabled={dirty}
                        >
                          <CheckIcon size={17} />
                          Confirm candidate
                        </button>
                      </>
                    )}
                  <div className="paired-actions">
                    <button
                      className="button"
                      disabled={dirty || !selected[role].evidence}
                      onClick={() => setEditing({ field: selected.key, role, action: 'correct' })}
                    >
                      <PencilSimpleIcon size={16} />
                      Correct extraction
                    </button>
                    <button
                      className="button"
                      disabled={dirty}
                      onClick={() => setEditing({ field: selected.key, role, action: 'supply' })}
                    >
                      Supply information
                    </button>
                  </div>
                </div>
              )}
              {editing && editField && !historical && (
                <ReviewEditor
                  key={`${editing.field}-${editing.role}-${editing.action}`}
                  task={task}
                  field={editField}
                  role={editing.role}
                  action={editing.action}
                  onClose={closeEdit}
                  onDirty={setDirty}
                  onSaved={() => {
                    setEditing(null)
                    setMessage(
                      'Saved in this browser. The seven-field comparison has been updated.',
                    )
                    setError('')
                  }}
                />
              )}
            </aside>
          </div>
          <div className="workspace-bottom">
            <div className="review-history">
              <details className="panel">
                <summary>
                  <ClockCounterClockwiseIcon size={19} />
                  Version history & review record
                  <span className="count-pill">{task.reviews.length}</span>
                </summary>
                <div className="history-content">
                  {task.revisions
                    .filter((r) => r.number <= task.currentRevision)
                    .map((r) => (
                      <div className="history-item" key={r.number}>
                        <span className="history-dot" />
                        <div>
                          <strong>
                            Revision {r.number}
                            {r.number === task.currentRevision ? ' · Current' : ' · Historical'}
                          </strong>
                          <p>
                            {r.documents
                              .map((d) => `${d.role.toUpperCase()} v${d.version}`)
                              .join(' / ')}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => goTo({ revision: String(r.number) })}
                          >
                            View revision
                          </button>
                        </div>
                      </div>
                    ))}
                  {task.reviews.map((r) => (
                    <div className="history-item" key={r.id}>
                      <span className="history-dot blue" />
                      <div>
                        <strong>
                          {fieldLabels[r.field]} · {r.role.toUpperCase()} · Revision {r.revision}
                        </strong>
                        <p>
                          {r.action === 'supply'
                            ? 'Supplied information — pending verification'
                            : r.action === 'confirm'
                              ? 'Candidate confirmed'
                              : 'Extraction corrected'}
                          : {r.value}
                        </p>
                        <p>{r.reason}</p>
                        <small>
                          {r.actor} · {new Date(r.createdAt).toLocaleString('en-GB')}
                        </small>
                      </div>
                    </div>
                  ))}
                  {task.completedRevision && (
                    <p>
                      <CheckCircleIcon size={16} /> Revision {task.completedRevision} completed by
                      Demo reviewer — unverified.
                    </p>
                  )}
                  {!task.reviews.length && (
                    <p className="muted-text">No field review actions yet.</p>
                  )}
                </div>
              </details>
              {task.id === '004' && (
                <div className="demo-revision">
                  <div>
                    <span className="eyebrow">TRY THE REVISION FLOW</span>
                    <p>
                      {task.currentRevision === 1
                        ? 'The next sample fixes the names, but introduces a new weight discrepancy.'
                        : task.currentRevision === 2
                          ? 'The final sample corrects the weight. Check every field again.'
                          : 'All sample revisions are loaded. Earlier results remain in history.'}
                    </p>
                  </div>
                  {canLoadNext && (
                    <button
                      className="button"
                      disabled={dirty || historical}
                      onClick={() => {
                        mutate(
                          () => advanceRevision(task),
                          'Sample revision loaded. Previous completion does not apply.',
                        )
                        setEditing(null)
                      }}
                    >
                      Load sample BL v{task.currentRevision + 1}
                      <ArrowRightIcon size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <section className="completion-panel">
              <div
                className={`completion-icon ${!historical && canComplete(task) ? 'success' : ''}`}
              >
                <CheckCircleIcon size={27} />
              </div>
              <div>
                <h3>
                  {historical
                    ? 'Historical version · read only'
                    : workflow(task) === 'completed'
                      ? 'This version is reviewed.'
                      : canComplete(task)
                        ? 'Ready for your final review.'
                        : 'A few details still need you.'}
                </h3>
                <p>
                  {historical
                    ? 'This report belongs to an earlier source pair. Return to the current version to complete a review.'
                    : canComplete(task)
                      ? 'Seven fields match with no pending requirements.'
                      : 'Resolve discrepancies and confirm uncertain values before completing this check.'}
                </p>
                <button
                  className="button primary"
                  disabled={
                    historical || dirty || !canComplete(task) || workflow(task) === 'completed'
                  }
                  onClick={() => setCompleteOpen(true)}
                >
                  <CheckIcon size={17} />
                  {historical
                    ? 'Historical · read only'
                    : workflow(task) === 'completed'
                      ? 'Review completed'
                      : 'Complete review'}
                </button>
              </div>
            </section>
          </div>
          <p className="workspace-disclaimer">
            Seven-field comparison only. Completion does not authorize cargo release or constitute
            legal approval.
          </p>
          <Report task={task} revision={revision} />
        </>
      )}
      {blocker.state === 'blocked' && (
        <Dialog title="Leave without saving?" onClose={() => blocker.reset()}>
          <p>Your changes have not been saved. Stay to finish the review, or discard this edit.</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => blocker.reset()}>
              Keep editing
            </button>
            <button
              className="button primary"
              onClick={() => {
                setDirty(false)
                setEditing(null)
                blocker.proceed()
              }}
            >
              Discard & leave
            </button>
          </div>
        </Dialog>
      )}
      {completeOpen && (
        <Dialog title="Complete this review?" onClose={() => setCompleteOpen(false)}>
          <p>
            Confirm that you reviewed all seven fields for SI v
            {version.documents.find((d) => d.role === 'si')?.version} and BL v
            {version.documents.find((d) => d.role === 'bl')?.version}.
          </p>
          <p className="small-text">
            Recorded as Demo reviewer — unverified. Applies only to this source version.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setCompleteOpen(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                mutate(() => completeTask(task), 'Review completed. Saved in this browser.')
                setCompleteOpen(false)
              }}
            >
              Confirm completion
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
