import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  WarningCircleIcon,
  ClockIcon,
  ClipboardTextIcon,
  CaretDownIcon,
  TrayIcon,
  FileArrowUpIcon,
  PlusIcon,
} from '@phosphor-icons/react'
import { request, useResource } from '../mailbox/api'
import type { Health } from '../extraction/api'
import { useMailbox } from '../mailbox/context'
import {
  analyzedAt,
  categoryLabels,
  statusLabels,
  taskAction,
  type SampleDetail,
  type SampleList,
} from '../mailbox/types'
import { Avatar, Dialog, EmptyState, StatusBadge } from '../components/Primitives'

const cards = [
  {
    key: '',
    label: 'Emails in your mailbox',
    caption: 'Provided dataset · all categories',
    icon: TrayIcon,
    color: 'blue',
  },
  {
    key: 'ATTENTION',
    label: 'Needs attention',
    caption: 'Differences, uncertainty & failures',
    icon: WarningCircleIcon,
    color: 'amber',
  },
  {
    key: 'NOT_ANALYZED',
    label: 'Awaiting analysis',
    caption: 'Open an email to start a check',
    icon: ClockIcon,
    color: 'slate',
  },
  {
    key: 'READY',
    label: 'Ready for review',
    caption: 'Seven fields match · not approved',
    icon: ClipboardTextIcon,
    color: 'teal',
  },
]
export function Overview({ inbox = false }: { inbox?: boolean }) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const { refresh } = useMailbox()
  const query = new URLSearchParams()
  for (const name of ['q', 'category', 'status', 'page']) {
    if (params.get(name)) query.set(name, params.get(name)!)
  }
  const { data, error, reload } = useResource<SampleList>(`/api/v1/samples?${query}`)
  const status = params.get('status') ?? ''
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    if (key === 'status' && value === 'NOT_ANALYZED') next.delete('category')
    setParams(next)
  }
  function retry() {
    reload()
    refresh()
  }
  const counts: Record<string, number> = {
    '': data?.summary.total ?? 0,
    ATTENTION:
      (data?.summary.states.REVIEW_REQUIRED ?? 0) +
      (data?.summary.states.DISCREPANCIES_FOUND ?? 0) +
      (data?.summary.states.FAILED ?? 0),
    NOT_ANALYZED: data?.summary.states.NOT_ANALYZED ?? 0,
    READY: data?.summary.states.READY ?? 0,
  }
  const from = location.pathname + location.search
  return (
    <div className="page overview-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR DOCUMENT WORKSPACE</div>
          <h1>{inbox ? 'Inbox' : 'A clear view of what’s next.'}</h1>
          <p>
            {inbox
              ? 'Your provided emails, their original attachments, and real analysis.'
              : 'Source-backed results. A clear next step for every document check.'}
          </p>
        </div>
        {inbox ? (
          <InboxActions from={from} />
        ) : (
          <div className="page-date">
            Demo mailbox<span>Provided dataset</span>
          </div>
        )}
      </div>
      {inbox && <LocalTasks />}
      {!inbox && (
        <div className="stats-grid">
          {cards.map(({ key, label, caption, icon: Icon, color }) => (
            <button
              key={key}
              className={`stat-card ${status === key ? 'selected' : ''}`}
              aria-pressed={status === key}
              onClick={() => setFilter('status', key)}
            >
              <span className="stat-top">
                <span className={`stat-icon ${color}`}>
                  <Icon size={21} />
                </span>
                <ArrowUpRightIcon size={17} />
              </span>
              <strong className="stat-number">{data ? counts[key] : '—'}</strong>
              <span className="stat-label">{label}</span>
              <span className="stat-caption">{caption}</span>
            </button>
          ))}
        </div>
      )}
      <section className="queue-panel" aria-labelledby="queue-title">
        <div className="queue-heading">
          <div>
            <h2 id="queue-title">
              {inbox ? 'All emails' : 'Your work queue'}
              {data && <span className="count-pill">{data.total}</span>}
            </h2>
            <p>Dataset order · results from actual source files</p>
          </div>
          <button className="button compact" onClick={retry}>
            Refresh
          </button>
        </div>
        <div className="filter-bar">
          <div className="view-tabs" aria-label="Task type">
            <button
              className={!params.get('category') ? 'active' : ''}
              onClick={() => setFilter('category', '')}
            >
              All emails
            </button>
            <button
              className={params.get('category') === 'BL_COMPARISON' ? 'active' : ''}
              onClick={() => setFilter('category', 'BL_COMPARISON')}
            >
              Document checks
            </button>
          </div>
          <div className="filter-controls">
            <label className="select-wrap">
              <span className="sr-only">Filter by status</span>
              <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">All statuses</option>
                <option value="ATTENTION">Needs attention</option>
                {(
                  [
                    'NOT_ANALYZED',
                    'RUNNING',
                    'FAILED',
                    'WAITING_DOCUMENT',
                    'REVIEW_REQUIRED',
                    'DISCREPANCIES_FOUND',
                    'READY',
                    'NOT_APPLICABLE',
                  ] as const
                ).map((key) => (
                  <option key={key} value={key}>
                    {statusLabels[key]}
                  </option>
                ))}
              </select>
              <CaretDownIcon aria-hidden="true" size={14} weight="bold" />
            </label>
            <label className="select-wrap">
              <span className="sr-only">Filter by category</span>
              <select
                value={params.get('category') ?? ''}
                onChange={(e) => setFilter('category', e.target.value)}
              >
                <option value="">All categories</option>
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
                <option value="UNCLASSIFIED">Needs classification</option>
              </select>
              <CaretDownIcon aria-hidden="true" size={14} weight="bold" />
            </label>
          </div>
        </div>
        {params.get('q') && (
          <div className="search-summary">
            Results for “{params.get('q')}”
            <button className="text-button" onClick={() => setFilter('q', '')}>
              Clear search
            </button>
          </div>
        )}
        {error ? (
          <EmptyState title="The mailbox could not be loaded" tone="error">
            <p role="alert">{error.message}</p>
            <button className="button primary" onClick={retry}>
              Retry connection
            </button>
          </EmptyState>
        ) : !data ? (
          <div className="empty-state" role="status">
            Loading mailbox…
          </div>
        ) : data.summary.total === 0 ? (
          <EmptyState title="Your dataset has not been imported">
            <p>
              Import the provided dataset using the local setup instructions, then refresh this
              mailbox.
            </p>
          </EmptyState>
        ) : data.items.length === 0 ? (
          <EmptyState title="No emails on this page">
            <p>Try another search, filter, or page.</p>
            <button className="button" onClick={() => setParams({})}>
              Clear filters
            </button>
          </EmptyState>
        ) : (
          <div className="task-table" role="table" aria-label="Emails">
            <div className="task-table-head task-grid" role="row">
              {['EMAIL / SHIPMENT', 'CATEGORY', 'FINDING', 'NEXT ACTION', 'LAST ANALYZED'].map(
                (label) => (
                  <span key={label} role="columnheader">
                    {label}
                  </span>
                ),
              )}
            </div>
            <div role="rowgroup">
              {data.items.map((task) => (
                <div
                  key={task.id}
                  className={`task-row task-grid ${['REVIEW_REQUIRED', 'DISCREPANCIES_FOUND', 'FAILED'].includes(task.workflow_state) ? 'has-attention' : ''}`}
                  role="row"
                >
                  <div className="task-mail" role="cell">
                    <Avatar initials={task.sender.slice(0, 2).toUpperCase()} />
                    <div className="mail-text">
                      <div className="sender-line">{task.sender}</div>
                      <Link className="mail-subject" to={`/tasks/${task.id}`} state={{ from }}>
                        {task.subject}
                      </Link>
                      <div className="mail-meta">
                        {task.id} · {task.attachment_count} attachments
                      </div>
                    </div>
                  </div>
                  <div className="task-category" role="cell">
                    <span
                      className={`category-tag ${task.category === 'BL_COMPARISON' ? 'comparison' : ''}`}
                    >
                      {task.category
                        ? categoryLabels[task.category]
                        : task.workflow_state === 'NOT_ANALYZED'
                          ? 'Not classified yet'
                          : 'Needs classification'}
                    </span>
                  </div>
                  <div className="task-finding" role="cell">
                    <StatusBadge status={task.workflow_state} />
                    {task.category === 'BL_COMPARISON' && (
                      <span className="finding-detail">
                        {task.known_defect_fields.length} discrepancies · {task.coverage.checked}/7
                        checked
                      </span>
                    )}
                  </div>
                  <div className="task-action" role="cell">
                    <Link
                      className="row-action emphasized"
                      to={`/tasks/${task.id}`}
                      state={{ from }}
                    >
                      {taskAction(task)}
                      <ArrowRightIcon size={15} />
                    </Link>
                  </div>
                  <div className="task-time" role="cell">
                    {analyzedAt(task.last_analyzed)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {data && data.total > 0 && (
          <nav className="queue-footer pagination" aria-label="Mailbox pages">
            <span>
              {Math.min((data.page - 1) * data.limit + 1, data.total)}–
              {Math.min(data.page * data.limit, data.total)} of {data.total}
            </span>
            <div>
              <button
                className="button compact"
                disabled={data.page <= 1}
                onClick={() => setFilter('page', String(data.page - 1))}
              >
                Previous
              </button>
              <button
                className="button compact"
                disabled={data.page * data.limit >= data.total}
                onClick={() => setFilter('page', String(data.page + 1))}
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </section>
      <div className="page-footnote">
        Demo mailbox · Provided dataset
        <span>Rule analysis · Saved locally · No Gmail connection</span>
      </div>
    </div>
  )
}

function InboxActions({ from }: { from: string }) {
  const { data } = useResource<Health>('/api/health')
  return (
    <div className="inbox-actions">
      {data?.capabilities?.development_tasks && <CreateTaskButton />}
      {data?.capabilities?.development_extraction && (
        <Link className="button" to={`/inbox/upload?from=${encodeURIComponent(from)}`}>
          <FileArrowUpIcon size={18} aria-hidden="true" /> Upload document
        </Link>
      )}
    </div>
  )
}

type TaskDraft = { subject: string; sender: string; body: string }
type DraftField = keyof TaskDraft
const emptyDraft: TaskDraft = { subject: '', sender: '', body: '' }

function CreateTaskButton() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refs = {
    subject: useRef<HTMLInputElement>(null),
    sender: useRef<HTMLInputElement>(null),
    body: useRef<HTMLTextAreaElement>(null),
  }
  const limits: Record<DraftField, number> = { subject: 500, sender: 320, body: 50000 }
  const fieldError = (field: DraftField) => {
    const value = draft[field].trim()
    if (!value) return 'This field is required.'
    if (value.length > limits[field])
      return `Use ${limits[field].toLocaleString()} characters or fewer.`
    return ''
  }
  function close() {
    if (busy) return
    if (
      Object.values(draft).some((value) => value.trim()) &&
      !window.confirm('Discard this unsaved local task?')
    )
      return
    setOpen(false)
    setDraft(emptyDraft)
    setTouched({})
    setError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const fields: DraftField[] = ['subject', 'sender', 'body']
    setTouched({ subject: true, sender: true, body: true })
    const firstInvalid = fields.find((field) => fieldError(field))
    if (firstInvalid) {
      refs[firstInvalid].current?.focus()
      return
    }
    setBusy(true)
    setError('')
    try {
      const task = await request<SampleDetail>('/api/v1/dev/tasks/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      setOpen(false)
      navigate(`/tasks/${task.id}`, { state: { from: '/inbox', focusHeading: true } })
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button className="button primary" onClick={() => setOpen(true)}>
        <PlusIcon size={18} aria-hidden="true" /> Create local task
      </button>
      {open && (
        <Dialog title="Create local task" onClose={close}>
          <form className="create-task-form" onSubmit={(event) => void submit(event)} noValidate>
            <p className="dialog-intro">
              Start with the email context, then add SI and BL sources in the workspace.
            </p>
            {(['subject', 'sender', 'body'] as DraftField[]).map((field) => {
              const label =
                field === 'body' ? 'Email body' : field[0].toUpperCase() + field.slice(1)
              const invalid = touched[field] ? fieldError(field) : ''
              const common = {
                id: `task-${field}`,
                required: true,
                maxLength: limits[field],
                value: draft[field],
                'aria-invalid': !!invalid,
                'aria-describedby': `task-${field}-help${invalid ? ` task-${field}-error` : ''}`,
                onBlur: () => setTouched((value) => ({ ...value, [field]: true })),
                onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  setDraft((value) => ({ ...value, [field]: event.target.value })),
              }
              return (
                <label className="form-field" htmlFor={`task-${field}`} key={field}>
                  <span>
                    {label} <span aria-hidden="true">*</span>
                  </span>
                  {field === 'body' ? (
                    <textarea {...common} ref={refs.body} rows={7} />
                  ) : (
                    <input {...common} ref={refs[field]} />
                  )}
                  <small id={`task-${field}-help`}>
                    {field === 'subject'
                      ? 'Shown as the task title.'
                      : field === 'sender'
                        ? 'Name or email from the original message.'
                        : 'Up to 50,000 characters; stored only in the local demo.'}
                  </small>
                  {invalid && (
                    <span className="field-error" id={`task-${field}-error`} role="alert">
                      {invalid}
                    </span>
                  )}
                </label>
              )
            })}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="editor-actions">
              <button className="button" type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <span className="button-spinner" aria-hidden="true" />}
                {busy ? 'Creating task…' : 'Create task'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}

function LocalTasks() {
  const { data } = useResource<Health>('/api/health')
  return data?.capabilities?.development_tasks ? <LocalTaskList /> : null
}
function LocalTaskList() {
  const [page, setPage] = useState(1)
  const { data, error, reload } = useResource<SampleList>(`/api/v1/dev/tasks?page=${page}`)
  return (
    <section className="panel local-tasks">
      <div className="panel-heading">
        <div>
          <h2>Recent local tasks</h2>
          <p>Custom tasks and working copies saved on this development server.</p>
        </div>
        <button className="button compact" onClick={reload}>
          Refresh working copies
        </button>
      </div>
      {error ? (
        <p role="alert">{error.message}</p>
      ) : !data ? (
        <p role="status">Loading working copies…</p>
      ) : data.items.length === 0 ? (
        <p>Open a pre-analyzed inbox email and choose Start review to check revised sources.</p>
      ) : (
        <ul>
          {data.items.map((task) => (
            <li key={task.id}>
              <Link to={`/tasks/${task.id}`} state={{ from: '/inbox' }}>
                {task.subject}
              </Link>
              <span>Revision {task.revision}</span>
              <StatusBadge status={task.workflow_state} />
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.limit && (
        <nav className="pagination" aria-label="Working copy pages">
          <span>
            Page {data.page} · {data.total} working copies
          </span>
          <div>
            <button
              className="button compact"
              disabled={data.page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous working copies
            </button>
            <button
              className="button compact"
              disabled={data.page * data.limit >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Next working copies
            </button>
          </div>
        </nav>
      )}
    </section>
  )
}
