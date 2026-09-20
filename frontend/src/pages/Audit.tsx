import { type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowClockwiseIcon,
  DownloadSimpleIcon,
  ListMagnifyingGlassIcon,
  CaretDownIcon,
  FileTextIcon,
} from '@phosphor-icons/react'
import {
  apiUrl,
  locationLabel,
  type AuditEvent,
  type ExtractionRun,
  type Health,
  type Page,
  type RunSummary,
  type ExtractedDocument,
} from '../extraction/api'
import { useResource } from '../extraction/useResource'
import { usePollingResource } from '../extraction/usePollingResource'
import { useAuditEvents } from '../extraction/useAuditEvents'
import { pageOffset, useExtractionParams } from '../extraction/navigation'
import { ExtractionStatus, RunStatus } from '../extraction/ExtractionStatus'
import '../extraction/extraction.css'
import '../extraction/audit.css'

const fieldLabels: Record<string, string> = {
  shipper: 'Shipper',
  consignee: 'Consignee',
  notify_party: 'Notify party',
  port_of_loading: 'Port of loading',
  port_of_discharge: 'Port of discharge',
  container_count: 'Container count',
  gross_weight_kg: 'Gross weight (kg)',
}
const human = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const valueText = (value: unknown) => (value == null ? 'Unavailable' : String(value))

export function Audit() {
  const { runId } = useParams()
  const health = useResource<Health>('/api/health')
  return (
    <div className="page extraction-page audit-page">
      <header className="page-heading extraction-heading">
        <div>
          <div className="eyebrow">LOCAL EXTRACTION</div>
          <h1>Audit Trail</h1>
          <p>Follow each backend step, decision, and source.</p>
        </div>
        <span className="local-history-label">
          <ListMagnifyingGlassIcon size={18} /> Recorded on this backend
        </span>
      </header>
      {health.loading ? (
        <p role="status">Connecting to audit history…</p>
      ) : health.error ? (
        <ConnectionError message={health.error} retry={health.reload} />
      ) : !health.data?.capabilities?.development_extraction ? (
        <div className="notice warning">
          Local extraction is disabled. Enable it on the backend to view the audit trail.
        </div>
      ) : runId ? (
        <AuditRun key={runId} runId={runId} />
      ) : (
        <AuditList />
      )}
    </div>
  )
}

function ConnectionError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="notice warning" role="alert">
      <span>{message} Displayed records are the last saved snapshot.</span>
      <button className="button" onClick={retry}>
        <ArrowClockwiseIcon size={18} /> Retry
      </button>
    </div>
  )
}

