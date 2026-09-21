import { AnalysisActivity } from '../components/AnalysisActivity'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeftIcon,
  PrinterIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  FileTextIcon,
  EnvelopeSimpleIcon,
  PencilSimpleIcon,
  SparkleIcon,
  InfoIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { ApiError, recordPath, request, taskPath, useResource } from '../mailbox/api'
import { useMailbox } from '../mailbox/context'
import { useAnalysis } from '../mailbox/useAnalysis'
import {
  analyzedAt,
  categoryLabels,
  fieldLabels,
  type SampleDetail,
  type FieldResult,
  type Extraction,
  type FieldKey,
  type DocumentVersion,
} from '../mailbox/types'
import type { Health } from '../extraction/api'
import { Dialog, EmptyState, StatusBadge } from '../components/Primitives'
import { Report } from '../components/Report'
import { CloneTask, TaskSources, RevisionChanges } from '../components/TaskSources'
import { DocumentPreview } from '../components/DocumentPreview'
import { InlinePdfPage } from '../components/InlinePdfPage'
import { AmendmentEmail } from '../components/AmendmentEmail'

export function Workspace() {
  const { taskId } = useParams()
  const { refresh } = useMailbox()
  const [params] = useSearchParams()
  const runId = params.get('run')
  const path = recordPath(taskId ?? '')
  const { data, error, reload } = useResource<SampleDetail>(
    runId ? `${path}/runs/${encodeURIComponent(runId)}` : path,
  )
  const completedRunId = data?.latest_run?.status !== 'RUNNING' ? data?.latest_run?.id : undefined
  useEffect(() => {
    if (completedRunId) refresh()
  }, [completedRunId, refresh])
  useEffect(() => {
    if (data?.latest_run?.status !== 'RUNNING') return
    const timer = setTimeout(reload, 1000)
    return () => clearTimeout(timer)
  }, [data?.latest_run?.status, reload])
  if (error)
    return (
      <div className="page">
        <EmptyState
          title={
            error.status === 404
              ? 'This email could not be found'
              : 'The workspace could not be loaded'
          }
        >
          <p role="alert">{error.message}</p>
          <button className="button" onClick={reload}>
            Retry connection
          </button>{' '}
          <Link className="button" to="/inbox">
            Return to inbox
          </Link>
        </EmptyState>
      </div>
    )
  if (!data)
    return (
      <div className="page" role="status">
        Opening workspace…
      </div>
    )
  return (
    <TaskWorkspace
      key={
        data.id +
        ':' +
        data.revision +
        ':' +
        runId +
        ':' +
        data.latest_run?.id +
        ':' +
        (data.current_run?.review_actions?.length ?? 0) +
        ':' +
        (data.amendment_draft?.updated_at ?? '')
      }
      task={data}
      reload={reload}
    />
  )
}
function TaskWorkspace({ task: initial, reload }: { task: SampleDetail; reload: () => void }) {
  const { refresh } = useMailbox()
  const health = useResource<Health>('/api/health')
  const auditEnabled = !!health.data?.capabilities?.development_extraction
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const [preview, setPreview] = useState<{ id: string; page?: number } | null>(null)
  const {
    task,
    phase,
    savedResult,
    error,
    analyze: reanalyze,
    replaceTask,
    busy,
  } = useAnalysis(initial, refresh)
  const [allAttachments, setAllAttachments] = useState(false)
  const evidenceRef = useRef<HTMLElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (phase === 'revealed') summaryRef.current?.focus({ preventScroll: true })
  }, [phase])
  useEffect(() => {
    if ((location.state as { focusHeading?: boolean } | null)?.focusHeading)
      headingRef.current?.focus({ preventScroll: true })
  }, [location.state])
  const localTask = task.record_kind === 'task'
  const historical = !!task.is_historical || !!params.get('run')
  const machineResult = task.current_run?.result
  const result = task.current_run?.reviewed_result ?? machineResult
  const fields = result?.fields ?? []
  const field =
    fields.find((f) => f.key === params.get('field')) ??
    fields.find((f) => f.finding !== 'MATCH') ??
    fields[0]
  const role = params.get('source') === 'si' ? 'si' : 'bl'
  const parsed = result?.documents ?? []
  const roleDocument = parsed.find((d) => d.role === role)
  const document =
    task.documents.find((d) => d.id === params.get('document')) ??
    task.documents.find((d) => d.id === roleDocument?.id) ??
    (parsed.every((d) => !d.role) ? task.documents[0] : undefined)
  const source = parsed.find((d) => d.id === document?.id)
  const machineField = machineResult?.fields.find((item) => item.key === field?.key)
  const selectedRole = source?.role === 'si' || source?.role === 'bl' ? source.role : null
  const machineExtraction = selectedRole ? machineField?.[selectedRole] : undefined
  const effectiveExtraction = selectedRole ? field?.[selectedRole] : undefined
  const fieldEvidence = field
    ? [...field.si.evidence, ...field.bl.evidence].filter((e) => e.document_id === document?.id)
    : []
  const fromState = (location.state as { from?: string } | null)?.from
  const from = fromState && /^\/(overview|inbox)(\?|$)/.test(fromState) ? fromState : '/overview'
  function select(field: FieldResult, role: 'si' | 'bl') {
    const next = new URLSearchParams(params)
    next.set('field', field.key)
    next.set('source', role)
    next.delete('document')
    setParams(next, { replace: true, state: location.state, preventScrollReset: true })
    evidenceRef.current?.scrollIntoView({ block: 'nearest' })
    evidenceRef.current?.focus({ preventScroll: true })
  }
  function showReport(show: boolean) {
    const next = new URLSearchParams(params)
    if (show) next.set('report', '1')
    else next.delete('report')
    setParams(next, { state: location.state })
  }
  if (params.get('report') === '1' && result)
    return (
      <div className="page workspace-page">
        <div className="report-preview-toolbar">
          <button className="button" onClick={() => showReport(false)}>
            <ArrowLeftIcon size={16} />
            Back to workspace
          </button>
          <button className="button primary" onClick={() => window.print()}>
            <PrinterIcon size={16} />
            Print / Save PDF
          </button>
        </div>
        <Report task={{ ...task, is_historical: historical }} preview />
      </div>
    )
  const comparison = task.category === 'BL_COMPARISON'
  const processing = busy || (phase !== 'failed' && task.latest_run?.status === 'RUNNING')
  return (
    <div className={`page workspace-page ${phase === 'revealed' ? 'analysis-revealed' : ''}`}>
      <div className="workspace-breadcrumb">
        <Link to={from}>
          <ArrowLeftIcon size={17} />
          Work queue
        </Link>
        <span>{task.id}</span>
        <div className="breadcrumb-actions">
          {auditEnabled && task.latest_run?.audit_run_id && (
            <Link className="button compact" to={`/audit/runs/${task.latest_run.audit_run_id}`}>
              {task.latest_run.status === 'RUNNING' ? 'View live audit' : 'View audit trail'}
            </Link>
          )}
          <button className="button compact" onClick={reload} disabled={busy}>
            Refresh
          </button>
          <button
            className="button compact"
            disabled={!result || processing}
            onClick={() => showReport(true)}
          >
            <PrinterIcon size={16} />
            Print report
          </button>
          {result && localTask && !historical && (
            <button
              className="button primary compact"
              disabled={processing}
              onClick={() => reanalyze()}
            >
              <ArrowClockwiseIcon
                size={16}
                className={phase === 'running' ? 'analysis-spinner' : undefined}
              />
              {phase === 'preparing'
                ? 'Preparing results…'
                : processing
                  ? 'Analyzing…'
                  : 'Reanalyze'}
            </button>
          )}
        </div>
      </div>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">{task.id} · DOCUMENT WORKSPACE</div>
          <h1 ref={headingRef} tabIndex={-1}>
            {task.subject}
          </h1>
          <div className="workspace-byline">
            {task.sender} ·{' '}
            {task.category
              ? categoryLabels[task.category]
              : !task.latest_run
                ? 'Not classified yet'
                : 'Needs classification review'}
          </div>
        </div>
        <div className="workspace-status">
          <StatusBadge
            status={
              phase === 'preparing'
                ? task.workflow_state
                : processing
                  ? 'RUNNING'
                  : task.workflow_state
            }
          />
          <small>Last analyzed: {analyzedAt(task.last_analyzed)}</small>
        </div>
      </div>
      {error && (
        <div className="notice danger" role="alert">
          {error} Use Refresh to check whether the analysis was saved.
        </div>
      )}
      {historical && (
        <div className="notice warning">
          <strong>Historical result · Read only</strong>
          <Link className="button" to={`/tasks/${task.id}`}>
            Return to current revision
          </Link>
        </div>
      )}
      {!localTask && (
        <div className="notice read-only-notice" role="status">
          <ShieldCheckIcon size={20} aria-hidden="true" />
          <div>
            <strong>Read-only sample</strong>
            <p>Create a local working copy to analyze, replace sources, review, or complete.</p>
          </div>
        </div>
      )}
      {localTask && !historical && (
        <TaskSources
          key={`${task.revision}:${task.current_si_id}:${task.current_bl_id}`}
          task={task}
          disabled={processing}
          onSaved={reanalyze}
          reload={reload}
        />
      )}
      {!localTask && health.data?.capabilities?.development_tasks && (
        <CloneTask sample={task} disabled={processing} />
      )}
      <section
        className={`analysis-workbench ${phase === 'running' ? 'is-running' : phase === 'preparing' ? 'is-preparing' : ''}`}
        aria-labelledby="analysis-title"
      >
        <div className="analysis-files">
          <h2 id="analysis-title">{!result ? 'Analyze this email' : 'Source attachments'}</h2>
          <p className="analysis-file-count">
            {task.documents.length
              ? `${task.documents.length} attachment${task.documents.length === 1 ? '' : 's'}`
              : 'No attachments · Email classification only'}
          </p>
          <div className="analysis-file-list">
            {(allAttachments ? task.documents : task.documents.slice(0, 2)).map((doc) => (
              <button
                className="analysis-file"
                key={doc.id}
                onClick={() => setPreview({ id: doc.id })}
              >
                <span className="analysis-file-icon">
                  <FileTextIcon size={22} />
                  <span className="file-scan" aria-hidden="true" />
                </span>
                <span className="analysis-file-info">
                  <strong>{doc.filename}</strong>{' '}
                  <small>
                    {doc.filename.split('.').pop()?.toUpperCase()} ·{' '}
                    {doc.byte_count < 1024
                      ? `${doc.byte_count} B`
                      : `${(doc.byte_count / 1024).toFixed(1)} KB`}
                  </small>
                </span>
              </button>
            ))}
            {!task.documents.length && <EnvelopeSimpleIcon size={26} aria-hidden="true" />}
          </div>
          {task.documents.length > 2 && (
            <button className="button compact" onClick={() => setAllAttachments(!allAttachments)}>
              {allAttachments
                ? 'Show fewer attachments'
                : `Show all attachments (${task.documents.length})`}
            </button>
          )}
        </div>
        <div className="analysis-action">
          {processing && (
            <AnalysisActivity
              savedResult={savedResult?.result ?? null}
              hasAttachments={task.documents.length > 0}
            />
          )}
          {!result && localTask && !historical && (
            <button className="button primary" onClick={() => reanalyze()} disabled={processing}>
              {processing
                ? phase === 'preparing'
                  ? 'Preparing results…'
                  : 'Analyzing…'
                : phase === 'failed' || task.latest_run?.status === 'FAILED'
                  ? 'Retry analysis'
                  : 'Start analysis'}
            </button>
          )}
        </div>
      </section>
      {result && (processing || phase === 'failed') && (
        <p className="previous-result-label">Previous result · Last saved analysis</p>
      )}
      {phase === 'revealed' && result && (
        <div className="analysis-summary" role="status" ref={summaryRef} tabIndex={-1}>
          <strong>Analysis saved</strong>
          <span>
            {task.category ? categoryLabels[task.category] : 'Needs classification review'}
            {task.category === 'BL_COMPARISON'
              ? ` · ${result.known_defect_fields.length} discrepancies · ${result.review_requirements.length} review requirements`
              : ''}
          </span>
          <small>{analyzedAt(task.last_analyzed)}</small>
        </div>
      )}
      {task.latest_run?.status === 'FAILED' && (
        <div className="notice danger" role="alert">
          <div>
            <strong>
              <span>Latest analysis failed</span>
              {task.latest_run.error?.code ? ` · ${task.latest_run.error.code}` : ''}
            </strong>
            <p>
              {task.latest_run.error?.message}{' '}
              {task.latest_run.error?.retryable === false
                ? 'This failure is not retryable without changing the input or configuration. '
                : 'This failure is retryable. '}
              {result
                ? 'The last successful result is retained below.'
                : 'No successful result is available.'}
            </p>
          </div>
          {localTask && !historical && task.latest_run.error?.retryable !== false && (
            <button className="button" disabled={processing} onClick={() => reanalyze()}>
              Retry analysis
            </button>
          )}
        </div>
      )}
      <details className="email-context" open={!comparison}>
        <summary>
          <EnvelopeSimpleIcon size={17} />
          Original email<span>{task.attachment_count} attachments</span>
        </summary>
        <div className="email-body">
          <p className="preserve-lines">{task.body}</p>
        </div>
      </details>
      <div className="version-bar">
        <div className="document-pair">
          <span>
            Source revision <strong>{task.revision}</strong>
          </span>
          <span>
            {task.current_run?.mode === 'precomputed'
              ? 'Precomputed · Rules'
              : task.current_run
                ? result?.provider_calls?.length
                  ? 'On demand · Rules + AI extraction'
                  : 'On demand · Rules'
                : 'Not analyzed'}
          </span>
        </div>
        <span className="small-text">{task.current_run?.pipeline_version} · Saved locally</span>
      </div>
      <RevisionChanges task={task} />
      {!!task.current_run?.review_progress?.total && (
        <div className="notice ai-review-progress" aria-live="polite">
          <SparkleIcon size={18} aria-hidden="true" />
          <div>
            <strong>
              AI candidates · {task.current_run.review_progress.reviewed}/
              {task.current_run.review_progress.total} reviewed
            </strong>
            <p>
              Confirm each candidate against its source page, or correct the extraction. A field is
              compared only after both SI and BL values are reviewed.
            </p>
          </div>
        </div>
      )}
      {result?.review_requirements
        .filter(
          (problem) =>
            !['AI_CONFIRMATION_REQUIRED', 'AI_CANDIDATE_MISSING', 'unresolved_fields'].includes(
              problem.code,
            ),
        )
        .map((problem, i) => (
          <div className="notice warning" key={`${problem.code}-${i}`}>
            <div>
              <strong>
                {problem.code === 'visual_extraction_required'
                  ? 'Visual extraction required'
                  : problem.code.replaceAll('_', ' ')}
              </strong>
              <p>{problem.message}</p>
            </div>
          </div>
        ))}
      {result && !comparison && (
        <section className="panel classification-panel">
          <h2>{task.category ? 'Email classified' : 'Needs classification review'}</h2>
          <p>{result.classification.reason}</p>
          <p>
            {task.category
              ? 'This category does not enter the SI / BL comparison workflow.'
              : 'No document check is marked complete. Classification still requires human review.'}
          </p>
        </section>
      )}
      {comparison && (
        <div className="verification-layout">
          <section className="comparison-panel panel" aria-labelledby="comparison-heading">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">SOURCE-BACKED COMPARISON</div>
                <h2 id="comparison-heading">Seven fields. Both sources.</h2>
                <p>Select a value to inspect its evidence.</p>
              </div>
            </div>
            <div className="result-counts">
              <span>{result?.coverage.checked ?? 0}/7 checked</span>
              <span>{result?.known_defect_fields.length ?? 0} discrepancies</span>
              <span>{fields.filter((f) => f.finding === 'NEEDS_REVIEW').length} need review</span>
            </div>
            <div role="table" aria-label="Seven-field comparison">
              <div className="comparison-head comparison-grid" role="row">
                {['FIELD', 'SHIPPING INSTRUCTION', 'DRAFT BILL OF LADING', 'FINDING'].map(
                  (label) => (
                    <span key={label} role="columnheader">
                      {label}
                    </span>
                  ),
                )}
              </div>
              {fields.map((f) => (
                <div
                  className={`comparison-row comparison-grid ${field?.key === f.key ? 'selected' : ''}`}
                  role="row"
                  key={f.key}
                >
                  <strong role="rowheader">{fieldLabels[f.key]}</strong>
                  {(['si', 'bl'] as const).map((side) => (
                    <div role="cell" key={side}>
                      <span className="mobile-field-label">{side.toUpperCase()}</span>
                      <button
                        className="field-value"
                        onClick={() => select(f, side)}
                        aria-label={`Inspect ${side.toUpperCase()} ${fieldLabels[f.key]}`}
                      >
                        {f[side].raw_value ?? 'No usable value'}
                      </button>
                      <small className="normalized-value">
                        Normalized: {f[side].normalized_value ?? 'Not established'}
                      </small>
                      <CandidateState
                        machine={machineResult?.fields.find((item) => item.key === f.key)?.[side]}
                        effective={f[side]}
                      />
                      {f[side].supplied_information && (
                        <span className="candidate-state supplied">
                          <InfoIcon size={14} aria-hidden="true" /> Supplied externally · unresolved
                        </span>
                      )}
                    </div>
                  ))}
                  <div role="cell">
                    <StatusBadge status={f.finding} />
                  </div>
                </div>
              ))}
            </div>
            {!fields.length && (
              <div className="no-evidence">Run analysis to populate this comparison.</div>
            )}
          </section>
          <section
            className="evidence-panel panel"
            ref={evidenceRef}
            tabIndex={-1}
            aria-label="Source evidence"
          >
            <div className="panel-heading">
              <div>
                <div className="eyebrow">SOURCE EVIDENCE</div>
                <h2>{field ? fieldLabels[field.key] : 'Original document'}</h2>
              </div>
            </div>
            <div className="source-tabs">
              {(['si', 'bl'] as const).map((side) => (
                <button
                  key={side}
                  className={source?.role === side ? 'active' : ''}
                  aria-pressed={source?.role === side}
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    next.set('source', side)
                    next.delete('document')
                    setParams(next, { replace: true, state: location.state })
                  }}
                >
                  {side === 'si' ? 'Shipping instruction' : 'Draft BL'}
                </button>
              ))}
            </div>
            <div className="source-toolbar">
              <label>
                Attachment
                <select
                  aria-label="Source attachment"
                  value={document?.id ?? ''}
                  onChange={(e) => {
                    const next = new URLSearchParams(params)
                    next.set('document', e.target.value)
                    setParams(next, { replace: true, state: location.state })
                  }}
                >
                  {!document && (
                    <option value="">
                      {task.documents.length ? 'Choose an attachment' : 'No attachment'}
                    </option>
                  )}
                  {task.documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.filename} · v{doc.version}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="source-canvas">
              <div className="source-paper actual-source">
                {document?.filename.toLowerCase().endsWith('.pdf') &&
                  machineExtraction?.method === 'gemini_vision' && (
                    <InlinePdfPage
                      emailId={task.id}
                      document={document}
                      page={
                        effectiveExtraction?.evidence[0]?.page ??
                        machineExtraction.evidence[0]?.page ??
                        1
                      }
                    />
                  )}
                {machineExtraction?.method === 'gemini_vision' && (
                  <div className="candidate-detail">
                    <span className="candidate-kicker">
                      <SparkleIcon size={15} aria-hidden="true" /> AI candidate — confirm against
                      source
                    </span>
                    <dl>
                      <div>
                        <dt>Machine value</dt>
                        <dd>{machineExtraction.raw_value ?? 'No candidate proposed'}</dd>
                      </div>
                      <div>
                        <dt>Backend normalized</dt>
                        <dd>{machineExtraction.normalized_value ?? 'Not established'}</dd>
                      </div>
                      <div>
                        <dt>Candidate page</dt>
                        <dd>{machineExtraction.evidence[0]?.page ?? 'Not supplied'}</dd>
                      </div>
                    </dl>
                  </div>
                )}
                {effectiveExtraction?.supplied_information && (
                  <SuppliedInformation action={effectiveExtraction.supplied_information} />
                )}
                {fieldEvidence.length > 0 && (
                  <div className="evidence-excerpts">
                    {fieldEvidence.map((e) => (
                      <blockquote key={e.id}>
                        <strong>
                          {e.locator} ·{' '}
                          {e.verification_source === 'human_visual'
                            ? 'Human visual review'
                            : e.verification_source === 'ai_visual_candidate'
                              ? 'Unconfirmed AI visual candidate'
                              : 'Verified text evidence'}
                        </strong>
                        <pre>{e.excerpt}</pre>
                      </blockquote>
                    ))}
                  </div>
                )}
                {!fieldEvidence.length && (
                  <p className="notice warning">
                    No verified evidence for this field in the selected attachment.
                  </p>
                )}
                {source?.error && <p className="notice warning">{source.error.message}</p>}
                {document && (
                  <button
                    className="button compact"
                    onClick={() => setPreview({ id: document.id, page: fieldEvidence[0]?.page })}
                  >
                    Open original{fieldEvidence[0]?.page ? ` · page ${fieldEvidence[0].page}` : ''}
                  </button>
                )}
                {!!source?.units.length && (
                  <details className="source-transcript">
                    <summary>
                      Extracted document content ({source.units.length} source units)
                    </summary>
                    {source.units.map((unit) => (
                      <div
                        key={unit.id}
                        className={`source-unit ${fieldEvidence.some((e) => e.id === unit.id) ? 'highlighted' : ''}`}
                      >
                        <small>{unit.locator}</small>
                        <pre>{unit.text}</pre>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            </div>
            <div className="evidence-detail">
              <div>
                <span>Source role</span>
                <strong>{source?.role?.toUpperCase() ?? 'Not established'}</strong>
              </div>
              <div>
                <span>Value state</span>
                <strong>
                  {source?.role === 'si' || source?.role === 'bl'
                    ? (field?.[source.role].value_state ?? 'Not checked')
                    : 'Not checked'}
                </strong>
              </div>
              <div>
                <span>Rule / reason</span>
                <strong>
                  {source?.role === 'si' || source?.role === 'bl'
                    ? (field?.[source.role].reason.replaceAll('_', ' ') ?? 'Not checked')
                    : 'Not checked'}
                </strong>
              </div>
            </div>
            {localTask && field && document && machineExtraction && (
              <ReviewControls
                key={`${document.id}:${field.key}`}
                task={task}
                field={field.key}
                document={document}
                machine={machineExtraction}
                effective={effectiveExtraction ?? machineExtraction}
                pageCount={Math.max(1, ...(source?.units.map((unit) => unit.page ?? 1) ?? [1]))}
                sourceUnits={source?.units ?? []}
                historical={historical}
                onRefresh={reload}
                onSaved={(next) => {
                  replaceTask(next)
                  refresh()
                }}
              />
            )}
            {localTask &&
              field &&
              document &&
              machineExtraction &&
              ['MISSING', 'AMBIGUOUS', 'UNREADABLE'].includes(machineExtraction.value_state) && (
                <SupplyControls
                  key={`supply:${document.id}:${field.key}`}
                  task={task}
                  field={field.key}
                  document={document}
                  effective={effectiveExtraction ?? machineExtraction}
                  historical={historical}
                  onRefresh={reload}
                  onSaved={(next) => {
                    replaceTask(next)
                    refresh()
                  }}
                />
              )}
          </section>
        </div>
      )}
      {preview && task.documents.some((doc) => doc.id === preview.id) && (
        <DocumentPreview
          key={preview.id}
          emailId={task.id}
          document={task.documents.find((doc) => doc.id === preview.id)!}
          parsed={parsed.find((doc) => doc.id === preview.id)}
          initialPage={preview.page}
          onClose={() => setPreview(null)}
        />
      )}
      {localTask && (
        <label className="history-selector">
          View analysis version
          <select
            value={params.get('run') ?? ''}
            onChange={(event) => {
              const next = new URLSearchParams(params)
              if (event.target.value) next.set('run', event.target.value)
              else next.delete('run')
              next.delete('report')
              setParams(next)
            }}
          >
            <option value="">Current task</option>
            {task.runs
              .filter((run) => run.status === 'SUCCEEDED')
              .map((run) => (
                <option key={run.id} value={run.id}>
                  Revision {run.revision} · {analyzedAt(run.finished_at)} · {run.id}
                </option>
              ))}
          </select>
        </label>
      )}
      <AmendmentEmail
        task={task}
        historical={historical}
        disabled={processing}
        onSaved={(next) => {
          replaceTask(next)
          refresh()
        }}
      />
      <div className="workspace-bottom">
        <section className="panel review-history">
          <details>
            <summary>Analysis history · {task.runs.length} runs</summary>
            <div className="history-content">
              {task.runs.map((run) => (
                <div className="history-item" key={run.id}>
                  <span className="history-dot" />
                  <div>
                    <strong>
                      {run.status} · Source revision {run.revision}
                    </strong>
                    <p>
                      {run.mode === 'precomputed' ? 'Precomputed' : 'On demand'} ·{' '}
                      {run.pipeline_version} · {analyzedAt(run.finished_at)}
                    </p>
                    <small>
                      Run {run.id}
                      {run.id === task.current_run?.id
                        ? ' · Current saved result'
                        : ' · Not the current result'}
                    </small>
                    {auditEnabled && run.audit_run_id ? (
                      <Link to={`/audit/runs/${run.audit_run_id}`}>Open this run’s audit</Link>
                    ) : !run.audit_run_id ? (
                      <small>Legacy analysis · no live audit was recorded</small>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </details>
          {!!task.current_run?.review_actions?.length && (
            <details>
              <summary>Review activity · {task.current_run.review_actions.length} actions</summary>
              <div className="history-content">
                {[...task.current_run.review_actions].reverse().map((action) => (
                  <div className="history-item" key={action.id}>
                    <span className="history-dot" />
                    <div>
                      <strong>
                        {action.action === 'CORRECT_EXTRACTION'
                          ? 'Corrected'
                          : action.action === 'SUPPLY_INFORMATION'
                            ? 'Supplied information'
                            : 'Confirmed'}{' '}
                        · {fieldLabels[action.field]}
                      </strong>
                      <p>
                        {action.page
                          ? `Page ${action.page}`
                          : `${action.provenance_source} · ${action.provenance_reference}`}{' '}
                        · {action.actor}
                      </p>
                      <small>{analyzedAt(action.created_at)}</small>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
        {localTask && (
          <CompletionPanel
            task={task}
            historical={historical}
            onRefresh={reload}
            onSaved={(next) => {
              replaceTask(next)
              refresh()
            }}
          />
        )}
      </div>
      <p className="workspace-disclaimer">
        {localTask ? 'Local working copy' : 'Demo mailbox · Provided dataset'}. This seven-field
        check is not a complete bill-of-lading approval.
      </p>
      {result && <Report task={{ ...task, is_historical: historical }} />}
    </div>
  )
}

function CandidateState({ machine, effective }: { machine?: Extraction; effective: Extraction }) {
  if (effective.review?.action === 'CORRECT_EXTRACTION')
    return (
      <span className="candidate-state reviewed">
        <PencilSimpleIcon size={14} aria-hidden="true" /> Corrected
      </span>
    )
  if (effective.review?.action === 'CONFIRM_CANDIDATE')
    return (
      <span className="candidate-state reviewed">
        <CheckCircleIcon size={14} aria-hidden="true" /> Confirmed
      </span>
    )
  if (effective.method === 'human')
    return (
      <span className="candidate-state reviewed">
        <PencilSimpleIcon size={14} aria-hidden="true" /> Human corrected
      </span>
    )
  if (machine?.method === 'gemini_vision')
    return (
      <span className="candidate-state pending">
        <SparkleIcon size={14} aria-hidden="true" /> AI visual candidate · Confirmation required
      </span>
    )
  if (machine?.method === 'gemini_text')
    return (
      <span className="candidate-state ai-text">
        <SparkleIcon size={14} aria-hidden="true" /> AI text extracted
      </span>
    )
  return (
    <span className="candidate-state rule">
      <FileTextIcon size={14} aria-hidden="true" /> Rule extracted
    </span>
  )
}

function SuppliedInformation({
  action,
}: {
  action: NonNullable<Extraction['supplied_information']>
}) {
  const reference = action.provenance_reference ?? ''
  const safeUrl = /^https:\/\/[^\s]+$/i.test(reference)
  return (
    <div className="supplied-information">
      <div className="eyebrow">EXTERNAL INFORMATION · UNVERIFIED</div>
      <dl>
        <div>
          <dt>Supplied value</dt>
          <dd>{action.raw_value}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{action.provenance_source}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>
            {safeUrl ? (
              <a href={reference} target="_blank" rel="noreferrer">
                {reference}
              </a>
            ) : (
              reference
            )}
          </dd>
        </div>
      </dl>
      {action.provenance_note && <p>{action.provenance_note}</p>}
      <small>Recorded for handover; this does not resolve the source value.</small>
    </div>
  )
}

function SupplyControls({
  task,
  field,
  document,
  effective,
  historical,
  onRefresh,
  onSaved,
}: {
  task: SampleDetail
  field: FieldKey
  document: DocumentVersion
  effective: Extraction
  historical: boolean
  onRefresh: () => void
  onSaved: (task: SampleDetail) => void
}) {
  const existing = effective.supplied_information
  const [editing, setEditing] = useState(false)
  const [rawValue, setRawValue] = useState(existing?.raw_value ?? '')
  const [sourceName, setSourceName] = useState(existing?.provenance_source ?? '')
  const [reference, setReference] = useState(existing?.provenance_reference ?? '')
  const [note, setNote] = useState(existing?.provenance_note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  if (historical || task.current_run?.completion) return null

  async function save(event: FormEvent) {
    event.preventDefault()
    const runId = task.current_run?.id
    if (!runId || busy) return
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const next = await request<SampleDetail>(`${taskPath(task.id)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_revision: task.revision,
          run_id: runId,
          document_id: document.id,
          field,
          action: 'SUPPLY_INFORMATION',
          raw_value: rawValue,
          provenance: { source_name: sourceName, reference, note: note.trim() || undefined },
        }),
      })
      onSaved(next)
      setEditing(false)
      setSaved('Supplied information recorded. The source value remains unresolved.')
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="evidence-actions supply-actions">
      <button
        className="button"
        aria-expanded={editing}
        onClick={() => {
          setEditing((value) => !value)
          setError('')
        }}
      >
        <InfoIcon size={16} aria-hidden="true" />
        {existing ? 'Update supplied information' : 'Supply information'}
      </button>
      <p className="candidate-help">
        Recorded for handover; does not resolve this field or permit completion.
      </p>
      {editing && (
        <form className="review-editor" onSubmit={(event) => void save(event)}>
          <div className="editor-heading">
            <div>
              <div className="eyebrow">EXTERNAL INFORMATION</div>
              <h3>Record supplied information</h3>
            </div>
          </div>
          <label className="form-field">
            Supplied value
            <textarea
              required
              rows={3}
              maxLength={5000}
              value={rawValue}
              onChange={(event) => setRawValue(event.target.value)}
            />
          </label>
          <label className="form-field">
            Source name
            <input
              required
              maxLength={200}
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
            />
          </label>
          <label className="form-field">
            Checkable reference or HTTPS URL
            <input
              required
              maxLength={1000}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label className="form-field">
            Note <span className="optional-label">Optional</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error && <ReviewError message={error} onRefresh={onRefresh} />}
          <div className="editor-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !rawValue.trim() || !sourceName.trim() || !reference.trim()}
            >
              {busy ? 'Recording…' : 'Record for handover'}
            </button>
          </div>
        </form>
      )}
      <p className="review-announcement" aria-live="polite">
        {saved}
      </p>
    </div>
  )
}

function CompletionPanel({
  task,
  historical,
  onRefresh,
  onSaved,
}: {
  task: SampleDetail
  historical: boolean
  onRefresh: () => void
  onSaved: (task: SampleDetail) => void
}) {
  const run = task.current_run
  const result = run?.reviewed_result ?? run?.result
  const eligibility = run?.completion_eligibility
  const completion = run?.completion
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supplied = run?.review_progress?.supplied ?? 0
  const checks = [
    {
      label: 'Documents',
      passed: !!task.current_si_id && !!task.current_bl_id && !!run,
      detail: 'Current SI and draft BL are bound to this run.',
    },
    {
      label: 'Seven fields',
      passed: result?.coverage.checked === 7,
      detail: `${result?.coverage.checked ?? 0}/7 checked`,
    },
    {
      label: 'Discrepancies',
      passed: result?.known_defect_fields.length === 0,
      detail: `${result?.known_defect_fields.length ?? 0} unresolved`,
    },
    {
      label: 'Pending review',
      passed: (result?.review_requirements.length ?? 1) === 0,
      detail: `${result?.review_requirements.length ?? 0} requirements`,
    },
    {
      label: 'External supplied information',
      passed: supplied === 0,
      detail: supplied ? `${supplied} requires a replacement source` : 'None',
    },
  ]

  async function complete() {
    if (!run || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await request<SampleDetail>(`${taskPath(task.id)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_revision: task.revision,
          run_id: run.id,
          acknowledge_seven_field_scope: true,
        }),
      })
      setConfirming(false)
      onSaved(next)
    } catch (failure) {
      const apiError = failure as ApiError
      setError(apiError.blockers?.map((blocker) => blocker.message).join(' ') || apiError.message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={`completion-panel ${completion ? 'is-complete' : ''}`}>
      <div className={`completion-icon ${completion ? 'success' : ''}`}>
        {completion ? <ShieldCheckIcon size={24} /> : <WarningCircleIcon size={24} />}
      </div>
      <div className="completion-content">
        <div className="eyebrow">SEVEN-FIELD CHECK</div>
        <h3>{completion ? 'Check complete' : 'Completion eligibility'}</h3>
        {completion ? (
          <p>
            {completion.actor} · {analyzedAt(completion.acknowledged_at)}
            <br />
            Run {completion.run_id}
          </p>
        ) : (
          <ul className="completion-checklist">
            {checks.map((check) => (
              <li key={check.label} className={check.passed ? 'passed' : 'blocked'}>
                {check.passed ? (
                  <CheckCircleIcon size={17} aria-hidden="true" />
                ) : (
                  <WarningCircleIcon size={17} aria-hidden="true" />
                )}
                <span>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!completion &&
          eligibility?.blockers.map((blocker) => (
            <p className="completion-blocker" key={blocker.code}>
              {blocker.message}
            </p>
          ))}
        {error && <ReviewError message={error} onRefresh={onRefresh} />}
        {!historical && !completion && (
          <button
            className="button primary"
            disabled={!eligibility?.eligible || busy}
            onClick={() => setConfirming(true)}
          >
            <ShieldCheckIcon size={17} aria-hidden="true" /> Complete seven-field check
          </button>
        )}
        <p className="completion-scope">
          This is a bounded document comparison, not legal approval or cargo-release authority.
        </p>
      </div>
      {confirming && run && (
        <Dialog title="Complete seven-field check?" onClose={() => !busy && setConfirming(false)}>
          <div className="completion-dialog-body">
            <p>
              This records an acknowledgment for task <strong>{task.id}</strong>, revision{' '}
              <strong>{task.revision}</strong>, run <strong>{run.id}</strong>.
            </p>
            <p>
              Actor: <strong>Demo reviewer — unverified</strong>. The acknowledgment covers only the
              seven fields shown in DraftGuard.
            </p>
            <div className="editor-actions">
              <button className="button" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="button primary" disabled={busy} onClick={() => void complete()}>
                {busy ? 'Completing…' : 'Confirm completion'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </aside>
  )
}

function ReviewControls({
  task,
  field,
  document,
  machine,
  effective,
  pageCount,
  sourceUnits,
  historical,
  onRefresh,
  onSaved,
}: {
  task: SampleDetail
  field: FieldKey
  document: DocumentVersion
  machine: Extraction
  effective: Extraction
  pageCount: number
  sourceUnits: Array<{ id: string; locator: string; text: string }>
  historical: boolean
  onRefresh: () => void
  onSaved: (task: SampleDetail) => void
}) {
  const candidatePage = machine.evidence[0]?.page ?? 1
  const visual = machine.method === 'gemini_vision'
  const [editing, setEditing] = useState(false)
  const [rawValue, setRawValue] = useState(machine.raw_value ?? '')
  const [page, setPage] = useState(candidatePage)
  const [unitId, setUnitId] = useState(machine.evidence[0]?.id ?? sourceUnits[0]?.id ?? '')
  const [busyAction, setBusyAction] = useState<'confirm' | 'correct' | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  async function save(action: 'CONFIRM_CANDIDATE' | 'CORRECT_EXTRACTION') {
    const runId = task.current_run?.id
    if (!runId || busyAction) return
    setError('')
    setSaved('')
    setBusyAction(action === 'CONFIRM_CANDIDATE' ? 'confirm' : 'correct')
    try {
      const next = await request<SampleDetail>(`${taskPath(task.id)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_revision: task.revision,
          run_id: runId,
          document_id: document.id,
          field,
          action,
          raw_value: action === 'CORRECT_EXTRACTION' ? rawValue : undefined,
          evidence: visual
            ? {
                kind: 'visual_page',
                page: action === 'CONFIRM_CANDIDATE' ? candidatePage : page,
              }
            : { kind: 'source_unit', unit_id: unitId },
        }),
      })
      onSaved(next)
      setEditing(false)
      setSaved(action === 'CONFIRM_CANDIDATE' ? 'Candidate confirmed.' : 'Correction saved.')
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  if (historical)
    return (
      <div className="evidence-actions">
        <p className="notice warning">Historical review actions are read only.</p>
      </div>
    )

  if (task.current_run?.completion)
    return (
      <div className="evidence-actions">
        <p className="notice warning">This completed run is read only.</p>
      </div>
    )

  return (
    <div className="evidence-actions">
      {effective.review && (
        <p className="review-attribution">
          Latest action:{' '}
          {effective.review.action === 'CORRECT_EXTRACTION' ? 'Corrected' : 'Confirmed'}
          {' · '}
          {effective.review.actor}
        </p>
      )}
      <div className="paired-actions">
        {visual && (
          <button
            className="button primary"
            disabled={!machine.raw_value || !!busyAction}
            onClick={() => void save('CONFIRM_CANDIDATE')}
          >
            <CheckCircleIcon size={16} aria-hidden="true" />
            {busyAction === 'confirm' ? 'Confirming…' : 'Confirm candidate'}
          </button>
        )}
        <button
          className="button"
          disabled={!!busyAction}
          aria-expanded={editing}
          onClick={() => {
            setEditing((value) => !value)
            setError('')
          }}
        >
          <PencilSimpleIcon size={16} aria-hidden="true" /> Correct extraction
        </button>
      </div>
      {visual && !machine.raw_value && (
        <p className="candidate-help">
          No candidate can be confirmed. Correct the extraction only if the value is visible in the
          source.
        </p>
      )}
      {editing && (
        <form
          className="review-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void save('CORRECT_EXTRACTION')
          }}
        >
          <div className="editor-heading">
            <div>
              <div className="eyebrow">SOURCE-BACKED CORRECTION</div>
              <h3>Correct extraction</h3>
            </div>
          </div>
          <label className="form-field">
            Value visible in the source
            <textarea
              required
              rows={3}
              maxLength={5000}
              value={rawValue}
              onChange={(event) => setRawValue(event.target.value)}
            />
          </label>
          {visual ? (
            <label className="form-field">
              Evidence page
              <input
                required
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={(event) => setPage(event.currentTarget.valueAsNumber)}
              />
            </label>
          ) : (
            <>
              <label className="form-field">
                Source unit
                <select required value={unitId} onChange={(event) => setUnitId(event.target.value)}>
                  <option value="">Choose source text</option>
                  {sourceUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.locator} · {unit.text.slice(0, 80)}
                    </option>
                  ))}
                </select>
              </label>
              {unitId && (
                <div className="selected-source-unit" aria-live="polite">
                  <strong>{sourceUnits.find((unit) => unit.id === unitId)?.locator}</strong>
                  <pre>{sourceUnits.find((unit) => unit.id === unitId)?.text}</pre>
                </div>
              )}
            </>
          )}
          {error && <ReviewError message={error} onRefresh={onRefresh} />}
          <div className="editor-actions">
            <button
              type="button"
              className="button"
              disabled={!!busyAction}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!!busyAction || !rawValue.trim() || (!visual && !unitId)}
            >
              {busyAction === 'correct' ? 'Saving correction…' : 'Save correction'}
            </button>
          </div>
        </form>
      )}
      {!editing && error && <ReviewError message={error} onRefresh={onRefresh} />}
      <p className="review-announcement" aria-live="polite">
        {saved}
      </p>
    </div>
  )
}

function ReviewError({ message, onRefresh }: { message: string; onRefresh: () => void }) {
  return (
    <div className="form-error" role="alert">
      <span>{message}</span>
      <button type="button" className="text-button" onClick={onRefresh}>
        Refresh task
      </button>
    </div>
  )
}
