import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  SquaresFourIcon,
  TrayIcon,
  MagnifyingGlassIcon,
  ListIcon,
  ArrowUpRightIcon,
  ShieldCheckIcon,
  XIcon,
  ListMagnifyingGlassIcon,
} from '@phosphor-icons/react'
import { useMailbox } from '../mailbox/context'
import { requestJson, type Health } from '../extraction/api'
const scrollPositions = new Map<string, number>()
export function Shell() {
  const { summary } = useMailbox()
  const [menuOpen, setMenuOpen] = useState(false)
  const [extractionEnabled, setExtractionEnabled] = useState(false)
  const location = useLocation(),
    navigate = useNavigate()
  const [params] = useSearchParams()
  const main = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const routeKey = location.pathname + location.search
  const isExtraction =
    location.pathname === '/inbox/upload' ||
    location.pathname.startsWith('/extraction') ||
    location.pathname.startsWith('/audit')
  useEffect(() => {
    const controller = new AbortController()
    requestJson<Health>('/api/health', { signal: controller.signal })
      .then((health) => {
        if (!controller.signal.aborted)
          setExtractionEnabled(!!health.capabilities?.development_extraction)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  const previousPath = useRef('')
  useEffect(() => {
    const element = main.current
    if (element && previousPath.current !== location.pathname) {
      element.scrollTop = scrollPositions.get(routeKey) ?? 0
      element.focus({ preventScroll: true })
    }
    previousPath.current = location.pathname
  }, [routeKey, location.pathname])
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new URLSearchParams(location.pathname.startsWith('/tasks/') ? '' : params)
    next.delete('page')
    const query = searchRef.current?.value.trim() ?? ''
    if (query) next.set('q', query)
    else next.delete('q')
    navigate(`${location.pathname === '/inbox' ? '/inbox' : '/overview'}?${next}`)
  }
  return (
    <div className={`app-shell ${isExtraction ? 'local-extraction-shell' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="topbar" inert={menuOpen}>
        <div className="brand-area">
          <button
            className="icon-button menu-toggle"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <ListIcon size={23} />
          </button>
          <Link className="brand" to="/overview">
            <span>DraftGuard</span>
            <span className="brand-period">.</span>
          </Link>
        </div>
        {!isExtraction && (
          <form className="global-search" role="search" onSubmit={search}>
            <MagnifyingGlassIcon size={21} aria-hidden="true" />
            <input
              key={params.get('q') ?? ''}
              ref={searchRef}
              aria-label="Search emails, shipments, or senders"
              placeholder="Search emails or shipments"
              defaultValue={params.get('q') ?? ''}
            />
            <kbd aria-hidden="true">↵</kbd>
          </form>
        )}
        <div className="header-end">
          <span className="sample-label">
            <span />
            {isExtraction ? 'Local extraction' : 'Provided dataset'}
          </span>
          <div className="reviewer-avatar" title="Demo reviewer — unverified">
            D
          </div>
        </div>
      </header>
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-top">
          <span className="eyebrow">WORKSPACE</span>
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          >
            <XIcon size={20} />
          </button>
        </div>
        <nav>
          <NavLink to="/overview" onClick={() => setMenuOpen(false)}>
            <SquaresFourIcon size={21} />
            <span>Overview</span>
            <span className="nav-count">
              {summary
                ? (summary.states.REVIEW_REQUIRED ?? 0) +
                  (summary.states.DISCREPANCIES_FOUND ?? 0) +
                  (summary.states.FAILED ?? 0)
                : '—'}
            </span>
          </NavLink>
          <NavLink
            to="/inbox"
            className={({ isActive }) =>
              isActive || location.pathname.startsWith('/extraction/runs/') ? 'active' : ''
            }
            onClick={() => setMenuOpen(false)}
          >
            <TrayIcon size={21} />
            <span>Inbox</span>
            <span className="nav-count muted">{summary?.total ?? '—'}</span>
          </NavLink>
          {extractionEnabled && (
            <NavLink to="/audit" onClick={() => setMenuOpen(false)}>
              <ListMagnifyingGlassIcon size={21} />
              <span>Audit Trail</span>
            </NavLink>
          )}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <ShieldCheckIcon size={22} />
          </span>
          <strong>
            A clearer path to
            <br />a checked draft.
          </strong>
          <p>From incoming email to evidence-backed review.</p>
          <Link to="/overview?status=ATTENTION" onClick={() => setMenuOpen(false)}>
            View your queue <ArrowUpRightIcon size={15} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <p>
            <span className="local-dot" />
            {isExtraction ? 'Local extraction' : 'Local analysis'}
          </p>
          <small>
            {isExtraction ? 'Extraction history' : 'Demo mailbox'}.
            <br />
            Results saved on this backend.
          </small>
        </div>
      </aside>
      <main
        ref={main}
        id="main-content"
        tabIndex={-1}
        inert={menuOpen}
        className="main-content"
        onScroll={(event) => scrollPositions.set(routeKey, event.currentTarget.scrollTop)}
      >
        <Outlet />
      </main>
    </div>
  )
}
