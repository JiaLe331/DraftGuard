# DraftGuard Design System

## Design thesis

DraftGuard should feel like a calm expert reviewer: precise, transparent, and decisive without looking alarmist. The visual language is **editorial assurance**—warm paper surfaces, oversized type, fine rules, one vivid signal color, and dark product demonstrations. It may borrow the confidence of a magazine or shipping manifest, but never the visual noise of a security dashboard.

Core idea: **Every draft. Checked against the source.**

## Principles

1. **Evidence before decoration.** Product visuals should demonstrate source, comparison, uncertainty, or review state.
2. **Signal, do not alarm.** The brand accent directs attention; semantic warning and success treatments always include words and icons.
3. **One dramatic moment at a time.** Oversized type, ribbons, dark panels, and glow are used as section-level punctuation, not simultaneously in every component.
4. **Human judgment remains visible.** Copy and interactions distinguish machine output from reviewer confirmation.
5. **Quiet structure.** Thin rules, generous whitespace, and a consistent grid organize the page before cards or shadows are introduced.

## Color tokens

| Token | Value | Use |
|---|---:|---|
| `--dg-paper` | `#F0F0ED` | Primary marketing background |
| `--dg-paper-raised` | `#FAFAF7` | Cards and document surfaces |
| `--dg-ink` | `#0C0C0B` | Primary text and dark panels |
| `--dg-muted` | `#5F605C` | Body copy on paper |
| `--dg-faint` | `#8B8C87` | Large-label metadata only |
| `--dg-line` | `#D2D3CE` | Rules and borders |
| `--dg-signal` | `#3153E8` | Brand expression and large accents |
| `--dg-signal-ink` | `#18308F` | Small cobalt text on light surfaces |
| `--dg-signal-soft` | `#DEE5FF` | Selection and subtle brand surfaces |
| `--dg-success` | `#177A58` | Verified states only |

Do not use the brand accent as the only error signal. Small accent text must use the darker signal token for accessible contrast.

### Selected accent direction

**Evidence Cobalt** is the selected accent. It preserves the warm paper and ink foundation while giving DraftGuard a precise, technical signal that does not compete with discrepancy red, review amber, or verified green.

White on the cobalt signal measures 5.94:1. The darker cobalt text measures 9.90:1 against the warm paper.

### Application color roles

- **Primary actions:** ink-black with white text. This keeps the product calm and leaves cobalt for brand expression and selection.
- **Brand and selection:** signal cobalt, or its pale tint, for active navigation, selected records, focus, and editorial emphasis.
- **Verified:** assurance green only, paired with a check icon and explicit verified/match language.
- **Needs review:** amber only, paired with a warning icon and review language.
- **Discrepancy or failure:** oxblood red only, paired with an icon and corrective next step.
- **Information and neutral states:** warm gray rather than generic SaaS blue.

The workspace uses the same paper, ink, rules, typography, and rounded feature language as the landing page, but at a denser operational scale. The dark sidebar is the application counterpart to the landing page’s dark product stage and Guardrail footer.

## Typography

- **Display and UI:** Manrope, with Arial/system sans-serif fallback.
- **Metadata and technical labels:** DM Mono, with Consolas/monospace fallback.
- Display headings use weight 500–600, tight tracking, and balanced natural wrapping.
- Body copy uses 16–17px with 1.6–1.7 line height and a 65–75 character maximum measure.
- Technical labels are 9–12px, uppercase only when they remain legible and supplementary.

## Spacing and shape

- Base rhythm: 4px; preferred steps: 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Marketing container: `min(1480px, 100% - 64px)`, reduced to `100% - 32px` below 820px.
- Small radius: 12px; feature radius: 22px; section radius: 38px.
- Use shadows only for floating product demonstrations and the footer glow. Normal content structure uses borders and spacing.

## Signature patterns

### Guardrail footer

A large rounded black closing panel with navigation, one factual proof point, a warm signal glow, and a monumental partially cropped `DraftGuard` wordmark. It is the brand signature—not a reusable card style.

### Product stage

A dark section used to demonstrate the live comparison. It must contain real product concepts and explicit interaction controls; it is not a decorative mockup.

### Signal ribbons

Crossing signal-color and black strips list the seven comparison fields and the source-backed review flow. They are decorative, hidden from assistive technology, move as seamless news tickers, pause for reduced motion, and must never obstruct usable content.

### Editorial rows

Workflow and principle content is presented as ruled rows instead of generic card grids. Cards are reserved for bounded interactive objects.

### Application shell

- Warm paper canvas and raised off-white working surfaces.
- Ink-black sidebar with a cobalt active destination.
- Exact `DraftGuard.` wordmark shared with the landing page.
- Pill-shaped search, tabs, and primary controls; 12–18px radii for operational panels.
- Technical table headings and eyebrows use DM Mono; content and controls use Manrope.
- Dense evidence and comparison views retain ruled rows rather than becoming decorative marketing cards.

## Interaction and motion

- All primary controls have a minimum 44px target.
- Hover may enhance an interaction but cannot be the only way to reveal content.
- Use 160–180ms transitions for color, border, and small transforms.
- Motion communicates hierarchy or state; avoid continuous decorative animation.
- Respect `prefers-reduced-motion` and remove transforms/transitions that are not required for understanding.
- Focus indicators use a 3px brand-signal outline with visible offset.

## Voice

- Calm, direct, and specific.
- Prefer `source-backed`, `review`, `uncertain`, `confirmed`, and `traceable`.
- Avoid `perfect`, `guaranteed`, `fully automated`, or claims of legal/cargo-release approval.
- Use real bounded product facts: seven fields, source evidence, review ledger, original documents, and explicit completion acknowledgment.

## Accessibility requirements

- Normal text meets WCAG AA 4.5:1; large text and non-text UI meet 3:1.
- Status never depends on color alone; pair semantic color with an icon and explicit text.
- Interactive examples use native buttons with `aria-pressed` and a polite atomic status update.
- Decorative graphics and ribbons are hidden from the accessibility tree.
- Heading hierarchy remains sequential; each major section has an accessible name.
- Layout remains operable at 375px, 200% zoom, and with reduced motion.

## Page hierarchy

1. Editorial promise hero
2. Interactive dark product stage
3. Seven-field signal ribbons
4. Product manifesto
5. Four-step workflow
6. Source-evidence demonstration
7. Bounded-design principles
8. Guardrail footer

Page-specific rules may be added under `pages/`; they override this document only when explicitly stated.