function AuditList() {
  const { params, update } = useExtractionParams()
  const location = useLocation()
  const offset = pageOffset(params.get('offset'))
  const query = new URLSearchParams({ limit: '20', offset: String(offset) })
  for (const key of ['q', 'status', 'source_type', 'needs_review']) {
    if (params.get(key)) query.set(key, params.get(key)!)
  }
  const resource = usePollingResource<Page<RunSummary>>(`/api/v1/dev/runs?${query}`, 5000)
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    update({ q: String(new FormData(event.currentTarget).get('q') ?? '').trim(), offset: null })
  }
  return (
    <section className="panel extraction-panel">
      <div className="extraction-panel-heading">
        <div>
          <h2>Processing runs</h2>
          <p>Every extraction has its own saved record. This list refreshes automatically.</p>
        </div>
        <button className="button" onClick={resource.reload}>
          <ArrowClockwiseIcon size={18} /> Refresh
        </button>
      </div>
      <form className="audit-search" onSubmit={search}>
        <label>
          Search audit history
          <input
            name="q"
            key={params.get('q')}
            defaultValue={params.get('q') ?? ''}
            placeholder="Email ID, filename, subject, or run ID"
          />
        </label>
        <button className="button primary">Search</button>
      </form>
      <div className="audit-filters">
        <label>
          Processing outcome
          <select
            value={params.get('status') ?? ''}
            onChange={(e) => update({ status: e.target.value, offset: null })}
          >
            <option value="">All outcomes</option>
            <option value="RUNNING">Processing</option>
            <option value="SUCCEEDED">Finished</option>
            <option value="FAILED">Finished with errors</option>
            <option value="INTERRUPTED">Interrupted</option>
          </select>
        </label>
        <label>
          Source type
          <select
            value={params.get('source_type') ?? ''}
            onChange={(e) => update({ source_type: e.target.value, offset: null })}
          >
            <option value="">All sources</option>
            <option value="dataset_email">Dataset email</option>
            <option value="upload">Manual upload</option>
          </select>
        </label>
        <label>
          Review requirement
          <select
            value={params.get('needs_review') ?? ''}
            onChange={(e) => update({ needs_review: e.target.value, offset: null })}
          >
            <option value="">All runs</option>
            <option value="true">Requires review</option>
            <option value="false">No review issues</option>
          </select>
        </label>
      </div>
      {resource.loading && <p role="status">Loading saved runs…</p>}
      {resource.error && <ConnectionError message={resource.error} retry={resource.reload} />}
      {resource.data && (
        <>
          <p className="extraction-muted">{resource.data.total} matching runs · newest first</p>
          {resource.data.items.length ? (
            <table className="audit-runs-table" aria-label="Audit runs">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Started</th>
                  <th>Attachments</th>
                  <th>Outcome</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((run) => (
                  <tr key={run.run_id}>
                    <td>
                      <Link
                        to={`/audit/runs/${run.run_id}?from=${encodeURIComponent(location.pathname + location.search)}`}
                      >
                        {run.source_label} <ArrowRightIcon size={16} />
                      </Link>
                      <small>
                        {run.source_type === 'upload' ? 'Manual upload' : 'Dataset email'} ·{' '}
                        {run.run_id}
                      </small>
                    </td>
                    <td>{new Date(run.created_at).toLocaleString()}</td>
                    <td>{run.document_count}</td>
                    <td>
                      <RunStatus run={run} />
                    </td>
                    <td>{run.trace_mode === 'legacy' ? 'Legacy trace' : 'Live recorded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="extraction-empty">
              <ListMagnifyingGlassIcon size={36} />
              <p>No runs match these filters.</p>
              <Link to="/extraction">Open extraction</Link>
            </div>
          )}
          <div className="extraction-pagination">
            <button
              className="button"
              disabled={!offset}
              onClick={() => update({ offset: String(Math.max(0, offset - 20)) })}
            >
              Previous
            </button>
            <button
              className="button"
              disabled={offset + 20 >= resource.data.total}
              onClick={() => update({ offset: String(offset + 20) })}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function AuditRun({ runId }: { runId: string }) {
  const { params, update } = useExtractionParams()
  const resource = usePollingResource<ExtractionRun>(
    `/api/v1/dev/runs/${encodeURIComponent(runId)}`,
    1000,
    true,
  )
  const trace = useAuditEvents(runId)
  const run = resource.data
  const from = params.get('from')
  const back = from === '/audit' || from?.startsWith('/audit?') ? from : '/audit'
  const selectedDocument = run?.documents.find((doc) => doc.document_id === params.get('document'))
  const source =
    selectedDocument &&
    (selectedDocument.source_units ?? selectedDocument.result?.source_units ?? []).find(
      (unit) => unit.unit_id === params.get('unit'),
    )
  const filtered = trace.items.filter(
    (item) =>
      (!params.get('document') ||
        !item.document_id ||
        item.document_id === params.get('document')) &&
      (!params.get('stage') || item.stage === params.get('stage')) &&
      (!params.get('outcome') || item.status === params.get('outcome')) &&
      (!params.get('field') || item.details.field === params.get('field')),
  )
  function evidence(doc: ExtractedDocument, unitId: string) {
    update({ document: doc.document_id, unit: unitId })
  }
  return (
    <>
      <Link className="extraction-back" to={back}>
        <ArrowLeftIcon size={18} /> Back to audit history
      </Link>
      {resource.loading && <p role="status">Opening saved audit…</p>}
      {resource.error && <ConnectionError message={resource.error} retry={resource.reload} />}
      {run && (
        <>
          <section className="panel extraction-panel audit-run-header">
            <div className="extraction-panel-heading">
              <div>
                <div className="eyebrow">
                  {run.email ? `DATASET EMAIL · ${run.email.email_id}` : 'MANUAL UPLOAD'}
                </div>
                <h2>{run.source_label}</h2>
                <p>
                  {new Date(run.created_at).toLocaleString()} · {run.document_count} attachments ·{' '}
                  {run.pipeline_version}
                </p>
              </div>
              <RunStatus run={run} />
            </div>
            <div className="extraction-actions">
              <Link className="button primary" to={`/extraction/runs/${run.run_id}`}>
                <FileTextIcon size={18} /> View extraction results
              </Link>
              <a className="button" href={apiUrl(`/api/v1/dev/runs/${run.run_id}?download=true`)}>
                <DownloadSimpleIcon size={18} /> Download audit JSON
              </a>
            </div>
            {run.processing_status === 'RUNNING' && (
              <p className="audit-live" role="status">
                Processing · new saved events appear automatically. You can leave this page.
              </p>
            )}
            {trace.traceMode === 'legacy' && (
              <p className="notice warning">
                Legacy trace: these events were recorded by an earlier version. Some lifecycle steps
                were not recorded.
              </p>
            )}
            {run.issues.map((issue, index) => (
              <p className="notice warning" key={index}>
                {issue.message}
              </p>
            ))}
            <details className="extraction-details">
              <summary>Provenance and document identity</summary>
              <dl>
                <dt>Run ID</dt>
                <dd>{run.run_id}</dd>
                <dt>Request ID</dt>
                <dd>{run.request_id}</dd>
                <dt>Finished</dt>
                <dd>
                  {run.finished_at ? new Date(run.finished_at).toLocaleString() : 'Not finished'}
                </dd>
              </dl>
              {run.email && (
                <>
                  <p>From: {run.email.from}</p>
                  <pre>{run.email.body}</pre>
                </>
              )}
              {run.documents.map((doc) => (
                <div className="audit-document-identity" key={doc.document_id}>
                  <strong>{doc.filename}</strong>
                  <dl>
                    <dt>Document ID</dt>
                    <dd>{doc.document_id}</dd>
                    <dt>SHA-256</dt>
                    <dd>{doc.content_sha256 ?? 'Original not available'}</dd>
                  </dl>
                  {doc.has_original && (
                    <a
                      className="button"
                      href={apiUrl(
                        `/api/v1/dev/runs/${runId}/documents/${doc.document_id}/original`,
                      )}
                    >
                      <DownloadSimpleIcon size={16} /> Download original: {doc.filename}
                    </a>
                  )}
                </div>
              ))}
            </details>
          </section>
          <div className="audit-layout">
            <section className="panel extraction-panel extraction-audit">
              <h2>Processing timeline</h2>
              <p className="extraction-muted">
                Events are saved by the backend as each step happens. Times are shown in your local
                timezone.
              </p>
              <div className="audit-filters">
                <label>
                  Attachment
                  <select
                    value={params.get('document') ?? ''}
                    onChange={(e) => update({ document: e.target.value, unit: null, event: null })}
                  >
                    <option value="">All attachments</option>
                    {run.documents.map((doc) => (
                      <option key={doc.document_id} value={doc.document_id}>
                        {doc.filename}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Stage
                  <select
                    value={params.get('stage') ?? ''}
                    onChange={(e) => update({ stage: e.target.value, event: null })}
                  >
                    <option value="">All stages</option>
                    {[...new Set(trace.items.map((item) => item.stage))].map((stage) => (
                      <option key={stage} value={stage}>
                        {human(stage)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Outcome
                  <select
                    value={params.get('outcome') ?? ''}
                    onChange={(e) => update({ outcome: e.target.value, event: null })}
                  >
                    <option value="">All outcomes</option>
                    {['STARTED', 'SUCCEEDED', 'NEEDS_REVIEW', 'FAILED', 'INTERRUPTED'].map(
                      (status) => (
                        <option key={status} value={status}>
                          {human(status)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Field
                  <select
                    value={params.get('field') ?? ''}
                    onChange={(e) => update({ field: e.target.value, event: null })}
                  >
                    <option value="">All fields</option>
                    {Object.entries(fieldLabels).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {trace.error && <ConnectionError message={trace.error} retry={trace.reload} />}
              {trace.loading && <p role="status">Loading recorded events…</p>}
              <p className="extraction-muted">
                {filtered.length} of {trace.items.length} recorded events
              </p>
              <ol className="audit-timeline">
                {filtered.map((item) => {
                  const doc = run.documents.find((doc) => doc.document_id === item.document_id)
                  const expanded = params.get('event') === String(item.sequence)
                  return (
                    <li key={item.sequence}>
                      <button
                        className="audit-event-toggle"
                        aria-expanded={expanded}
                        aria-controls={`event-${item.sequence}`}
                        onClick={() => update({ event: expanded ? null : String(item.sequence) })}
                      >
                        <span className="audit-event-number">
                          {String(item.sequence).padStart(2, '0')}
                        </span>
                        <span className="audit-event-heading">
                          <strong>{item.message}</strong>
                          <small>
                            {human(item.stage)} · {doc?.filename ?? 'Run'}
                            {item.details.field
                              ? ` · ${fieldLabels[String(item.details.field)] ?? item.details.field}`
                              : ''}
                          </small>
                          <ExtractionStatus
                            state={
                              item.status === 'STARTED'
                                ? 'processing'
                                : ['SUCCEEDED', 'COMPLETED'].includes(item.status)
                                  ? 'complete'
                                  : 'review'
                            }
                            label={human(item.status)}
                          />
                        </span>
                        <span className="audit-event-time">
                          <time dateTime={item.timestamp} title={item.timestamp}>
                            {new Date(item.timestamp).toLocaleTimeString([], {
                              hour12: false,
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              fractionalSecondDigits: 3,
                            })}
                          </time>
                          {item.duration_ms != null && (
                            <small>{item.duration_ms.toFixed(1)} ms</small>
                          )}
                        </span>
                        <CaretDownIcon size={16} />
                      </button>
                      {expanded && (
                        <div className="audit-event-body" id={`event-${item.sequence}`}>
                          <EventDetails item={item} document={doc} evidence={evidence} />
                          <details className="extraction-details">
                            <summary>Recorded event JSON</summary>
                            <pre>{JSON.stringify(item, null, 2)}</pre>
                          </details>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
              {!trace.loading && !filtered.length && <p>No recorded events match these filters.</p>}
            </section>
            <aside
              className="panel extraction-panel audit-evidence"
              aria-label="Audit source evidence"
            >
              <h2>Source evidence</h2>
              {source ? (
                <>
                  <p>
                    {selectedDocument?.filename} · {locationLabel(source)}
                  </p>
                  <pre data-testid="audit-source-evidence">
                    {source.text || 'This source unit contains no text.'}
                  </pre>
                  <Link
                    className="extraction-link"
                    to={`/extraction/runs/${runId}?document=${selectedDocument!.document_id}&unit=${encodeURIComponent(source.unit_id)}`}
                  >
                    Open in extraction results <ArrowRightIcon size={16} />
                  </Link>
                </>
              ) : (
                <p className="extraction-muted">
                  {params.get('unit')
                    ? 'Waiting for the saved source snapshot. If this persists, retry loading the run.'
                    : 'Expand a decision and select its source to inspect the exact retained text.'}
                </p>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  )
}

function EventDetails({
  item,
  document,
  evidence,
}: {
  item: AuditEvent
  document?: ExtractedDocument
  evidence: (document: ExtractedDocument, unitId: string) => void
}) {
  const details = item.details
  const units = document?.source_units ?? document?.result?.source_units ?? []
  function references(value: unknown) {
    if (!Array.isArray(value) || !document) return null
    return (
      <div className="extraction-evidence-buttons">
        {value.map(String).map((id) => {
          const unit = units.find((unit) => unit.unit_id === id)
          return (
            <button key={id} onClick={() => evidence(document, id)}>
              {unit ? locationLabel(unit) : 'View source'}
            </button>
          )
        })}
      </div>
    )
  }
  const candidates = Array.isArray(details.candidates)
    ? (details.candidates as Record<string, unknown>[])
    : []
  return (
    <>
      {details.parser != null && (
        <p>
          Selected parser: <strong>{String(details.parser)}</strong>
        </p>
      )}
      {details.detected_role !== undefined && (
        <p>
          Detected document role: <strong>{valueText(details.detected_role)}</strong>
        </p>
      )}
      {details.source_unit_count != null && (
        <p>{String(details.source_unit_count)} source units retained.</p>
      )}
      {details.field != null && (
        <p>
          <strong>{fieldLabels[String(details.field)] ?? String(details.field)}</strong>
        </p>
      )}
      {details.raw_value !== undefined && (
        <dl className="audit-values">
          <dt>Original value</dt>
          <dd>{valueText(details.raw_value)}</dd>
          <dt>Normalized value</dt>
          <dd>{valueText(details.normalized_value)}</dd>
          {details.rule != null && (
            <>
              <dt>Rule applied</dt>
              <dd>{String(details.rule)}</dd>
            </>
          )}
          {details.issue_code != null && (
            <>
              <dt>Review reason</dt>
              <dd>{human(String(details.issue_code))}</dd>
            </>
          )}
        </dl>
      )}
      {item.stage === 'candidates' && candidates.length === 0 && (
        <p>No matching source candidates were found.</p>
      )}
      {candidates.map((candidate, index) => (
        <div className="audit-candidate" key={index}>
          <strong>
            {candidate.selected ? 'Retained for evaluation' : 'Rejected'} ·{' '}
            {String(candidate.label)}
          </strong>
          <pre>{valueText(candidate.raw_value)}</pre>
          <p>
            {candidate.selection_reason === 'explicit_total_precedence'
              ? candidate.selected
                ? 'An explicit total takes precedence over individual-container weights.'
                : 'Excluded because an explicit total is available.'
              : 'All matching candidates are retained for normalization and conflict checks.'}
          </p>
          {references(candidate.source_unit_ids)}
        </div>
      ))}
      {references(details.source_unit_ids)}
      {details.code != null && <p>Recorded reason: {human(String(details.code))}</p>}
    </>
  )
}
