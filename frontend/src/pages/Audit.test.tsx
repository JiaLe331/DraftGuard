import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Audit } from './Audit'
import { Shell } from '../components/Shell'
import { MailboxProvider } from '../mailbox/provider'
import { useAuditEvents } from '../extraction/useAuditEvents'
import { usePollingResource } from '../extraction/usePollingResource'
import type { AuditEvent, ExtractionRun, SourceUnit } from '../extraction/api'

const source: SourceUnit = {
  unit_id: 'unit-1',
  document_id: 'doc-1',
  text: 'Total Gross Weight: 25 MT',
  page: 1,
  line: null,
  paragraph: null,
  table: null,
  row: null,
  column: null,
  sheet: null,
  cell: null,
  is_formula: false,
}
const event: AuditEvent = {
  sequence: 1,
  timestamp: '2026-09-20T01:00:00.100Z',
  stage: 'candidates',
  status: 'SUCCEEDED',
  message: 'Source candidates inspected.',
  document_id: 'doc-1',
  details: {
    field: 'gross_weight_kg',
    candidates: [
      {
        label: 'Total Gross Weight',
        raw_value: '25 MT',
        selected: true,
        selection_reason: 'explicit_total_precedence',
        source_unit_ids: ['unit-1'],
      },
    ],
  },
}
const run: ExtractionRun = {
  run_id: 'run-1',
  request_id: 'req-1',
  source_type: 'upload',
  source_label: 'shipment.pdf',
  created_at: '2026-09-20T01:00:00Z',
  finished_at: '2026-09-20T01:00:01Z',
  processing_status: 'SUCCEEDED',
  needs_review: false,
  document_count: 1,
  pipeline_version: 'rules-1',
  audit_version: 2,
  email: null,
  issues: [],
  documents: [
    {
      document_id: 'doc-1',
      filename: 'shipment.pdf',
      content_sha256: 'sha256',
      byte_count: 100,
      has_original: true,
      processing_status: 'SUCCEEDED',
      source_units: [source],
      result: null,
      events: [event],
      error: null,
    },
  ],
}
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const health = { capabilities: { development_extraction: true, upload_limit_bytes: 3145728 } }
const page = (items = [event], status = 'SUCCEEDED', hasMore = false) => ({
  items,
  processing_status: status,
  has_more: hasMore,
  next_after_sequence: items.at(-1)?.sequence ?? 0,
  trace_mode: 'live',
})

function setup(path = '/audit', override?: (path: string) => Response | undefined, shell = false) {
  const fetchMock = vi.fn(async (path: string) => {
    const changed = override?.(path)
    if (changed) return changed
    if (path === '/api/health') return response(health)
    if (path === '/api/v1/samples?limit=1')
      return response({
        items: [],
        total: 0,
        page: 1,
        limit: 1,
        summary: { total: 0, attachments: 0, states: {} },
      })
    if (path.includes('/events?')) return response(page())
    if (path.startsWith('/api/v1/dev/runs?'))
      return response({ items: [{ ...run, trace_mode: 'legacy' }], total: 1 })
    if (path === '/api/v1/dev/runs/run-1') return response(run)
    return response({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const routes = [
    { path: '/audit', element: <Audit /> },
    { path: '/audit/runs/:runId', element: <Audit /> },
  ]
  const router = createMemoryRouter(
    shell
      ? [
          {
            element: (
              <MailboxProvider>
                <Shell />
              </MailboxProvider>
            ),
            children: routes,
          },
        ]
      : routes,
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return { router, fetchMock }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('audit trail', () => {
  it('has its own sidebar destination and never shows the sample reset on audit screens', async () => {
    setup('/audit', undefined, true)
    expect(await screen.findByRole('link', { name: 'Audit Trail' })).toHaveAttribute(
      'href',
      '/audit',
    )
    expect(screen.queryByRole('button', { name: 'Reset demo' })).not.toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Audit runs' })).toBeInTheDocument()
  })

  it('searches and filters saved runs and restores the list context after opening a run', async () => {
    const { router, fetchMock } = setup()
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Search audit history' }),
      'email_055',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.selectOptions(screen.getByLabelText('Review requirement'), 'true')
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([path]) => path.includes('q=email_055') && path.includes('needs_review=true'),
        ),
      ).toBe(true),
    )
    expect(await screen.findByText('Legacy trace')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: /shipment.pdf/ }))
    await userEvent.click(await screen.findByRole('link', { name: 'Back to audit history' }))
    expect(router.state.location.search).toContain('q=email_055')
    expect(router.state.location.search).toContain('needs_review=true')
    expect(fetchMock.mock.calls.every(([path]) => !path.includes('/extract'))).toBe(true)
  })

  it('shows recorded decisions and opens exact source evidence using a shareable URL', async () => {
    const { router } = setup('/audit/runs/run-1?event=1')
    expect(
      await screen.findByText(
        'An explicit total takes precedence over individual-container weights.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Page 1' }))
    expect(screen.getByTestId('audit-source-evidence')).toHaveTextContent(source.text)
    expect(router.state.location.search).toContain('unit=unit-1')
    expect(router.state.location.search).toContain('document=doc-1')
    expect(screen.getByRole('link', { name: 'View extraction results' })).toHaveAttribute(
      'href',
      '/extraction/runs/run-1',
    )
    expect(screen.getByRole('link', { name: 'Download audit JSON' })).toHaveAttribute(
      'href',
      '/api/v1/dev/runs/run-1?download=true',
    )
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'FAILED')
    expect(screen.getByText('No recorded events match these filters.')).toBeInTheDocument()
  })

  it('does not request saved runs or events when the feature is disabled', async () => {
    const { fetchMock } = setup('/audit/runs/run-1', (path) =>
      path === '/api/health'
        ? response({ capabilities: { development_extraction: false } })
        : undefined,
    )
    expect(await screen.findByText(/Local extraction is disabled/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([path]) => path === '/api/health')).toBe(true)
  })
})

describe('live polling', () => {
  it('drains event pages before stopping at completion and never duplicates records', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(page([event], 'RUNNING')))
      .mockResolvedValueOnce(response(page([{ ...event, sequence: 2 }], 'SUCCEEDED', true)))
      .mockResolvedValueOnce(response(page([{ ...event, sequence: 3 }], 'SUCCEEDED')))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuditEvents('run-1'))
    await act(async () => {})
    expect(result.current.items).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.items.map((item) => item.sequence)).toEqual([1, 2, 3])
    expect(fetchMock.mock.calls[2][0]).toContain('after_sequence=2')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retains saved events through a connection failure and retries from the same cursor', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(page([event], 'RUNNING')))
      .mockRejectedValueOnce(new Error('Backend unavailable'))
      .mockResolvedValueOnce(response(page([{ ...event, sequence: 2 }], 'SUCCEEDED')))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuditEvents('run-1'))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.items).toEqual([event])
    expect(result.current.error).toBe('Backend unavailable')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.items).toHaveLength(2)
    expect(fetchMock.mock.calls[1][0]).toEqual(fetchMock.mock.calls[2][0])
    expect(result.current.error).toBeUndefined()
  })

  it('pauses while hidden and does not overlap an in-flight run request', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    let resolve!: (response: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePollingResource<ExtractionRun>('/run', 1000, true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    visibility.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    fireEvent(document, new Event('visibilitychange'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve(response(run))
    })
    expect(result.current.data?.processing_status).toBe('SUCCEEDED')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
