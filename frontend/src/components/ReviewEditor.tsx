import { useState, type FormEvent } from 'react'
import { FloppyDiskIcon, XIcon } from '@phosphor-icons/react'
import {
  applyReview,
  fieldLabels,
  effectiveValue,
  type FieldResult,
  type ReviewAction,
  type Role,
  type Task,
} from '../demo/model'
import { useDemo } from '../demo/context'

export function ReviewEditor({
  task,
  field,
  role,
  action,
  onClose,
  onDirty,
  onSaved,
}: {
  task: Task
  field: FieldResult
  role: Role
  action: ReviewAction
  onClose: () => void
  onDirty: (dirty: boolean) => void
  onSaved: () => void
}) {
  const { update } = useDemo()
  const [value, setValue] = useState(effectiveValue(task, field, role, task.currentRevision).value)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const label =
    action === 'confirm'
      ? 'Confirm candidate'
      : action === 'supply'
        ? 'Supply information'
        : 'Correct extraction'
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!value.trim() || !reason.trim()) {
      setError('A value and source explanation are required.')
      return
    }
    if (action === 'confirm' && !confirmed) {
      setError('Check the candidate against the sample source first.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const next = applyReview(task, {
        revision: task.currentRevision,
        field: field.key,
        role,
        action,
        value,
        reason,
      })
      update(next)
      onDirty(false)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="review-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <span className="eyebrow">
            {role === 'si' ? 'SHIPPING INSTRUCTION' : 'DRAFT BILL OF LADING'}
          </span>
          <h3>{label}</h3>
        </div>
        <button type="button" className="icon-button" aria-label="Cancel edit" onClick={onClose}>
          <XIcon size={19} />
        </button>
      </div>
      <p className="small-text">
        {fieldLabels[field.key]} · Machine value: <strong>{field[role].raw || 'Missing'}</strong>
      </p>
      {action === 'supply' && (
        <p className="notice warning">
          Supplied information stays unresolved until its source can be verified or a replacement
          document is provided. This prototype does not verify external sources.
        </p>
      )}
      <label className="form-field">
        {action === 'confirm' ? 'Candidate value' : 'Reviewed value'}
        <input
          autoFocus
          value={value}
          readOnly={action === 'confirm'}
          onChange={(e) => {
            setValue(e.target.value)
            onDirty(true)
          }}
          onBlur={() => {
            if (!value.trim()) setError('Enter a value before saving.')
          }}
        />
      </label>
      <label className="form-field">
        {action === 'supply' ? 'Source and context' : 'Source reference and reason'}
        <textarea
          rows={3}
          value={reason}
          placeholder={
            action === 'supply'
              ? 'Where did this information come from?'
              : 'Describe what you checked in the source.'
          }
          onChange={(e) => {
            setReason(e.target.value)
            onDirty(true)
          }}
        />
      </label>
      {action === 'confirm' && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked)
              onDirty(true)
            }}
          />
          I checked this value against the sample source.
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" disabled={saving}>
          <FloppyDiskIcon size={17} />
          {saving ? 'Saving…' : 'Save & recheck'}
        </button>
      </div>
      <small>Creates a local working copy. Original machine values are preserved.</small>
    </form>
  )
}
