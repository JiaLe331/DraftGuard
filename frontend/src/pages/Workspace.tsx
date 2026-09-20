import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeftIcon,
  PrinterIcon,
  ArrowClockwiseIcon,
  FileTextIcon,
  EnvelopeSimpleIcon,
  ArrowSquareOutIcon,
} from '@phosphor-icons/react'
import { documentUrl, request, useResource } from '../mailbox/api'
import { useMailbox } from '../mailbox/context'
import {
  analyzedAt,
  categoryLabels,
  fieldLabels,
  type SampleDetail,
  type FieldResult,
} from '../mailbox/types'
import { EmptyState, StatusBadge } from '../components/Primitives'
import { Report } from '../components/Report'

export function Workspace() {
  const { taskId } = useParams()
  const { data, error, reload } = useResource<SampleDetail>(
    `/api/v1/samples/${encodeURIComponent(taskId ?? '')}`,
  )
  useEffect(() => {
    if (data?.latest_run?.status !== 'RUNNING') return
    const timer = setTimeout(reload, 3000)
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
  return <TaskWorkspace key={data.id + ':' + data.latest_run?.id} task={data} reload={reload} />
}
function TaskWorkspace({ task, reload }: { task: SampleDetail; reload: () => void }) {
  const { refresh } = useMailbox()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const evidenceRef = useRef<HTMLElement>(null)
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
  async function reanalyze() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      await request<SampleDetail>(`/api/v1/dev/samples/${encodeURIComponent(task.id)}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: task.revision }),
      })
      reload()
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
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
        <Report task={task} preview />
      </div>
    )
  const comparison = task.category === 'BL_COMPARISON'
  const processing = busy || task.latest_run?.status === 'RUNNING'
  return (
    <div className="page workspace-page">
      <div className="workspace-breadcrumb">
        <Link to={from}>
          <ArrowLeftIcon size={17} />
          Work queue
        </Link>
        <span>{task.id}</span>
        <div className="breadcrumb-actions">
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
          <button className="button primary compact" disabled={processing} onClick={reanalyze}>
            <ArrowClockwiseIcon size={16} />
            {processing ? 'Analyzing…' : task.current_run ? 'Reanalyze' : 'Analyze email'}
          </button>
        </div>
      </div>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">{task.id} · DOCUMENT WORKSPACE</div>
          <h1>{task.subject}</h1>
          <div className="workspace-byline">
            {task.sender} ·{' '}
            {task.category ? categoryLabels[task.category] : 'Needs classification review'}
          </div>
        </div>
        <div className="workspace-status">
          <StatusBadge status={processing ? 'RUNNING' : task.workflow_state} />
          <small>Last analyzed: {analyzedAt(task.last_analyzed)}</small>
        </div>
      </div>
      {error && (
        <div className="notice danger" role="alert">
          {error} Use Refresh to check whether the analysis was saved.
        </div>
      )}
      {processing && (
        <div className="notice" role="status">
          Analyzing the current source files. Existing results below remain from the previous saved
          run.
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
      {!task.latest_run && (
        <div className="notice warning">
          This email has not been analyzed. No comparison result is available yet.
        </div>
      )}
      <details className="email-context" open={!comparison}>
        <summary>
          <EnvelopeSimpleIcon size={17} />
          Original email<span>{task.attachment_count} attachments</span>
        </summary>
        <div className="email-body">
          <p className="preserve-lines">{task.body}</p>
          <div className="attachment-list">
            {task.documents.map((doc) => (
              <a
                className="button compact"
                href={documentUrl(task.id, doc.id)}
                target="_blank"
                rel="noreferrer"
                key={doc.id}
              >
                <FileTextIcon size={16} />
                {doc.filename}
                <ArrowSquareOutIcon size={14} />
              </a>
            ))}
          </div>
          {!task.documents.length && <p>No attachments were provided.</p>}
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
                  <a
                    className="button compact"
                    href={documentUrl(task.id, document.id, fieldEvidence[0]?.page)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open original{fieldEvidence[0]?.page ? ` · page ${fieldEvidence[0].page}` : ''}
                    <ArrowSquareOutIcon size={14} />
                  </a>
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
              These are machine results from the provided dataset. You can inspect sources and rerun
              analysis. Human review tools are not available yet; no completion is recorded.
            </p>
          </div>
        </aside>
      </div>
      <p className="workspace-disclaimer">
        Demo mailbox · Provided dataset. This seven-field check is not a complete bill-of-lading
        approval.
      </p>
      {result && <Report task={task} />}
    </div>
  )
}
