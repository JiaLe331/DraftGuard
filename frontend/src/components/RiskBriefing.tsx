import { useState } from 'react'
import { ArrowClockwiseIcon, SparkleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { ApiError, request, taskPath } from '../mailbox/api'
import { fieldLabels, type FieldKey } from '../mailbox/types'

/**
 * Reviewer-requested commentary on discrepancies the deterministic comparison
 * has already confirmed.
 *
 * Advisory only. Nothing here is stored, nothing feeds back into the
 * comparison, the reviewed result or completion. The workspace keys this
 * component by task and revision, so a new revision remounts it and the old
 * briefing is discarded rather than describing values that have changed.
 */

interface Note {
  field: FieldKey
  consequence: string
}

interface Briefing {
  revision: number
  notes: Note[]
  provider_call: { model_version: string | null; configured_model: string; duration_ms: number }
}

export function RiskBriefing({
  taskId,
  revision,
  discrepancies,
}: {
  taskId: string
  revision: number
  discrepancies: FieldKey[]
}) {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!discrepancies.length) return null

  const explain = async () => {
    setBusy(true)
    setError('')
    try {
      setBriefing(
        await request<Briefing>(`${taskPath(taskId)}/risk-briefing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_revision: revision }),
        }),
      )
    } catch (failure) {
      const apiError = failure as ApiError
      setError(apiError.message || 'The briefing could not be generated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="risk-briefing" aria-labelledby="risk-briefing-heading">
      <div className="risk-briefing-head">
        <h3 id="risk-briefing-heading">
          What these {discrepancies.length === 1 ? 'differences' : 'differences'} mean in operations
        </h3>
        <button type="button" className="button compact" onClick={explain} disabled={busy}>
          {busy ? (
            <ArrowClockwiseIcon size={14} className="analysis-spinner" aria-hidden="true" />
          ) : (
            <SparkleIcon size={14} weight="bold" aria-hidden="true" />
          )}
          {busy ? 'Asking Gemini…' : briefing ? 'Ask again' : 'Explain with Gemini'}
        </button>
      </div>
      {error && (
        <p className="risk-briefing-error" role="alert">
          <WarningCircleIcon size={15} weight="bold" aria-hidden="true" />
          {error}
        </p>
      )}
      {briefing && (
        <>
          <dl className="risk-notes">
            {briefing.notes.map((note) => (
              <div key={note.field}>
                <dt>{fieldLabels[note.field]}</dt>
                <dd>{note.consequence}</dd>
              </div>
            ))}
          </dl>
          <p className="small-text risk-briefing-note">
            Advisory commentary from{' '}
            {briefing.provider_call.model_version ?? briefing.provider_call.configured_model},
            generated on request and not saved. The discrepancies themselves were decided by
            deterministic comparison; this text changes nothing about them and is not a legal,
            customs or cargo-release opinion.
          </p>
        </>
      )}
      {!briefing && !error && (
        <p className="small-text risk-briefing-note">
          Deterministic rules found the differences. Ask Gemini to explain what each one typically
          costs downstream if the draft is issued unchanged.
        </p>
      )}
    </section>
  )
}
