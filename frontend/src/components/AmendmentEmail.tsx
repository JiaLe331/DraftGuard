import { useMemo, useRef, useState } from 'react'
import {
  CopyIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  SparkleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { ApiError, request, taskPath } from '../mailbox/api'
import type { AmendmentDraft, SampleDetail } from '../mailbox/types'
import { Dialog } from './Primitives'

type EditableDraft = Pick<AmendmentDraft, 'recipient' | 'subject' | 'opening' | 'closing'>

function editable(draft: AmendmentDraft): EditableDraft {
  return {
    recipient: draft.recipient,
    subject: draft.subject,
    opening: draft.opening,
    closing: draft.closing,
  }
}

function amendmentText(draft: AmendmentDraft, form: EditableDraft) {
  const issues = draft.issue_items
    .map((item, index) => {
      const values = [
        item.si_value === null ? null : `SI: ${item.si_value}`,
        item.bl_value === null ? null : `Draft BL: ${item.bl_value}`,
      ].filter(Boolean)
      return [
        `${index + 1}. ${item.field_label}`,
        `   ${item.summary}`,
        ...values.map((value) => `   ${value}`),
        `   Requested action: ${item.requested_action}`,
      ].join('\n')
    })
    .join('\n\n')
  return [
    `To: ${form.recipient}`,
    `Subject: ${form.subject}`,
    '',
    form.opening,
    '',
    'Items requiring action:',
    '',
    issues,
    '',
    form.closing,
  ].join('\n')
}

export function AmendmentEmail({
  task,
  historical,
  disabled,
  onSaved,
}: {
  task: SampleDetail
  historical: boolean
  disabled: boolean
  onSaved: (task: SampleDetail) => void
}) {
  const run = task.current_run
  const result = run?.reviewed_result ?? run?.result
  const actionable = Boolean(
    result &&
    (result.known_defect_fields.length ||
      result.review_requirements.length ||
      result.fields.some((field) => field.finding === 'NEEDS_REVIEW')),
  )
  const available = Boolean(
    task.record_kind === 'task' &&
    !historical &&
    run?.status === 'SUCCEEDED' &&
    !run.completion &&
    actionable,
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const previewRef = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(task.amendment_draft ?? null)
  const [form, setForm] = useState<EditableDraft | null>(
    task.amendment_draft ? editable(task.amendment_draft) : null,
  )
  const [busy, setBusy] = useState<'gemini' | 'standard' | 'save' | 'copy' | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  const dirty = Boolean(
    draft &&
    form &&
    (Object.keys(form) as Array<keyof EditableDraft>).some((key) => form[key] !== draft[key]),
  )
  const preview = useMemo(() => (draft && form ? amendmentText(draft, form) : ''), [draft, form])

  if (!available) return null

  function close() {
    if (busy) return
    if (dirty && !window.confirm('Discard unsaved wording changes?')) return
    setOpen(false)
    setError(null)
    setAnnouncement('')
    setConfirmRegenerate(false)
    setDraft(task.amendment_draft ?? null)
    setForm(task.amendment_draft ? editable(task.amendment_draft) : null)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  async function generate(method: 'gemini' | 'standard') {
    if (!run || busy) return
    setBusy(method)
    setError(null)
    setAnnouncement('')
    try {
      const next = await request<SampleDetail>(`${taskPath(task.id)}/amendment-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_revision: task.revision,
          run_id: run.id,
          method,
        }),
      })
      const saved = next.amendment_draft!
      setDraft(saved)
      setForm(editable(saved))
      setConfirmRegenerate(false)
      setAnnouncement(
        method === 'gemini' ? 'AI-polished draft saved locally.' : 'Standard draft saved locally.',
      )
      onSaved(next)
    } catch (failure) {
      setError(failure as ApiError)
    } finally {
      setBusy(null)
    }
  }

  function normalizedForm() {
    if (!form) return null
    const trimmed = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()]),
    ) as EditableDraft
    if (
      Object.values(trimmed).some((value) => !value) ||
      /[\r\n]/.test(trimmed.recipient) ||
      /[\r\n]/.test(trimmed.subject)
    ) {
      setError(new ApiError('Enter a recipient, one-line subject, opening, and closing.'))
      return null
    }
    return trimmed
  }

  async function persist(trimmed: EditableDraft) {
    if (!run || !draft) return null
    const next = await request<SampleDetail>(
      `${taskPath(task.id)}/amendment-draft/${encodeURIComponent(draft.id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_revision: task.revision,
          run_id: run.id,
          ...trimmed,
        }),
      },
    )
    return next
  }

  async function save(): Promise<AmendmentDraft | null> {
    if (!run || !draft || !form || busy) return null
    const trimmed = normalizedForm()
    if (!trimmed) return null
    setBusy('save')
    setError(null)
    try {
      const next = await persist(trimmed)
      if (!next) return null
      const saved = next.amendment_draft!
      setDraft(saved)
      setForm(editable(saved))
      setAnnouncement('Wording changes saved locally.')
      onSaved(next)
      return saved
    } catch (failure) {
      setError(failure as ApiError)
      return null
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    if (!draft || !form || busy) return
    const trimmed = normalizedForm()
    if (!trimmed) return
    let copyDraft = draft
    let copyForm = trimmed
    setBusy('copy')
    setError(null)
    try {
      if (dirty) {
        const next = await persist(trimmed)
        if (!next) return
        copyDraft = next.amendment_draft!
        copyForm = editable(copyDraft)
        setDraft(copyDraft)
        setForm(copyForm)
        onSaved(next)
      }
      if (!window.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await window.navigator.clipboard.writeText(amendmentText(copyDraft, copyForm))
      setAnnouncement('Email copied to clipboard.')
      setError(null)
    } catch (failure) {
      if (failure instanceof ApiError) {
        setError(failure)
      } else {
        setError(
          new ApiError('Clipboard access was unavailable. Select and copy the full email below.'),
        )
        requestAnimationFrame(() => {
          previewRef.current?.focus()
          previewRef.current?.select()
        })
      }
    } finally {
      setBusy(null)
    }
  }

  function update(key: keyof EditableDraft, value: string) {
    setForm((current) => (current ? { ...current, [key]: value } : current))
    setAnnouncement('Unsaved wording changes.')
  }

  return (
    <section className="amendment-panel" aria-labelledby="amendment-heading">
      <div className="amendment-panel-icon">
        <EnvelopeSimpleIcon size={24} aria-hidden="true" />
      </div>
      <div>
        <div className="eyebrow">NEXT ACTION · AMENDMENT EMAIL</div>
        <h3 id="amendment-heading">Prepare a source-backed revision request</h3>
        <p>
          Gemini can polish the wording. DraftGuard locks the current findings and never sends the
          email.
        </p>
        <button
          ref={triggerRef}
          className="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <FileTextIcon size={17} aria-hidden="true" />
          {draft ? 'Open amendment draft' : 'Draft amendment email'}
        </button>
      </div>
      {open && (
        <Dialog title="Draft amendment email" onClose={close} wide>
          <div className="amendment-dialog">
            {!draft || !form ? (
              <div className="amendment-empty">
                <SparkleIcon size={28} aria-hidden="true" />
                <p>
                  Gemini will write only the subject, opening, and closing. The evidence-backed
                  issue list stays under DraftGuard’s control.
                </p>
                {error && <AmendmentError error={error} />}
                <div className="editor-actions">
                  <button className="button" disabled={Boolean(busy)} onClick={close}>
                    Cancel
                  </button>
                  {error && (
                    <button
                      className="button"
                      disabled={Boolean(busy)}
                      onClick={() => void generate('standard')}
                    >
                      Generate standard draft
                    </button>
                  )}
                  <button
                    className="button primary"
                    disabled={Boolean(busy)}
                    onClick={() => void generate('gemini')}
                  >
                    <SparkleIcon
                      size={17}
                      className={busy === 'gemini' ? 'analysis-spinner' : undefined}
                    />
                    {busy === 'gemini'
                      ? 'Generating…'
                      : error?.retryable === false
                        ? 'Try Gemini again'
                        : error
                          ? 'Retry Gemini'
                          : 'Generate with Gemini'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="amendment-meta">
                  <span className={`draft-method ${draft.generation_method}`}>
                    {draft.generation_method === 'gemini' ? (
                      <SparkleIcon size={15} aria-hidden="true" />
                    ) : (
                      <FileTextIcon size={15} aria-hidden="true" />
                    )}
                    {draft.generation_method === 'gemini' ? 'AI-polished' : 'Standard template'}
                  </span>
                  <span>
                    Revision {draft.revision} · Run {draft.run_id}
                  </span>
                </div>
                <div className="amendment-fields">
                  <label className="form-field">
                    Recipient
                    <input
                      value={form.recipient}
                      maxLength={320}
                      disabled={Boolean(busy)}
                      onChange={(event) => update('recipient', event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Subject
                    <input
                      value={form.subject}
                      maxLength={500}
                      disabled={Boolean(busy)}
                      onChange={(event) => update('subject', event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Opening
                    <textarea
                      rows={4}
                      value={form.opening}
                      maxLength={2000}
                      disabled={Boolean(busy)}
                      onChange={(event) => update('opening', event.target.value)}
                    />
                  </label>
                  <section className="locked-issues" aria-labelledby="locked-issues-heading">
                    <div>
                      <div className="eyebrow">LOCKED FROM CURRENT EVIDENCE</div>
                      <h3 id="locked-issues-heading">
                        Items requiring action · {draft.issue_items.length}
                      </h3>
                    </div>
                    <p className="locked-help">
                      These facts cannot be edited here. Correct the extraction or replace a source
                      in the workspace if they are wrong.
                    </p>
                    <ol>
                      {draft.issue_items.map((item) => (
                        <li key={item.id}>
                          <strong>{item.field_label}</strong>
                          <p>{item.summary}</p>
                          {(item.si_value !== null || item.bl_value !== null) && (
                            <dl>
                              {item.si_value !== null && (
                                <div>
                                  <dt>SI</dt>
                                  <dd>{item.si_value}</dd>
                                </div>
                              )}
                              {item.bl_value !== null && (
                                <div>
                                  <dt>Draft BL</dt>
                                  <dd>{item.bl_value}</dd>
                                </div>
                              )}
                            </dl>
                          )}
                          <p>
                            <strong>Requested action:</strong> {item.requested_action}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <label className="form-field">
                    Closing
                    <textarea
                      rows={3}
                      value={form.closing}
                      maxLength={2000}
                      disabled={Boolean(busy)}
                      onChange={(event) => update('closing', event.target.value)}
                    />
                  </label>
                  <label className="form-field full-email-preview">
                    Full email preview
                    <textarea ref={previewRef} rows={12} readOnly value={preview} />
                  </label>
                </div>
                {error && <AmendmentError error={error} />}
                <p className="review-announcement" aria-live="polite">
                  {announcement}
                </p>
                {confirmRegenerate && (
                  <div className="notice warning amendment-confirm" role="alert">
                    <WarningCircleIcon size={18} aria-hidden="true" />
                    <div>
                      <strong>Replace the current wording?</strong>
                      <p>The locked issue list will stay unchanged.</p>
                    </div>
                    <button
                      className="button"
                      disabled={Boolean(busy)}
                      onClick={() => setConfirmRegenerate(false)}
                    >
                      Keep current draft
                    </button>
                    <button
                      className="button"
                      disabled={Boolean(busy)}
                      onClick={() => void generate('gemini')}
                    >
                      Confirm regenerate
                    </button>
                  </div>
                )}
                <div className="amendment-actions">
                  <button
                    className="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      draft.user_edited || dirty
                        ? setConfirmRegenerate(true)
                        : void generate('gemini')
                    }
                  >
                    <SparkleIcon size={17} aria-hidden="true" />
                    {error?.code?.startsWith('AI_') ? 'Retry Gemini' : 'Regenerate with Gemini'}
                  </button>
                  {error && (
                    <button
                      className="button"
                      disabled={Boolean(busy)}
                      onClick={() => void generate('standard')}
                    >
                      Generate standard draft
                    </button>
                  )}
                  {dirty && (
                    <button className="button" disabled={Boolean(busy)} onClick={() => void save()}>
                      {busy === 'save' ? 'Saving…' : 'Save draft'}
                    </button>
                  )}
                  <button
                    className="button primary"
                    disabled={Boolean(busy)}
                    onClick={() => void copy()}
                  >
                    <CopyIcon size={17} aria-hidden="true" />
                    {busy === 'copy' ? 'Copying…' : 'Copy email'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </section>
  )
}

function AmendmentError({ error }: { error: ApiError }) {
  return (
    <div className="notice danger amendment-error" role="alert">
      <WarningCircleIcon size={18} aria-hidden="true" />
      <div>
        <strong>{error.code ? `${error.code} · ` : ''}Draft unavailable</strong>
        <p>
          {error.message}{' '}
          {error.retryable === false
            ? 'Gemini cannot be retried until its configuration changes.'
            : 'You can retry Gemini or explicitly use the standard template.'}
        </p>
      </div>
    </div>
  )
}
