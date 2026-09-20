import { useRef } from 'react'
import { Link } from 'react-router'
import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  ArrowSquareOutIcon,
} from '@phosphor-icons/react'
import { apiUrl, locationLabel, type ExtractedDocument, type ExtractionRun } from './api'
import { usePollingResource } from './usePollingResource'
import { ExtractionStatus, RunStatus } from './ExtractionStatus'
import { returnPath, useExtractionParams } from './navigation'

const labels: Record<string, string> = {
  shipper: 'Shipper',
  consignee: 'Consignee',
  notify_party: 'Notify party',
  port_of_loading: 'Port of loading',
  port_of_discharge: 'Port of discharge',
  container_count: 'Container count',
  gross_weight_kg: 'Gross weight (kg)',
}
const states = {
  PRESENT: 'Extracted',
  MISSING: 'Missing',
  UNREADABLE: 'Unreadable',
  AMBIGUOUS: 'Needs review',
}

export function RunInspector({ runId }: { runId: string }) {
  const { params } = useExtractionParams()
  const resource = usePollingResource<ExtractionRun>(
    `/api/v1/dev/runs/${encodeURIComponent(runId)}`,
    1000,
    true,
  )
  return (
    <>
      <Link className="extraction-back" to={returnPath(params.get('from'))}>
        <ArrowLeftIcon size={18} /> Back to extraction
      </Link>
      {resource.loading && <p role="status">Opening saved extraction…</p>}
      {resource.error && (
        <p className="form-error" role="alert">
          {resource.error}
          <button className="button" onClick={resource.reload}>
            Retry
          </button>
        </p>
      )}
      {resource.data && (
        <RunDetails key={resource.data.run_id} run={resource.data} refresh={resource.reload} />
      )}
    </>
  )
}

function RunDetails({ run, refresh }: { run: ExtractionRun; refresh: () => void }) {
  const { params, update } = useExtractionParams()
  const document =
    run.documents.find((item) => item.document_id === params.get('document')) ?? run.documents[0]
  return (
    <>
      <section className="panel extraction-panel extraction-run-header">
        <div className="extraction-panel-heading">
          <div>
            <span className="eyebrow">
              {run.source_type === 'dataset_email'
                ? `DATASET EMAIL · ${run.email?.email_id}`
                : 'MANUAL UPLOAD'}
            </span>
            <h2>{run.source_label}</h2>
            <p>
              {new Date(run.created_at).toLocaleString()} · {run.document_count} documents ·{' '}
              {run.pipeline_version}
            </p>
          </div>
          <RunStatus run={run} />
        </div>
        <p className="extraction-print-note">
          Local extraction · {run.pipeline_version} · Run {run.run_id}. Extraction results require
          source review; this is not shipment approval.
        </p>
        <div className="extraction-actions">
          <Link
            className="button primary"
            to={`/audit/runs/${run.run_id}${document ? `?document=${document.document_id}` : ''}`}
          >
            {run.processing_status === 'RUNNING' ? 'View live audit' : 'View audit trail'}
          </Link>
          <a className="button" href={apiUrl(`/api/v1/dev/runs/${run.run_id}?download=true`)}>
            <DownloadSimpleIcon size={18} /> Download audit JSON
          </a>
          {run.processing_status === 'RUNNING' && (
            <button className="button" onClick={refresh}>
              Refresh run
            </button>
          )}
        </div>
        {run.processing_status === 'RUNNING' && (
          <p role="status">
            Processing on the backend. Results update automatically; you can leave this page.
          </p>
        )}
        {run.issues.map((issue, i) => (
          <p key={`${issue.code}-${i}`} className="notice warning">
            {issue.message}
          </p>
        ))}
        {run.email && (
          <details className="extraction-details">
            <summary>Source email</summary>
            <p>From: {run.email.from}</p>
            <pre>{run.email.body}</pre>
          </details>
        )}
        <details className="extraction-details">
          <summary>Run details</summary>
          <dl>
            <dt>Run ID</dt>
            <dd>{run.run_id}</dd>
            <dt>Request ID</dt>
            <dd>{run.request_id}</dd>
            <dt>Finished</dt>
            <dd>{run.finished_at ? new Date(run.finished_at).toLocaleString() : 'Not finished'}</dd>
          </dl>
        </details>
      </section>
      {run.documents.length > 0 && (
        <nav className="extraction-document-tabs" aria-label="Attachments">
          {run.documents.map((item) => (
            <button
              key={item.document_id}
              aria-pressed={document?.document_id === item.document_id}
              onClick={() => update({ document: item.document_id, unit: null, field: null })}
            >
              <span className="extraction-document-name">
                <FileTextIcon size={20} aria-hidden="true" />
                {item.filename}
              </span>
              <span className="extraction-document-state">
                <small>{item.result?.detected_role ?? 'Role unconfirmed'}</small>
                <ExtractionStatus
                  state={
                    item.error ||
                    item.processing_status === 'FAILED' ||
                    item.processing_status === 'INTERRUPTED' ||
                    item.result?.needs_review
                      ? 'review'
                      : item.processing_status === 'SUCCEEDED'
                        ? 'ready'
                        : 'processing'
                  }
                  label={
                    item.error || item.processing_status === 'FAILED'
                      ? 'Error'
                      : item.processing_status === 'INTERRUPTED'
                        ? 'Interrupted'
                        : item.result?.needs_review
                          ? 'Needs review'
                          : item.processing_status === 'SUCCEEDED'
                            ? 'Extracted'
                            : 'Processing'
                  }
                />
              </span>
            </button>
          ))}
        </nav>
      )}
      {document && (
        <DocumentInspector key={document.document_id} document={document} runId={run.run_id} />
      )}
    </>
  )
}

