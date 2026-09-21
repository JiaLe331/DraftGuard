import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import {
  ArrowRightIcon,
  CheckCircleIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  SparkleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import './landing.css'

type ScanMode = 'mismatch' | 'verified'
type LandingSection = 'top' | 'workflow' | 'evidence' | 'principles'
type RevealSection = 'product' | 'manifesto' | 'workflow' | 'evidence' | 'principles'

const revealSectionNames: RevealSection[] = [
  'product',
  'manifesto',
  'workflow',
  'evidence',
  'principles',
]

const comparisons = {
  mismatch: {
    eyebrow: 'Review required',
    label: 'Mismatch detected',
    field: 'Consignee',
    si: 'Northstar Trading Co.',
    bl: 'Northstar Shipping Ltd.',
    siSource: 'SI · Page 1 · Consignee block',
    blSource: 'Draft B/L · Page 1 · Consignee block',
    tone: 'warning',
    icon: WarningCircleIcon,
  },
  verified: {
    eyebrow: 'Sources aligned',
    label: 'Field verified',
    field: 'Gross weight',
    si: '23,702 KG',
    bl: '23,702 KGS',
    siSource: 'SI · Page 1 · Cargo details',
    blSource: 'Draft B/L · Page 1 · Cargo details',
    tone: 'success',
    icon: CheckCircleIcon,
  },
} as const

const comparisonFields = [
  'Shipper',
  'Consignee',
  'Notify party',
  'Port of loading',
  'Port of discharge',
  'Container count',
  'Gross weight',
]

const reviewFlow = [
  'Attach source files',
  'Extract seven fields',
  'Compare SI with draft B/L',
  'Review original evidence',
  'Record the decision',
  'Keep an audit trail',
]

export function Landing() {
  const [scanMode, setScanMode] = useState<ScanMode>('mismatch')
  const [activeSection, setActiveSection] = useState<LandingSection>('top')
  const [arrivalSection, setArrivalSection] = useState<LandingSection | null>(null)
  const [revealedSections, setRevealedSections] = useState<ReadonlySet<RevealSection>>(() =>
    typeof window === 'undefined' || !('IntersectionObserver' in window)
      ? new Set(revealSectionNames)
      : new Set(),
  )
  const arrivalTimer = useRef<number | null>(null)
  const active = comparisons[scanMode]
  const StatusIcon = active.icon

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal-section]'))
    const trackedSections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-landing-section]'),
    )

    if (!('IntersectionObserver' in window)) {
      return () => {
        if (arrivalTimer.current) window.clearTimeout(arrivalTimer.current)
      }
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const section = (entry.target as HTMLElement).dataset.revealSection as RevealSection
            setRevealedSections((current) => {
              if (current.has(section)) return current
              return new Set(current).add(section)
            })
            revealObserver.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    )

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]

        if (visible) {
          setActiveSection(visible.target.getAttribute('data-landing-section') as LandingSection)
        }
      },
      { rootMargin: '-22% 0px -56% 0px', threshold: [0.08, 0.3, 0.6] },
    )

    sections.forEach((section) => revealObserver.observe(section))
    trackedSections.forEach((section) => sectionObserver.observe(section))

    return () => {
      revealObserver.disconnect()
      sectionObserver.disconnect()
      if (arrivalTimer.current) window.clearTimeout(arrivalTimer.current)
    }
  }, [])

  useEffect(() => {
    let timer: number | null = null

    const alignHashTarget = () => {
      const section = window.location.hash.slice(1) as LandingSection
      if (!['workflow', 'evidence', 'principles'].includes(section)) return

      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'auto', block: 'start' })
        setActiveSection(section)
      }, 80)
    }

    alignHashTarget()
    window.addEventListener('hashchange', alignHashTarget)

    return () => {
      window.removeEventListener('hashchange', alignHashTarget)
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const navigateToSection = (event: MouseEvent<HTMLAnchorElement>, section: LandingSection) => {
    event.preventDefault()
    const target = document.getElementById(section)
    if (!target) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.history.pushState(null, '', section === 'top' ? '#top' : `#${section}`)
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    setActiveSection(section)
    setArrivalSection(section)

    if (arrivalTimer.current) window.clearTimeout(arrivalTimer.current)
    arrivalTimer.current = window.setTimeout(() => setArrivalSection(null), 1400)
  }

  return (
    <div className="dg-landing" id="top">
      <a className="dg-skip" href="#landing-main">
        Skip to content
      </a>

      <header className="dg-nav">
        <Link className="dg-wordmark" to="/" aria-label="DraftGuard home">
          DraftGuard<span>.</span>
        </Link>

        <nav aria-label="Landing page navigation">
          <a
            href="#workflow"
            className={activeSection === 'workflow' ? 'active' : ''}
            aria-current={activeSection === 'workflow' ? 'location' : undefined}
            onClick={(event) => navigateToSection(event, 'workflow')}
          >
            Workflow
          </a>
          <a
            href="#evidence"
            className={activeSection === 'evidence' ? 'active' : ''}
            aria-current={activeSection === 'evidence' ? 'location' : undefined}
            onClick={(event) => navigateToSection(event, 'evidence')}
          >
            Evidence
          </a>
          <a
            href="#principles"
            className={activeSection === 'principles' ? 'active' : ''}
            aria-current={activeSection === 'principles' ? 'location' : undefined}
            onClick={(event) => navigateToSection(event, 'principles')}
          >
            Why DraftGuard
          </a>
        </nav>

        <Link className="dg-nav-cta" to="/overview">
          Open workspace <ArrowRightIcon aria-hidden="true" size={16} weight="bold" />
        </Link>
      </header>

      <main id="landing-main">
        <section className="dg-hero" aria-labelledby="landing-title">
          <div className="dg-hero-meta">
            <span className="dg-kicker">( Document intelligence )</span>
            <span>Built for shipping teams</span>
          </div>

          <h1 id="landing-title">
            <span>Every draft.</span>
            <span className="dg-accent-line">Checked against</span>
            <span>the source.</span>
          </h1>

          <div className="dg-hero-bottom">
            <p>
              DraftGuard compares shipping instructions with draft bills of lading, surfaces the
              differences that matter, and keeps every decision connected to its evidence.
            </p>
            <div className="dg-hero-actions">
              <Link className="dg-button dg-button-primary" to="/overview">
                Try the live workspace
                <ArrowRightIcon aria-hidden="true" size={18} weight="bold" />
              </Link>
              <a
                className="dg-button dg-button-secondary"
                href="#workflow"
                onClick={(event) => navigateToSection(event, 'workflow')}
              >
                See the workflow
              </a>
            </div>
          </div>
        </section>

        <section
          className={`dg-product-stage dg-reveal ${revealedSections.has('product') ? 'is-visible' : ''}`}
          data-reveal-section="product"
          aria-labelledby="product-stage-title"
        >
          <div className="dg-stage-glow" aria-hidden="true" />
          <div className="dg-stage-topline">
            <span>
              <i /> LIVE COMPARISON
            </span>
            <span>DG / 07 FIELDS / SOURCE-BACKED</span>
          </div>

          <div className="dg-stage-layout">
            <div className="dg-stage-copy">
              <span className="dg-dark-kicker">( Inside DraftGuard )</span>
              <h2 id="product-stage-title">Find the detail before it becomes a delay.</h2>
              <p>
                The system narrows the review. Your team keeps the judgment, the source, and the
                final say.
              </p>
              <div className="dg-stage-proof">
                <strong>07</strong>
                <span>bounded shipment fields checked on every comparison</span>
              </div>
            </div>

            <div className="dg-comparison-shell">
              <div className="dg-mode-switch" aria-label="Choose comparison example">
                <button
                  className={scanMode === 'mismatch' ? 'active' : ''}
                  onClick={() => setScanMode('mismatch')}
                  aria-pressed={scanMode === 'mismatch'}
                >
                  <span className="dg-switch-dot warning" aria-hidden="true" /> Mismatch
                </button>
                <button
                  className={scanMode === 'verified' ? 'active' : ''}
                  onClick={() => setScanMode('verified')}
                  aria-pressed={scanMode === 'verified'}
                >
                  <span className="dg-switch-dot success" aria-hidden="true" /> Verified
                </button>
              </div>

              <div className="dg-comparison-card">
                <div className="dg-card-heading">
                  <div>
                    <span>CHECK / DG-2048</span>
                    <strong>Document comparison</strong>
                  </div>
                  <span className="dg-evidence-pill">
                    <ShieldCheckIcon aria-hidden="true" size={15} weight="fill" /> Evidence linked
                  </span>
                </div>

                <div className={`dg-result ${active.tone}`} aria-live="polite" aria-atomic="true">
                  <StatusIcon aria-hidden="true" size={22} weight="fill" />
                  <div>
                    <span>{active.eyebrow}</span>
                    <strong>{active.label}</strong>
                  </div>
                  <span>02 / 07</span>
                </div>

                <div className="dg-field-name">
                  <span>FIELD</span>
                  <strong>{active.field}</strong>
                </div>

                <div className="dg-values">
                  <article>
                    <span>SHIPPING INSTRUCTION</span>
                    <strong>{active.si}</strong>
                    <small>{active.siSource}</small>
                  </article>
                  <article>
                    <span>DRAFT BILL OF LADING</span>
                    <strong>{active.bl}</strong>
                    <small>{active.blSource}</small>
                  </article>
                </div>

                <div className="dg-card-footer">
                  <span>
                    <MagnifyingGlassIcon aria-hidden="true" size={15} /> Open original evidence
                  </span>
                  <span>{scanMode === 'mismatch' ? 'Review recommended' : 'Ready to confirm'}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="dg-ribbons" aria-hidden="true">
          <div className="dg-ribbon dg-ribbon-signal">
            <div className="dg-ribbon-track">
              {[0, 1].map((group) => (
                <span className="dg-ribbon-group" key={`signal-group-${group}`}>
                  {[...comparisonFields, ...comparisonFields].map((field, index) => (
                    <span key={`${group}-${field}-${index}`}>{field}</span>
                  ))}
                </span>
              ))}
            </div>
          </div>
          <div className="dg-ribbon dg-ribbon-black">
            <div className="dg-ribbon-track">
              {[0, 1].map((group) => (
                <span className="dg-ribbon-group" key={`black-group-${group}`}>
                  {[...reviewFlow, ...reviewFlow].map((step, index) => (
                    <span key={`${group}-${step}-${index}`}>{step}</span>
                  ))}
                </span>
              ))}
            </div>
          </div>
        </div>

        <section
          className={`dg-manifesto dg-reveal ${revealedSections.has('manifesto') ? 'is-visible' : ''}`}
          data-reveal-section="manifesto"
          aria-labelledby="manifesto-title"
        >
          <span className="dg-kicker">( From inbox to decision )</span>
          <h2 id="manifesto-title">
            DraftGuard turns document noise into a traceable decision without hiding uncertainty.
          </h2>
        </section>

        <section
          className={`dg-workflow dg-reveal ${revealedSections.has('workflow') ? 'is-visible' : ''} ${arrivalSection === 'workflow' ? 'dg-section-arrival' : ''}`}
          data-reveal-section="workflow"
          data-landing-section="workflow"
          aria-labelledby="workflow-title"
        >
          <div className="dg-section-heading" id="workflow">
            <span className="dg-kicker">( Workflow )</span>
            <h2 id="workflow-title">A clear path through every draft.</h2>
            <p>One bounded review flow, from original documents to an evidence-backed handoff.</p>
          </div>

          <ol className="dg-workflow-list">
            <li>
              <span className="dg-step-number">01</span>
              <span className="dg-step-icon">
                <FileTextIcon aria-hidden="true" size={24} />
              </span>
              <div>
                <h3>Bring the sources</h3>
                <p>Start from a mailbox item or upload SI and draft-B/L files.</p>
              </div>
              <span className="dg-step-outcome">Originals preserved</span>
            </li>
            <li>
              <span className="dg-step-number">02</span>
              <span className="dg-step-icon">
                <MagnifyingGlassIcon aria-hidden="true" size={24} />
              </span>
              <div>
                <h3>Compare seven fields</h3>
                <p>Focus attention on values that differ, are missing, or need review.</p>
              </div>
              <span className="dg-step-outcome">Noise reduced</span>
            </li>
            <li>
              <span className="dg-step-number">03</span>
              <span className="dg-step-icon">
                <ShieldCheckIcon aria-hidden="true" size={24} />
              </span>
              <div>
                <h3>Review with evidence</h3>
                <p>Open the source page, confirm the value, and record the decision.</p>
              </div>
              <span className="dg-step-outcome">Human in control</span>
            </li>
            <li>
              <span className="dg-step-number">04</span>
              <span className="dg-step-icon">
                <CheckCircleIcon aria-hidden="true" size={24} />
              </span>
              <div>
                <h3>Acknowledge the check</h3>
                <p>Complete the exact reviewed run with its history intact.</p>
              </div>
              <span className="dg-step-outcome">Handoff ready</span>
            </li>
          </ol>
        </section>

        <section
          className={`dg-evidence dg-reveal ${revealedSections.has('evidence') ? 'is-visible' : ''} ${arrivalSection === 'evidence' ? 'dg-section-arrival' : ''}`}
          data-reveal-section="evidence"
          data-landing-section="evidence"
          aria-labelledby="evidence-title"
        >
          <div className="dg-evidence-visual" aria-label="Example of source-linked review evidence">
            <div className="dg-document-window">
              <div className="dg-document-toolbar">
                <span>email_160_SI.pdf</span>
                <span>PAGE 01 / 01</span>
              </div>
              <div className="dg-document-page">
                <span>SHIPPING INSTRUCTION</span>
                <strong>CARGO PARTICULARS</strong>
                <div className="dg-document-lines" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <mark>
                  <small>GROSS WEIGHT</small>
                  23,702 KG
                </mark>
              </div>
              <span className="dg-source-badge">
                <SparkleIcon aria-hidden="true" size={15} weight="fill" /> Source located
              </span>
            </div>
          </div>

          <div className="dg-evidence-copy" id="evidence">
            <span className="dg-kicker">( Evidence first )</span>
            <h2 id="evidence-title">Automation that shows its work.</h2>
            <p>
              Shipping documents are too important for unexplained answers. Every extracted value
              stays connected to its file, page, and review action.
            </p>
            <ul>
              <li>
                <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
                <span>
                  <strong>Originals stay available.</strong> Review the actual document beside the
                  comparison.
                </span>
              </li>
              <li>
                <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
                <span>
                  <strong>Uncertainty stays visible.</strong> Missing or ambiguous values are never
                  forced into a match.
                </span>
              </li>
              <li>
                <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
                <span>
                  <strong>Decisions stay traceable.</strong> Confirmations and corrections remain in
                  the review ledger.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section
          className={`dg-principles dg-reveal ${revealedSections.has('principles') ? 'is-visible' : ''} ${arrivalSection === 'principles' ? 'dg-section-arrival' : ''}`}
          data-reveal-section="principles"
          data-landing-section="principles"
          aria-labelledby="principles-title"
        >
          <div id="principles">
            <span className="dg-kicker">( Bounded by design )</span>
            <h2 id="principles-title">High-stakes review needs clarity, not a black box.</h2>
          </div>
          <div className="dg-principle-grid">
            <article>
              <strong>01</strong>
              <h3>Rule first</h3>
              <p>Deterministic checks handle readable documents before AI is considered.</p>
            </article>
            <article>
              <strong>02</strong>
              <h3>Human reviewed</h3>
              <p>Machine output never quietly replaces a reviewer’s judgment.</p>
            </article>
            <article>
              <strong>03</strong>
              <h3>Source backed</h3>
              <p>Every final value can be traced to a document and review action.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="dg-footer">
        <div className="dg-footer-top">
          <div>
            <Link className="dg-wordmark dg-wordmark-light" to="/">
              DraftGuard<span>.</span>
            </Link>
            <p>Evidence-backed document review for shipping teams.</p>
          </div>
          <div>
            <span>PRODUCT</span>
            <Link to="/overview">Workspace</Link>
            <a href="#workflow" onClick={(event) => navigateToSection(event, 'workflow')}>
              Workflow
            </a>
            <a href="#evidence" onClick={(event) => navigateToSection(event, 'evidence')}>
              Evidence
            </a>
          </div>
          <div>
            <span>PRINCIPLES</span>
            <a href="#principles" onClick={(event) => navigateToSection(event, 'principles')}>
              Rule first
            </a>
            <a href="#principles" onClick={(event) => navigateToSection(event, 'principles')}>
              Human reviewed
            </a>
            <a href="#principles" onClick={(event) => navigateToSection(event, 'principles')}>
              Source backed
            </a>
          </div>
        </div>

        <div className="dg-footer-meta">
          <span>Hackathon prototype · 2026</span>
          <span>
            Fields checked per task <ArrowRightIcon aria-hidden="true" size={14} />{' '}
            <strong>07</strong>
          </span>
          <a href="#top" onClick={(event) => navigateToSection(event, 'top')}>
            Back to top ↑
          </a>
        </div>

        <div className="dg-footer-word" aria-hidden="true">
          DraftGuard
        </div>
      </footer>
    </div>
  )
}
