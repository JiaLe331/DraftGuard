import { Link, useLocation, useSearchParams } from 'react-router'
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  WarningCircleIcon,
  ClockIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  FunnelSimpleIcon,
  EnvelopeSimpleIcon,
  CaretDownIcon,
} from '@phosphor-icons/react'
import { useDemo } from '../demo/context'
import {
  actionLabel,
  categoryLabels,
  filterTasks,
  firstAttentionField,
  summary,
  workflow,
  workflowLabels,
  type Workflow,
} from '../demo/model'
import { Avatar, EmptyState, StatusBadge } from '../components/Primitives'

const statusCards = [
  {
    key: 'attention',
    label: 'Needs attention',
    caption: 'Resolve differences & review values',
    icon: WarningCircleIcon,
    color: 'amber',
  },
  {
    key: 'waiting',
    label: 'Awaiting documents',
    caption: 'Waiting for the right source files',
    icon: ClockIcon,
    color: 'slate',
  },
  {
    key: 'ready',
    label: 'Ready for review',
    caption: 'All fields match. Your check is next.',
    icon: ClipboardTextIcon,
    color: 'blue',
  },
  {
    key: 'completed',
    label: 'Completed',
    caption: 'Current version reviewed',
    icon: CheckCircleIcon,
    color: 'teal',
  },
] as const
export function Overview({ inbox = false }: { inbox?: boolean }) {
  const { tasks } = useDemo()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const filters = {
    query: params.get('q') ?? '',
    status: params.get('status') ?? '',
    category: params.get('category') ?? '',
    sort: params.get('sort') ?? (inbox ? 'newest' : 'priority'),
  }
  const filtered = filterTasks(tasks, filters)
  const count = (state: Workflow) => tasks.filter((t) => workflow(t) === state).length
  const from = location.pathname + location.search
  const taskIds = filtered
    .filter((t) => !['completed', 'other'].includes(workflow(t)))
    .map((t) => t.id)
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  return (
    <div className="page overview-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR DOCUMENT WORKSPACE</div>
          <h1>{inbox ? 'Inbox' : 'A clear view of what’s next.'}</h1>
          <p>
            {inbox
              ? 'Every email, already classified. Find the conversation you need.'
              : 'Your documents are organized. Let’s take care of what needs you.'}
          </p>
        </div>
        <span className="page-date">
          Sample workspace <span>20 September 2026</span>
        </span>
      </div>
      {!inbox && (
        <div className="stats-grid">
          {statusCards.map(({ key, label, caption, icon: Icon, color }) => (
            <button
              key={key}
              className={`stat-card ${filters.status === key ? 'selected' : ''}`}
              aria-pressed={filters.status === key}
              onClick={() => setFilter('status', filters.status === key ? '' : key)}
            >
              <span className="stat-top">
                <span className={`stat-icon ${color}`}>
                  <Icon size={21} />
                </span>
                <ArrowUpRightIcon className="stat-arrow" size={17} />
              </span>
              <strong className="stat-number">{count(key)}</strong>
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
              {inbox
                ? 'All emails'
                : filters.status
                  ? (workflowLabels[filters.status as Workflow] ?? 'Your work queue')
                  : 'Your work queue'}
              <span className="count-pill">{filtered.length}</span>
            </h2>
            <p>
              {inbox
                ? 'Select a message to see its context and next steps.'
                : 'Already classified. Prioritized for your next action.'}
            </p>
          </div>
          <div className="queue-legend">
            <span className="sample-dot" />
            Sample results
          </div>
        </div>
        <div className="filter-bar">
          <div className="view-tabs" aria-label="Task type">
            <button
              className={!filters.category ? 'active' : ''}
              onClick={() => setFilter('category', '')}
            >
              All emails
            </button>
            <button
              className={filters.category === 'BL_COMPARISON' ? 'active' : ''}
              onClick={() => setFilter('category', 'BL_COMPARISON')}
            >
              Document checks
            </button>
          </div>
          <div className="filter-controls">
            <FunnelSimpleIcon size={17} aria-hidden="true" />
            <label className="select-wrap">
              <span className="sr-only">Filter by status</span>
              <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">All statuses</option>
                {Object.entries(workflowLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <CaretDownIcon size={12} />
            </label>
            <label className="select-wrap category-filter">
              <span className="sr-only">Filter by category</span>
              <select
                value={filters.category}
                onChange={(e) => setFilter('category', e.target.value)}
              >
                <option value="">All categories</option>
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <CaretDownIcon size={12} />
            </label>
            <label className="select-wrap">
              <span className="sr-only">Sort tasks</span>
              <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)}>
                <option value="priority">Priority first</option>
                <option value="newest">Newest first</option>
              </select>
              <CaretDownIcon size={12} />
            </label>
          </div>
        </div>
        {filters.query && (
          <div className="search-summary">
            Results for “{filters.query}”
            <button className="text-button" onClick={() => setFilter('q', '')}>
              Clear search
            </button>
          </div>
        )}
        {filtered.length ? (
          <div
            className="task-table"
            role="table"
            aria-label={inbox ? 'Emails' : 'Document work queue'}
          >
            <div className="task-table-head task-grid" role="row">
              <span role="columnheader">EMAIL / SHIPMENT</span>
              <span role="columnheader">CATEGORY</span>
              <span role="columnheader">{inbox ? 'STATUS' : 'FINDING'}</span>
              <span role="columnheader">NEXT ACTION</span>
              <span role="columnheader">UPDATED</span>
            </div>
            <div role="rowgroup">
              {filtered.map((task) => (
                <div
                  key={task.id}
                  className={`task-row task-grid ${workflow(task) === 'attention' ? 'has-attention' : ''}`}
                  role="row"
                >
                  <div className="task-mail" role="cell">
                    <Avatar initials={task.initials} color={task.color} />
                    <div className="mail-text">
                      <div className="sender-line">
                        {task.sender}
                        <span>#{task.reference}</span>
                      </div>
                      <Link
                        className="mail-subject"
                        to={`/tasks/${task.id}?field=${firstAttentionField(task)}`}
                        state={{ from, taskIds }}
                      >
                        {task.subject}
                      </Link>
                      <div className="mail-meta">
                        {inbox ? task.body.split('\n').find((s) => s.length > 25) : task.route}
                      </div>
                    </div>
                  </div>
                  <div className="task-category" role="cell">
                    <span
                      className={`category-tag ${task.category === 'BL_COMPARISON' ? 'comparison' : ''}`}
                    >
                      {categoryLabels[task.category]}
                    </span>
                  </div>
                  <div className="task-finding" role="cell">
                    <StatusBadge status={workflow(task)} />
                    <span className="finding-detail">{summary(task)}</span>
                  </div>
                  <div className="task-action" role="cell">
                    <Link
                      className={`row-action ${workflow(task) === 'attention' ? 'emphasized' : ''}`}
                      to={`/tasks/${task.id}?field=${firstAttentionField(task)}`}
                      state={{ from, taskIds }}
                    >
                      {actionLabel(task)}
                      <ArrowRightIcon size={15} />
                    </Link>
                  </div>
                  <time role="cell" className="task-time" dateTime={task.updatedAt}>
                    {new Date(task.updatedAt).toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kuala_Lumpur',
                    })}
                  </time>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title={filters.query ? 'No matching emails' : 'Nothing in this view'}>
            <p>Try another search or clear your filters to see all sample tasks.</p>
            <button className="button" onClick={() => setParams({})}>
              Clear filters
            </button>
          </EmptyState>
        )}
        <div className="queue-footer">
          <span>
            Showing {filtered.length} of {tasks.length} emails
          </span>
          <span>
            <EnvelopeSimpleIcon size={15} />
            Team-authored demo workspace
          </span>
        </div>
      </section>
      <p className="page-footnote">
        <ShieldNote />A little clarity, before the next shipment.{' '}
        <span>Sample results are illustrative, not live AI analysis.</span>
      </p>
    </div>
  )
}
function ShieldNote() {
  return <CheckCircleIcon size={17} aria-hidden="true" />
}
