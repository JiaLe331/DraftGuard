import { useEffect, useRef, useState } from 'react'
import { documentUrl } from '../mailbox/api'
import type { DocumentVersion, ParsedDocument } from '../mailbox/types'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'

export function DocumentPreview({
  emailId,
  document,
  parsed,
  initialPage = 1,
  onClose,
}: {
  emailId: string
  document: DocumentVersion
  parsed?: ParsedDocument
  initialPage?: number
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState(initialPage)
  const [pages, setPages] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ loading: boolean; text?: string; error?: string }>({
    loading: true,
  })
  const extension = document.filename.split('.').pop()?.toLowerCase()
  const original = extension === 'txt' || extension === 'pdf'
  const url = documentUrl(emailId, document.id)

  useEffect(() => {
    const node = dialog.current!
    const previous = window.document.activeElement as HTMLElement | null
    const overflow = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    node.showModal()
    return () => {
      node.close()
      window.document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])

  useEffect(() => {
    if (!original) return
    const controller = new AbortController()
    let disposed = false
    let loadingTask: PDFDocumentLoadingTask | undefined
    async function load() {
      setState({ loading: true })
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        })
        if (!response.ok)
          throw new Error(`The original file could not be loaded (${response.status}).`)
        const bytes = await response.arrayBuffer()
        if (disposed) return
        if (extension === 'txt') {
          setState({
            loading: false,
            text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          })
          return
        }
        const pdf = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        if (disposed) return
        pdf.GlobalWorkerOptions.workerSrc = worker.default
        loadingTask = pdf.getDocument({ data: new Uint8Array(bytes) })
        const file = await loadingTask.promise
        if (disposed) return
        if (file.numPages > 20) throw new Error('This PDF exceeds the 20-page preview limit.')
        setPages(file.numPages)
        const source = await file.getPage(Math.min(page, file.numPages))
        if (disposed) return
        const viewport = source.getViewport({ scale: 1.4 })
        const target = canvas.current!
        target.width = viewport.width
        target.height = viewport.height
        await source.render({ canvas: target, viewport }).promise
        if (!disposed) setState({ loading: false })
      } catch (error) {
        if (!disposed)
          setState({
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : 'Preview unavailable. Download the original file to inspect it.',
          })
      }
    }
    void load()
    return () => {
      disposed = true
      controller.abort()
      if (loadingTask) void loadingTask.destroy()
    }
  }, [url, extension, original, page, attempt])

  return (
    <dialog
      ref={dialog}
      className="document-preview"
      aria-labelledby="document-preview-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className="preview-heading">
        <div>
          <h2 id="document-preview-title">{document.filename}</h2>
          <p>
            {original ? 'Original file' : 'Extracted content · not the original document layout'} ·
            Version {document.version}
          </p>
        </div>
        <button className="button" onClick={onClose}>
          Close preview
        </button>
      </header>
      <div className="preview-toolbar">
        <a className="button compact" href={`${url}?download=true`} download={document.filename}>
          Download original
        </a>
        {extension === 'pdf' && pages > 0 && (
          <div className="preview-pagination">
            <button
              className="button compact"
              disabled={page <= 1 || state.loading}
              onClick={() => setPage(page - 1)}
            >
              Previous page
            </button>
            <span>
              Page {Math.min(page, pages)} of {pages}
            </span>
            <button
              className="button compact"
              disabled={page >= pages || state.loading}
              onClick={() => setPage(page + 1)}
            >
              Next page
            </button>
          </div>
        )}
      </div>
      <div className="preview-body" aria-busy={original && state.loading}>
        {original && state.loading && <p role="status">Loading original document…</p>}
        {original && state.error && (
          <div role="alert">
            <p>{state.error}</p>
            <button className="button" onClick={() => setAttempt(attempt + 1)}>
              Retry preview
            </button>
          </div>
        )}
        {extension === 'txt' && state.text !== undefined && (
          <pre className="preview-text">{state.text}</pre>
        )}
        {extension === 'pdf' && (
          <canvas
            ref={canvas}
            hidden={state.loading || !!state.error}
            role="img"
            aria-label={`Original PDF, page ${page}`}
          />
        )}
        {!original &&
          (parsed?.units.length ? (
            parsed.units.map((unit) => (
              <section className="source-unit" key={unit.id}>
                <small>{unit.locator}</small>
                <pre>{unit.text}</pre>
              </section>
            ))
          ) : (
            <p>
              {parsed?.error?.message ??
                'No extracted content is available yet. Analyze this email or download the original file.'}
            </p>
          ))}
        {extension === 'pdf' && !!parsed?.units.length && (
          <details>
            <summary>Accessible extracted text</summary>
            {parsed.units
              .filter((unit) => unit.page === page)
              .map((unit) => (
                <section className="source-unit" key={unit.id}>
                  <small>{unit.locator}</small>
                  <pre>{unit.text}</pre>
                </section>
              ))}
          </details>
        )}
      </div>
    </dialog>
  )
}
