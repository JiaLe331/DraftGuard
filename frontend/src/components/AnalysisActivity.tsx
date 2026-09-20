import { useEffect, useState } from 'react'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import type { Result } from '../mailbox/types'

export function AnalysisActivity({
  savedResult,
  hasAttachments,
}: {
  savedResult: Result | null
  hasAttachments: boolean
}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setInterval> | undefined
    const syncMotion = () => {
      clearInterval(timer)
      if (!media.matches) {
        timer = setInterval(() => setStep((value) => Math.min(value + 1, 3)), 1000)
      }
    }
    syncMotion()
    media.addEventListener('change', syncMotion)
    return () => {
      clearInterval(timer)
      media.removeEventListener('change', syncMotion)
    }
  }, [])

  // The endpoint returns a complete run, not stage telemetry. After saving,
  // narrate only work evidenced by that result during the presentation interval.
  const captions = ['Email context read']
  if (savedResult) {
    captions.push(
      savedResult.classification.category
        ? 'Email intent classified'
        : 'Classification needs review',
    )
    if (savedResult.documents.length) {
      captions.push(
        savedResult.documents.every((document) => document.state === 'PARSED')
          ? 'Document text parsed'
          : 'Document checks recorded',
      )
    }
    if (savedResult.coverage.checked > 0) captions.push('Fields compared · Evidence linked')
    else if (savedResult.review_requirements.length) captions.push('Review requirements identified')
    else captions.push('Classification ready to review')
  }
  const caption = savedResult
    ? captions[Math.min(step, captions.length - 1)]
    : step === 0
      ? 'Reading email context…'
      : hasAttachments
        ? 'Analyzing email and attachments…'
        : 'Classifying email…'

  return (
    <div className="analysis-activity" role="status" aria-live="polite" aria-atomic="true">
      <ArrowClockwiseIcon className="analysis-spinner" size={24} aria-hidden="true" />
      <strong className="analysis-caption" key={caption}>
        {caption}
      </strong>
      <small>{savedResult ? 'Preparing your results…' : 'Analysis in progress'}</small>
    </div>
  )
}
