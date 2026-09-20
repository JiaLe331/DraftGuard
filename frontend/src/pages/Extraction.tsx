import { Link, Navigate, useLocation, useParams } from 'react-router'
import { ArrowLeftIcon, DatabaseIcon } from '@phosphor-icons/react'
import type { Health } from '../extraction/api'
import { useResource } from '../extraction/useResource'
import { RunInspector } from '../extraction/RunInspector'
import { UploadDocument } from '../extraction/UploadDocument'
import { legacyExtractionPath, returnPath } from '../extraction/navigation'
import '../extraction/extraction.css'
import '../extraction/audit.css'

export function LegacyExtractionRedirect() {
  const location = useLocation()
  return <Navigate to={legacyExtractionPath(location.search)} replace />
}

export function Extraction() {
  const { runId } = useParams()
  const location = useLocation()
  const health = useResource<Health>('/api/health')
  return (
    <div className="page extraction-page">
      <header className="page-heading extraction-heading">
        <div>
          <div className="eyebrow">LOCAL EXTRACTION</div>
          <h1>{runId ? 'Extraction results' : 'Upload document'}</h1>
          <p>Read real documents and inspect how each field was extracted.</p>
        </div>
        <span className="local-history-label">
          <DatabaseIcon size={16} aria-hidden="true" /> Local history
        </span>
      </header>
      {!runId && (
        <Link
          className="extraction-back"
          to={returnPath(new URLSearchParams(location.search).get('from'))}
        >
          <ArrowLeftIcon size={18} /> Back to Inbox
        </Link>
      )}
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
        <UploadDocument limit={health.data.capabilities.upload_limit_bytes} />
      )}
    </div>
  )
}
