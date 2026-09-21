import { AnalysisActivity } from '../components/AnalysisActivity'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeftIcon,
  PrinterIcon,
  ArrowClockwiseIcon,
  FileTextIcon,
  EnvelopeSimpleIcon,
} from '@phosphor-icons/react'
import { taskPath, useResource } from '../mailbox/api'
import { useMailbox } from '../mailbox/context'
import { useAnalysis } from '../mailbox/useAnalysis'
import {
  analyzedAt,
  categoryLabels,
  fieldLabels,
  type SampleDetail,
  type FieldResult,
} from '../mailbox/types'
import type { Health } from '../extraction/api'
import { EmptyState, StatusBadge } from '../components/Primitives'
import { Report } from '../components/Report'
import { CloneTask, TaskSources, RevisionChanges } from '../components/TaskSources'
import { DocumentPreview } from '../components/DocumentPreview'

export function Workspace() {
  const { taskId } = useParams()
  const { refresh } = useMailbox()
  const [params] = useSearchParams()
  const runId = params.get('run')
  const path = taskPath(taskId ?? '')
  const { data, error, reload } = useResource<SampleDetail>(
    runId && taskId?.startsWith('task-') ? `${path}/runs/${encodeURIComponent(runId)}` : path,
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
      key={data.id + ':' + data.revision + ':' + runId + ':' + data.latest_run?.id}
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
    busy,
  } = useAnalysis(initial, refresh)
  const [allAttachments, setAllAttachments] = useState(false)
  const evidenceRef = useRef<HTMLElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (phase === 'revealed') summaryRef.current?.focus({ preventScroll: true })
  }, [phase])
  const localTask = task.id.startsWith('task-')
  const historical = !!task.is_historical || !!params.get('run')
  const result = task.current_run?.result
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
          {result && !historical && (
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
          <h1>{task.subject}</h1>
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
          {!result && !historical && (
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
            <strong>Latest analysis failed</strong>
            <p>
              {task.latest_run.error?.message}{' '}
              {result
                ? 'The last successful result is retained below.'
                : 'No successful result is available.'}
            </p>
          </div>
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
                ? 'On demand · Rules'
                : 'Not analyzed'}
          </span>
        </div>
        <span className="small-text">{task.current_run?.pipeline_version} · Saved locally</span>
      </div>
      <RevisionChanges task={task} />
      {result?.review_requirements.map((problem, i) => (
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
              : 'No document check is marked complete. Classification needs human review or a future semantic analysis step.'}
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
                {fieldEvidence.length > 0 && (
                  <div className="evidence-excerpts">
                    {fieldEvidence.map((e) => (
                      <blockquote key={e.id}>
                        <strong>{e.locator}</strong>
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
        </section>
        <aside className="completion-panel">
          <div>
            <h3>Analysis first. Human review next.</h3>
            <p>
              These are machine results from the selected source documents. You can inspect sources
              and rerun analysis. Human review tools are not available yet; no completion is
              recorded.
            </p>
          </div>
        </aside>
      </div>
      <p className="workspace-disclaimer">
        {localTask ? 'Local working copy' : 'Demo mailbox · Provided dataset'}. This seven-field
        check is not a complete bill-of-lading approval.
      </p>
      {result && <Report task={{ ...task, is_historical: historical }} />}
    </div>
  )
}
