import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  SquaresFourIcon,
  TrayIcon,
  MagnifyingGlassIcon,
  ArrowCounterClockwiseIcon,
  ListIcon,
  ArrowUpRightIcon,
  ShieldCheckIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useDemo } from '../demo/context'
import { workflow } from '../demo/model'
import { Dialog } from './Primitives'
const scrollPositions = new Map<string, number>()
export function Shell() {
  const { tasks, warning, reset } = useDemo()
  const [resetOpen, setResetOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')
  const location = useLocation(),
    navigate = useNavigate()
  const [params] = useSearchParams()
  const main = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const routeKey = location.pathname + location.search
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
    const query = searchRef.current?.value.trim() ?? ''
    if (query) next.set('q', query)
    else next.delete('q')
    navigate(`${location.pathname === '/inbox' ? '/inbox' : '/overview'}?${next}`)
  }
  return (
    <div className="app-shell">
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
            <span className="brand-mark">
              <ShieldCheckIcon size={24} weight="bold" />
            </span>
            <span>
              Draft<span className="brand-light">Guard</span>
            </span>
          </Link>
        </div>
        <form className="global-search" role="search" onSubmit={search}>
          <MagnifyingGlassIcon size={21} aria-hidden="true" />
          <input
            key={params.get('q') ?? ''}
            ref={searchRef}
            aria-label="Search emails and tasks"
            placeholder="Search emails, shipments, or senders"
            defaultValue={params.get('q') ?? ''}
          />
          <kbd aria-hidden="true">↵</kbd>
        </form>
        <div className="header-end">
          <span className="sample-label">
            <span />
            Sample data
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
              {tasks.filter((t) => workflow(t) === 'attention').length}
            </span>
          </NavLink>
          <NavLink to="/inbox" onClick={() => setMenuOpen(false)}>
            <TrayIcon size={21} />
            <span>Inbox</span>
            <span className="nav-count muted">{tasks.length}</span>
          </NavLink>
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
          <Link to="/overview?status=attention" onClick={() => setMenuOpen(false)}>
            View your queue <ArrowUpRightIcon size={15} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <p>
            <span className="local-dot" />
            Interactive prototype
          </p>
          <small>
            Team-authored samples.
            <br />
            Changes stay in this browser.
          </small>
          <button
            className="reset-button"
            onClick={() => {
              setResetOpen(true)
              setError('')
            }}
          >
            <ArrowCounterClockwiseIcon size={17} />
            Reset demo
          </button>
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
        {warning && (
          <div className="notice warning" role="alert">
            {warning}
          </div>
        )}
        <Outlet />
      </main>
      {resetOpen && (
        <Dialog title="Reset the demo?" onClose={() => setResetOpen(false)}>
          <p>This removes your saved local reviews and restores the original sample tasks.</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="button" onClick={() => setResetOpen(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                try {
                  reset()
                  setResetOpen(false)
                  navigate('/overview')
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
            >
              Reset demo
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
