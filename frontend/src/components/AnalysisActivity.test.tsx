import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Result } from '../mailbox/types'
import { AnalysisActivity } from './AnalysisActivity'

function result(): Result {
  return {
    classification: { category: 'GENERAL', method: 'rule', status: 'CLASSIFIED', reason: '' },
    documents: [],
    fields: [],
    review_requirements: [],
    known_defect_fields: [],
    coverage: { checked: 0, total: 7 },
    workflow_state: 'NOT_APPLICABLE',
    processing_status: 'SUCCEEDED',
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AnalysisActivity', () => {
  it('reveals one caption at a time using the saved run and cleans up on navigation', () => {
    vi.useFakeTimers()
    const saved = result()
    saved.documents = [{ id: 'si', role: 'si', state: 'PARSED', units: [], error: null }]
    saved.coverage.checked = 7
    const view = render(<AnalysisActivity hasAttachments savedResult={null} />)
    expect(screen.getByText('Reading email context…')).toBeInTheDocument()
    view.rerender(<AnalysisActivity hasAttachments savedResult={saved} />)
    expect(screen.getByText('Email context read')).toBeInTheDocument()
    expect(screen.queryByText(/Analysis saved/)).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Email intent classified')).toBeInTheDocument()
    expect(screen.queryByText('Email context read')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Document text parsed')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Fields compared · Evidence linked')).toBeInTheDocument()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not invent document parsing or comparison for classification-only runs', () => {
    vi.useFakeTimers()
    render(<AnalysisActivity hasAttachments savedResult={result()} />)
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('Classification ready to review')).toBeInTheDocument()
    expect(screen.queryByText('Document text parsed')).not.toBeInTheDocument()
    expect(screen.queryByText('Fields compared · Evidence linked')).not.toBeInTheDocument()
  })

  it('keeps slow requests indeterminate instead of claiming timed steps completed', () => {
    vi.useFakeTimers()
    render(<AnalysisActivity hasAttachments savedResult={null} />)
    act(() => vi.advanceTimersByTime(8000))
    expect(screen.getByText('Analyzing email and attachments…')).toBeInTheDocument()
    expect(screen.queryByText('Preparing your results…')).not.toBeInTheDocument()
  })

  it('does not animate captions with reduced motion', () => {
    vi.useFakeTimers()
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const view = render(<AnalysisActivity hasAttachments={false} savedResult={null} />)
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('Reading email context…')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
    view.unmount()
    media.mockRestore()
  })
})
