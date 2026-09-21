import { useEffect, useRef, type ReactNode } from 'react'
import {
  CheckCircleIcon,
  WarningCircleIcon,
  ClockIcon,
  CircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { statusLabels, type Finding, type Workflow } from '../mailbox/types'

export function StatusBadge({ status }: { status: Workflow | Finding }) {
  const color =
    status === 'MISMATCH' || status === 'DISCREPANCIES_FOUND' || status === 'FAILED'
      ? 'danger'
      : status === 'REVIEW_REQUIRED' || status === 'NEEDS_REVIEW'
        ? 'warning'
        : status === 'MATCH' || status === 'CHECK_COMPLETE'
          ? 'success'
          : status === 'READY'
            ? 'blue'
            : 'neutral'
  const Icon =
    color === 'success'
      ? CheckCircleIcon
      : color === 'warning' || color === 'danger'
        ? WarningCircleIcon
        : status === 'WAITING_DOCUMENT'
          ? ClockIcon
          : CircleIcon
  const label = statusLabels[status]
  return (
    <span className={`badge ${color}`}>
      <Icon size={14} weight="bold" aria-hidden="true" />
      {label}
    </span>
  )
}
export function Avatar({ initials, color = 'blue' }: { initials: string; color?: string }) {
  return (
    <span className={`avatar ${color}`} aria-hidden="true">
      {initials}
    </span>
  )
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <CircleIcon size={30} />
      </div>
      <h2>{title}</h2>
      {children}
    </div>
  )
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <XIcon size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
