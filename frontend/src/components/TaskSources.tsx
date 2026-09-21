import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, request, taskPath } from '../mailbox/api'
import { fieldLabels, type SampleDetail } from '../mailbox/types'

export function CloneTask({
  sample,
  disabled = false,
}: {
  sample: SampleDetail
  disabled?: boolean
}) {
  const navigate = useNavigate()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function clone() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const task = await request<SampleDetail>('/api/v1/dev/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_id: sample.id }),
      })
      navigate(`/tasks/${task.id}`)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section className="panel task-sources">
      <h2>Check a revised document</h2>
      <p>
        Start a review to add or replace SI / BL sources. The original inbox email stays unchanged.
      </p>
      <button className="button primary" disabled={disabled || busy} onClick={clone}>
        {busy ? 'Starting review…' : 'Start review'}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  )
}

export function TaskSources({
  task,
  disabled,
  onSaved,
  reload,
}: {
  task: SampleDetail
  disabled: boolean
  onSaved: (task: SampleDetail) => Promise<void>
  reload: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [role, setRole] = useState('bl')
  const [si, setSi] = useState(task.current_si_id ?? '')
  const [bl, setBl] = useState(task.current_bl_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const lock = useRef(false)
  async function save(event: FormEvent, upload: boolean) {
    event.preventDefault()
    if (lock.current || disabled) return
    lock.current = true
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      let body: FormData | string
      if (upload) {
        if (!file) return
        const form = new FormData()
        form.append('file', file)
        form.append('role', role)
        form.append('expected_revision', String(task.revision))
        body = form
      } else
        body = JSON.stringify({
          si_id: si || null,
          bl_id: bl || null,
          expected_revision: task.revision,
        })
      const next = await request<SampleDetail>(
        `${taskPath(task.id)}/${upload ? 'documents' : 'pair'}`,
        {
          method: 'POST',
          body,
          ...(upload ? {} : { headers: { 'Content-Type': 'application/json' } }),
        },
      )
      await onSaved(next)
    } catch (failure) {
      setConflict(failure instanceof ApiError && failure.status === 409)
      setError(
        failure instanceof ApiError && failure.status === 409
          ? 'The source revision changed. Refresh the task before trying again.'
          : (failure as Error).message,
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const blocked = disabled || busy
  return (
    <section className="panel task-sources">
      <h2>Current source pair</h2>
      <p>
        Review workspace · Revision {task.revision}. Every saved change starts a new seven-field
        check.
      </p>
      <form onSubmit={(event) => save(event, true)}>
        <fieldset disabled={blocked}>
          <legend>Add or replace a source</legend>
          <label>
            Source role
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="si">Shipping Instruction (SI)</option>
              <option value="bl">Draft Bill of Lading (BL)</option>
            </select>
          </label>
          <label>
            Revised document
            <input
              type="file"
              accept=".txt,.pdf,.docx,.xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button className="button primary" disabled={!file}>
            Save source and recheck
          </button>
        </fieldset>
      </form>
      <details>
        <summary>Choose an existing SI / BL pair</summary>
        <form onSubmit={(event) => save(event, false)}>
          <fieldset disabled={blocked}>
            <legend>Explicit document selection</legend>
            {(['si', 'bl'] as const).map((side) => (
              <label key={side}>
                {side === 'si' ? 'SI document' : 'BL document'}
                <select
                  value={side === 'si' ? si : bl}
                  onChange={(event) => (side === 'si' ? setSi : setBl)(event.target.value)}
                >
                  <option value="">Missing source</option>
                  {task.documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.filename} · v{document.version}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              className="button"
              disabled={
                (si === (task.current_si_id ?? '') && bl === (task.current_bl_id ?? '')) ||
                (!!si && si === bl)
              }
            >
              Save pair and recheck
            </button>
          </fieldset>
        </form>
      </details>
      {busy && <p role="status">Saving sources and checking all seven fields…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {conflict && (
        <button className="button" onClick={reload}>
          Refresh current revision
        </button>
      )}
    </section>
  )
}

export function RevisionChanges({ task }: { task: SampleDetail }) {
  const delta = task.current_run?.result?.revision_delta
  if (!delta) return null
  return (
    <section className="panel revision-changes">
      <h2>Changes from the previous check</h2>
      <p>
        {delta.baseline_run_id
          ? `Compared with run ${delta.baseline_run_id}`
          : 'No earlier comparable check.'}
      </p>
      <dl>
        {(
          [
            ['resolved', 'Resolved'],
            ['persisting', 'Persisting'],
            ['new', 'New discrepancies'],
            ['uncertain', 'Changed to uncertain'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {delta[key].length
                ? delta[key].map((field) => fieldLabels[field]).join(', ')
                : 'None'}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
