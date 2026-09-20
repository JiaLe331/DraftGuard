import { CheckCircleIcon, ClockIcon, FileTextIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { runLabel, type RunSummary } from './api'

export function ExtractionStatus({
  state,
  label,
}: {
  state: 'ready' | 'review' | 'complete' | 'processing'
  label: string
}) {
  const Icon =
    state === 'complete'
      ? CheckCircleIcon
      : state === 'review'
        ? WarningCircleIcon
        : state === 'processing'
          ? ClockIcon
          : FileTextIcon
  const tone = state === 'complete' ? 'success' : state === 'review' ? 'warning' : 'blue'
  return (
    <span className={`badge extraction-status ${tone}`}>
      <Icon size={16} weight="regular" aria-hidden="true" />
      {label}
    </span>
  )
}

export function RunStatus({ run }: { run: RunSummary }) {
  const state =
    run.processing_status === 'RUNNING'
      ? 'processing'
      : run.processing_status !== 'SUCCEEDED' || run.needs_review
        ? 'review'
        : 'complete'
  return <ExtractionStatus state={state} label={runLabel(run)} />
}
