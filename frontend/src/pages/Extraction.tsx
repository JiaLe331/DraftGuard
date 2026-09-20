import { useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import {
  ArrowRightIcon,
  FileArrowUpIcon,
  TrayIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  PaperclipIcon,
  MagnifyingGlassIcon,
  ArrowClockwiseIcon,
} from '@phosphor-icons/react'
import {
  requestJson,
  type DatasetEmail,
  type EmailSummary,
  type ExtractionRun,
  type Health,
  type Page,
  type RunSummary,
} from '../extraction/api'
import { useResource } from '../extraction/useResource'
import { RunInspector } from '../extraction/RunInspector'
import { RunStatus } from '../extraction/ExtractionStatus'
import { pageOffset, runPath, useExtractionParams } from '../extraction/navigation'
import '../extraction/extraction.css'

export function Extraction() {
  const { runId } = useParams()
  const health = useResource<Health>('/api/health')
  return (
    <div className="page extraction-page">
      <header className="page-heading extraction-heading">
        <div>
          <div className="eyebrow">LOCAL EXTRACTION</div>
          <h1>See every value. Follow its source.</h1>
          <p>Read real documents and inspect how each field was extracted.</p>
        </div>
        <span className="local-history-label">
          <DatabaseIcon size={16} aria-hidden="true" /> Local history
        </span>
      </header>
      {health.loading ? (
        <p role="status">Connecting to the extraction service…</p>
      ) : health.error ? (
        <div className="notice warning" role="alert">
          Cannot reach the backend. {health.error}
          <button className="button" onClick={health.reload}>
            Retry connection
          </button>
        </div>
      ) : !health.data?.capabilities?.development_extraction ? (
        <div className="notice warning">
          Local extraction is disabled. Start the backend with APP_ENV=development and
          ENABLE_DEV_EXTRACTION=true.
        </div>
      ) : runId ? (
        <RunInspector key={runId} runId={runId} />
      ) : (
        <ExtractionHome uploadLimit={health.data.capabilities.upload_limit_bytes} />
      )}
    </div>
  )
}

function ExtractionHome({ uploadLimit }: { uploadLimit: number }) {
  const { params, update } = useExtractionParams()
  const requestedSection = params.get('section')
  const section =
    requestedSection === 'upload' || requestedSection === 'history' ? requestedSection : 'dataset'
  const [busy, setBusy] = useState(false)
  return (
    <>
      <nav className="view-tabs extraction-tabs" aria-label="Extraction sections">
        <button
          className={section === 'dataset' ? 'active' : ''}
          disabled={busy}
          aria-pressed={section === 'dataset'}
          onClick={() => update({ section: null })}
        >
          <TrayIcon size={20} /> Dataset inbox
        </button>
        <button
          className={section === 'upload' ? 'active' : ''}
          disabled={busy}
          aria-pressed={section === 'upload'}
          onClick={() => update({ section: 'upload' })}
        >
          <FileArrowUpIcon size={20} /> Upload a document
        </button>
        <button
          className={section === 'history' ? 'active' : ''}
          disabled={busy}
          aria-pressed={section === 'history'}
          onClick={() => update({ section: 'history' })}
        >
          <ClockCounterClockwiseIcon size={20} /> History
        </button>
      </nav>
      {section === 'dataset' ? (
        <DatasetInbox busy={busy} onBusy={setBusy} />
      ) : section === 'upload' ? (
        <UploadDocument limit={uploadLimit} onBusy={setBusy} />
      ) : (
        <RunHistory />
      )}
    </>
  )
}

function DatasetInbox({ busy, onBusy }: { busy: boolean; onBusy: (value: boolean) => void }) {
  const { params, update } = useExtractionParams()
  const query = params.get('q') ?? ''
  const onlyAttachments = params.get('all') !== 'true'
  const offset = pageOffset(params.get('offset'))
  const selected = params.get('email') ?? ''
  const listing = useResource<Page<EmailSummary>>(
    `/api/v1/dev/emails?q=${encodeURIComponent(query)}&has_attachments=${onlyAttachments}&limit=20&offset=${offset}`,
  )
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    update({ q: String(new FormData(event.currentTarget).get('q') ?? '').trim(), offset: null })
  }
  return (
    <section className="panel extraction-panel">
      <div className="extraction-panel-heading">
        <div>
          <h2>Supplied email dataset</h2>
          <p>
            Choose an email to extract all its listed attachments. No manual file selection needed.
          </p>
        </div>
      </div>
      <form className="extraction-filters" onSubmit={filter}>
        <label className="extraction-search">
          Search emails
          <input
            key={query}
            name="q"
            defaultValue={query}
            placeholder="Email ID, sender, or subject"
            disabled={busy}
          />
        </label>
        <button className="button" disabled={busy}>
          <MagnifyingGlassIcon size={18} aria-hidden="true" /> Search
        </button>
        <label className="extraction-checkbox">
          <input
            type="checkbox"
            checked={onlyAttachments}
            disabled={busy}
            onChange={(e) => {
              update({ all: e.target.checked ? null : 'true', offset: null })
            }}
          />{' '}
          With attachments only
        </label>
      </form>
      {listing.error && (
        <p className="form-error" role="alert">
          {listing.error}{' '}
          <button className="button" onClick={listing.reload}>
            Retry
          </button>
        </p>
      )}
      <div className="extraction-inbox-grid">
        <div className="extraction-email-list">
          {listing.loading ? (
            <p role="status">Loading emails…</p>
          ) : (
            <>
              <p className="extraction-muted">
                {listing.data?.total ?? 0} matching emails · {listing.data?.dataset_total ?? 0}{' '}
                total
              </p>
              {listing.data?.items.map((email) => (
                <button
                  key={email.email_id}
                  className={`extraction-email ${selected === email.email_id ? 'selected' : ''}`}
                  aria-pressed={selected === email.email_id}
                  disabled={busy}
                  onClick={() => update({ email: email.email_id })}
                >
                  <span className="extraction-email-meta">
                    <strong>{email.email_id}</strong>
                    <span>
                      <PaperclipIcon size={14} aria-hidden="true" /> {email.attachment_count}{' '}
                      attachments
                    </span>
                  </span>
                  <span className="extraction-email-subject">{email.subject}</span>
                  <small>{email.from}</small>
                </button>
              ))}
              {listing.data?.items.length === 0 && <p>No emails match this search.</p>}
              <div className="extraction-pagination">
                <button
                  className="button"
                  disabled={busy || offset === 0}
                  onClick={() => update({ offset: String(Math.max(0, offset - 20)) })}
                >
                  Previous
                </button>
                <button
                  className="button"
                  disabled={busy || offset + 20 >= (listing.data?.total ?? 0)}
                  onClick={() => update({ offset: String(offset + 20) })}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
        <div>
          {selected ? (
            <EmailDetail key={selected} emailId={selected} onBusy={onBusy} />
          ) : (
            <div className="extraction-empty">
              <TrayIcon size={40} />
              <h3>Select an email</h3>
              <p>Its message and attachments will appear here.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function EmailDetail({ emailId, onBusy }: { emailId: string; onBusy: (value: boolean) => void }) {
  const location = useLocation()
  const email = useResource<DatasetEmail>(`/api/v1/dev/emails/${encodeURIComponent(emailId)}`)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const submitting = useRef(false)
  const navigate = useNavigate()
  async function extract() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    onBusy(true)
    setError('')
    try {
      const run = await requestJson<ExtractionRun>(
        `/api/v1/dev/emails/${encodeURIComponent(emailId)}/extract`,
        {
          method: 'POST',
        },
      )
      navigate(runPath(run.run_id, location.search))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      submitting.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  if (email.loading) return <p role="status">Opening email…</p>
  if (!email.data) return <p role="alert">{email.error}</p>
  return (
    <article className="extraction-email-detail">
      <span className="eyebrow">{email.data.email_id}</span>
      <h3>{email.data.subject}</h3>
      <p className="extraction-muted">From: {email.data.from}</p>
      <pre className="extraction-email-body">{email.data.body}</pre>
      <h4>Attachments ({email.data.attachments.length})</h4>
      {email.data.attachments.length ? (
        <ul className="extraction-attachment-list">
          {email.data.attachments.map((path, index) => (
            <li key={`${path}-${index}`}>
              <PaperclipIcon size={16} aria-hidden="true" /> {path.split('/').at(-1)}
            </li>
          ))}
        </ul>
      ) : (
        <p>No attachments in this email.</p>
      )}
      <button className="button primary" onClick={extract} disabled={busy}>
        {busy
          ? 'Extracting attachments…'
          : email.data.attachments.length
            ? 'Extract attachments'
            : 'Record no attachments'}
        <ArrowRightIcon size={18} />
      </button>
      {busy && (
        <p role="status">Reading each attachment and saving its audit. Keep this page open.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}

function UploadDocument({ limit, onBusy }: { limit: number; onBusy: (value: boolean) => void }) {
  const location = useLocation()
  const [file, setFile] = useState<File | null>(null),
    [role, setRole] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const submitting = useRef(false),
    navigate = useNavigate()
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || !file) return
    if (file.size > limit) {
      setError(`Choose a file smaller than ${limit / 1024 / 1024} MiB.`)
      return
    }
    submitting.current = true
    setBusy(true)
    onBusy(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    if (role) form.append('expected_role', role)
    try {
      const run = await requestJson<ExtractionRun>('/api/v1/dev/extract', {
        method: 'POST',
        body: form,
      })
      navigate(runPath(run.run_id, location.search))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      submitting.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  return (
    <section className="panel extraction-panel extraction-upload">
      <h2>Upload a document</h2>
      <p>Extract one source and save its original file, field values, and processing audit.</p>
      <form onSubmit={submit}>
        <label>
          Document
          <input
            type="file"
            accept=".txt,.pdf,.docx,.xlsx"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setError('')
            }}
          />
        </label>
        <p className="extraction-muted">
          TXT, PDF, DOCX, or XLSX · up to {limit / 1024 / 1024} MiB
        </p>
        <label>
          Expected document role
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
            <option value="">Detect from document</option>
            <option value="SI">Shipping Instruction (SI)</option>
            <option value="BL">Draft Bill of Lading (BL)</option>
          </select>
        </label>
        <button className="button primary" disabled={busy || !file}>
          <FileArrowUpIcon size={18} aria-hidden="true" />
          {busy ? 'Extracting document…' : 'Extract document'}
        </button>
        {busy && <p role="status">Reading the file and saving its audit…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}

function RunHistory() {
  const { params, update } = useExtractionParams()
  const location = useLocation()
  const offset = pageOffset(params.get('history_offset'))
  const history = useResource<Page<RunSummary>>(`/api/v1/dev/runs?limit=20&offset=${offset}`)
  return (
    <section className="panel extraction-panel">
      <div className="extraction-panel-heading">
        <div>
          <h2>Extraction history</h2>
          <p>
            Saved runs survive refreshes and backend restarts. Each rerun keeps a separate record.
          </p>
        </div>
        <button className="button" onClick={history.reload} disabled={history.loading}>
          <ArrowClockwiseIcon size={18} aria-hidden="true" /> Refresh history
        </button>
      </div>
      {history.loading && <p role="status">Loading history…</p>}
      {history.error && (
        <p className="form-error" role="alert">
          {history.error}
        </p>
      )}
      {history.data?.total === 0 && (
        <div className="extraction-empty">
          <ClockCounterClockwiseIcon size={40} />
          <p>No saved extractions yet.</p>
        </div>
      )}
      {history.data?.items.map((run) => (
        <Link
          className="extraction-history-row"
          key={run.run_id}
          to={runPath(run.run_id, location.search)}
        >
          <div>
            <strong>{run.source_label}</strong>
            <small>
              {new Date(run.created_at).toLocaleString()} · {run.document_count} documents
            </small>
          </div>
          <RunStatus run={run} />
          <ArrowRightIcon size={18} />
        </Link>
      ))}
      <div className="extraction-pagination">
        <button
          className="button"
          disabled={history.loading || offset === 0}
          onClick={() => update({ history_offset: String(Math.max(0, offset - 20)) })}
        >
          Previous
        </button>
        <button
          className="button"
          disabled={history.loading || offset + 20 >= (history.data?.total ?? 0)}
          onClick={() => update({ history_offset: String(offset + 20) })}
        >
          Next
        </button>
      </div>
      <p className="extraction-muted">
        Development history is shared by browsers connected to this local backend.
      </p>
    </section>
  )
}
