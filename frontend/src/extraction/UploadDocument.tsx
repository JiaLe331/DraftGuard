import { useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { FileArrowUpIcon } from '@phosphor-icons/react'
import { requestJson, type ExtractionRun } from './api'
import { returnPath, runPath } from './navigation'

export function UploadDocument({ limit }: { limit: number }) {
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
    setError('')
    const form = new FormData()
    form.append('file', file)
    if (role) form.append('expected_role', role)
    try {
      const run = await requestJson<ExtractionRun>('/api/v1/dev/extract?wait=false', {
        method: 'POST',
        body: form,
      })
      navigate(runPath(run.run_id, returnPath(new URLSearchParams(location.search).get('from'))))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      submitting.current = false
      setBusy(false)
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
        {busy && <p role="status">Saving the file and starting extraction…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
