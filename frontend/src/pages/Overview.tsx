import { Link, useLocation, useSearchParams } from 'react-router'
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  WarningCircleIcon,
  ClockIcon,
  ClipboardTextIcon,
  TrayIcon,
  FileArrowUpIcon,
} from '@phosphor-icons/react'
import { useResource } from '../mailbox/api'
import type { Health } from '../extraction/api'
import { useMailbox } from '../mailbox/context'
import {
  analyzedAt,
  categoryLabels,
  statusLabels,
  taskAction,
  type SampleList,
} from '../mailbox/types'
import { Avatar, EmptyState, StatusBadge } from '../components/Primitives'

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
    key: 'WAITING_DOCUMENT',
    label: 'Awaiting documents',
    caption: 'Waiting for the source pair',
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
    WAITING_DOCUMENT: data?.summary.states.WAITING_DOCUMENT ?? 0,
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
          <UploadLink from={from} />
        ) : (
          <div className="page-date">
            Demo mailbox<span>Provided dataset</span>
          </div>
        )}
      </div>
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
          <EmptyState title="The mailbox could not be loaded">
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
                      {task.category ? categoryLabels[task.category] : 'Needs classification'}
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

function UploadLink({ from }: { from: string }) {
  const { data } = useResource<Health>('/api/health')
  if (!data?.capabilities?.development_extraction) return null
  return (
    <Link className="button primary" to={`/inbox/upload?from=${encodeURIComponent(from)}`}>
      <FileArrowUpIcon size={18} aria-hidden="true" /> Upload document
    </Link>
  )
}