function DocumentInspector({ document, runId }: { document: ExtractedDocument; runId: string }) {
  const result = document.result
  const { params, update } = useExtractionParams()
  const unit =
    result?.source_units.find((item) => item.unit_id === params.get('unit')) ??
    result?.source_units[0]
  const sourceRef = useRef<HTMLElement>(null)
  function selectEvidence(unitId: string, field: string) {
    update({ document: document.document_id, unit: unitId, field })
    if (window.innerWidth < 1280) {
      sourceRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
      sourceRef.current?.focus({ preventScroll: true })
    }
  }
  const original = apiUrl(`/api/v1/dev/runs/${runId}/documents/${document.document_id}/original`)
  return (
    <>
      <div className="extraction-document-meta">
        <span>
          {document.filename}{' '}
          {document.byte_count !== null && `· ${document.byte_count.toLocaleString()} bytes`}
        </span>
        {document.has_original && (
          <a className="button" href={original}>
            <DownloadSimpleIcon size={18} aria-hidden="true" /> Download original
          </a>
        )}
      </div>
      {document.error && (
        <div className="notice warning" role="alert">
          {document.error.message}
        </div>
      )}
      {result && (
        <div className="extraction-results-grid">
          <section className="panel extraction-panel extraction-fields">
            <h3>Extracted fields</h3>
            <p className="extraction-muted">
              Original values are preserved. Select evidence to inspect the source.
            </p>
            <div className="extraction-table-scroll">
              <table aria-label="Extracted shipment fields">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Original value</th>
                    <th>Normalized value</th>
                    <th>State / evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fields.map((field) => (
                    <tr
                      key={field.field}
                      className={params.get('field') === field.field ? 'selected' : ''}
                    >
                      <th scope="row">
                        {field.evidence.length ? (
                          <button
                            className="extraction-field-select"
                            onClick={() => selectEvidence(field.evidence[0].unit_id, field.field)}
                            aria-label={`Inspect ${labels[field.field] ?? field.field}`}
                          >
                            {labels[field.field] ?? field.field}
                          </button>
                        ) : (
                          (labels[field.field] ?? field.field)
                        )}
                      </th>
                      <td className="extraction-raw" data-label="Original value">
                        {field.raw_value ?? '—'}
                      </td>
                      <td data-label="Normalized value">{field.normalized_value ?? '—'}</td>
                      <td className="extraction-field-review">
                        <ExtractionStatus
                          state={field.value_state === 'PRESENT' ? 'ready' : 'review'}
                          label={states[field.value_state]}
                        />
                        <div className="extraction-evidence-buttons">
                          {field.evidence.map((evidence, index) => (
                            <button
                              key={`${evidence.unit_id}-${index}`}
                              onClick={() => selectEvidence(evidence.unit_id, field.field)}
                              aria-pressed={
                                params.get('field') === field.field &&
                                unit?.unit_id === evidence.unit_id
                              }
                              aria-label={`View ${labels[field.field] ?? field.field} evidence ${index + 1}: ${locationLabel(evidence)}`}
                            >
                              <ArrowSquareOutIcon size={14} aria-hidden="true" />{' '}
                              {locationLabel(evidence)}
                            </button>
                          ))}
                        </div>
                        {result.issues
                          .filter((issue) => issue.field === field.field)
                          .map((issue, index) => (
                            <p className="extraction-field-issue" key={`${issue.code}-${index}`}>
                              {issue.message} {issue.next_action}
                            </p>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.issues
              .filter((issue) => !issue.field)
              .map((issue, i) => (
                <div key={`${issue.code}-${i}`} className="notice warning">
                  {issue.message} {issue.next_action}
                </div>
              ))}
          </section>
          <section
            className="panel extraction-panel extraction-source"
            ref={sourceRef}
            tabIndex={-1}
            aria-labelledby="extraction-source-title"
          >
            <h3 id="extraction-source-title">Source evidence</h3>
            <p className="extraction-source-caption">
              {params.get('field') ? `${labels[params.get('field')!] ?? 'Selected field'} · ` : ''}
              {document.filename}
            </p>
            {result.source_units.length > 0 ? (
              <>
                <label>
                  Source location
                  <select
                    value={unit?.unit_id ?? ''}
                    onChange={(e) =>
                      update({ document: document.document_id, unit: e.target.value, field: null })
                    }
                  >
                    {result.source_units.map((source) => (
                      <option key={source.unit_id} value={source.unit_id}>
                        {locationLabel(source)}
                      </option>
                    ))}
                  </select>
                </label>
                <pre data-testid="source-evidence">
                  {unit?.text || 'This source unit contains no text.'}
                </pre>
              </>
            ) : (
              <p>No text was available from this document.</p>
            )}
            {result.detected_format === 'pdf' &&
              document.has_original &&
              result.parsing_status !== 'FAILED' &&
              result.parsing_status !== 'REJECTED' && (
                <details className="extraction-details">
                  <summary>View original PDF</summary>
                  <iframe
                    title={`Original PDF: ${document.filename}`}
                    src={`${original}?disposition=inline#page=${unit?.page ?? 1}`}
                  />
                  <a
                    className="extraction-link"
                    href={`${original}?disposition=inline`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open PDF in another tab
                  </a>
                </details>
              )}
            <p className="extraction-muted">
              Evidence refers to this saved original. Extracted PDF text may differ from its visible
              image.
            </p>
          </section>
        </div>
      )}
    </>
  )
}
