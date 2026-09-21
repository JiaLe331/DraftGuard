import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import { documentUrl } from '../mailbox/api'
import type { DocumentVersion } from '../mailbox/types'

export function InlinePdfPage({
  emailId,
  document,
  page,
}: {
  emailId: string
  document: DocumentVersion
  page: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: true })
  const url = documentUrl(emailId, document.id)

  useEffect(() => {
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
          throw new Error(`The original PDF could not be loaded (${response.status}).`)
        const bytes = await response.arrayBuffer()
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        if (disposed) return
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) })
        const file = await loadingTask.promise
        if (page > file.numPages) throw new Error('The candidate page is outside this PDF.')
        const source = await file.getPage(page)
        if (disposed) return
        const viewport = source.getViewport({ scale: 1.15 })
        const target = canvas.current!
        target.width = viewport.width
        target.height = viewport.height
        await source.render({ canvas: target, viewport }).promise
        if (!disposed) setState({ loading: false })
      } catch (error) {
        if (!disposed)
          setState({
            loading: false,
            error: error instanceof Error ? error.message : 'The PDF preview is unavailable.',
          })
      }
    }
    void load()
    return () => {
      disposed = true
      controller.abort()
      if (loadingTask) void loadingTask.destroy()
    }
  }, [attempt, page, url])

  return (
    <div className="inline-pdf" aria-busy={state.loading}>
      {state.loading && <p role="status">Loading source page…</p>}
      {state.error && (
        <div role="alert">
          <p>{state.error}</p>
          <button className="button compact" onClick={() => setAttempt((value) => value + 1)}>
            Retry preview
          </button>
        </div>
      )}
      <canvas
        ref={canvas}
        hidden={state.loading || !!state.error}
        role="img"
        aria-label={`Original PDF source, page ${page}`}
      />
    </div>
  )
}
