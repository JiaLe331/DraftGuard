import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { MailboxProvider } from '../mailbox/provider'
import { fieldLabels, type SampleDetail, type SampleList, type SourceUnit } from '../mailbox/types'
import { Shell } from '../components/Shell'
import { Overview } from './Overview'
import { Workspace } from './Workspace'

function sample(): SampleDetail {
  const fields = (Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]).map((key) => {
    const evidence = (role: string): SourceUnit & { excerpt: string; verified: boolean } => ({
      id: 'u1',
      document_id: role,
      locator: 'Page 1, line 2',
      page: 1,
      text: 'Consignee: SOURCE LTD',
      excerpt: 'Consignee: SOURCE LTD',
      verified: true,
    })
    const extraction = (role: string) => ({
      raw_value: role === 'si' ? 'SOURCE LTD' : 'OTHER LTD',
      normalized_value: role === 'si' ? 'SOURCE LTD' : 'OTHER LTD',
      value_state: 'PRESENT' as const,
      method: 'rule',
      requires_human_confirmation: false,
      reason: 'whitespace_and_case',
      evidence: [evidence(role)],
    })
    return { key, si: extraction('si'), bl: extraction('bl'), finding: 'MISMATCH' as const }
  })
  const result = {
    classification: {
      category: 'BL_COMPARISON' as const,
      method: 'rule',
      status: 'CLASSIFIED',
      reason: 'Matched email intent.',
    },
    documents: (['si', 'bl'] as const).map((role) => ({
      id: role,
      role,
      state: 'PARSED',
      error: null,
      units: fields[0][role].evidence,
    })),
    fields,
    review_requirements: [],
    known_defect_fields: fields.map((f) => f.key),
    coverage: { checked: 7, total: 7 },
    workflow_state: 'DISCREPANCIES_FOUND' as const,
    processing_status: 'SUCCEEDED',
  }
  const run = {
    id: 'run-1',
    revision: 1,
    pipeline_version: 'rules-1',
    mode: 'precomputed' as const,
    status: 'SUCCEEDED' as const,
    started_at: '2026-09-20T00:00:00Z',
    finished_at: '2026-09-20T00:00:01Z',
    result,
    error: null,
    document_ids: ['si', 'bl'],
  }
  return {
    id: 'email_test',
    subject: 'Please check the draft',
    sender: 'sender@example.test',
    body: 'Original email body, not a generated summary.',
    revision: 1,
    attachment_count: 2,
    category: 'BL_COMPARISON',
    workflow_state: 'DISCREPANCIES_FOUND',
    last_analyzed: run.finished_at,
    mode: 'precomputed',
    known_defect_fields: fields.map((f) => f.key),
    coverage: result.coverage,
    documents: ['si', 'bl'].map((id) => ({
      id,
      filename: `${id}.pdf`,
      sha256: 'test-sha',
      byte_count: 100,
      version: 1,
      created_at: run.started_at,
    })),
    current_run: run,
    latest_run: run,
    runs: [run],
  }
}
function listing(): SampleList {
  return {
    items: [sample()],
    total: 51,
    page: 1,
    limit: 50,
    summary: {
      total: 520,
      attachments: 250,
      states: { DISCREPANCIES_FOUND: 10, REVIEW_REQUIRED: 5, READY: 40 },
    },
  }
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function renderRoute(path = '/overview') {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: '/overview', element: <Overview /> },
          { path: '/inbox', element: <Overview inbox /> },
          { path: '/tasks/:taskId', element: <Workspace /> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(
    <MailboxProvider>
      <RouterProvider router={router} />
    </MailboxProvider>,
  )
  return router
}
function mockApi() {
  return vi.fn(async (url: string) =>
    json(url.startsWith('/api/v1/samples?') ? listing() : sample()),
  )
}

describe('dataset mailbox journeys', () => {
  it('uses server totals, sends pagination and resets the page when filtering', async () => {
    const fetcher = mockApi()
    vi.stubGlobal('fetch', fetcher)
    const router = renderRoute()
    expect(await screen.findByRole('link', { name: 'Please check the draft' })).toBeInTheDocument()
    expect(screen.getByText('520', { selector: '.stat-number' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(router.state.location.search).toContain('page=2')
    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'SPAM')
    expect(router.state.location.search).toBe('?category=SPAM')
    expect(fetcher.mock.calls.some(([url]) => url.includes('page=2'))).toBe(true)
  })
  it('does not use old localStorage samples when the API is unavailable and can retry', async () => {
    localStorage.setItem('draftguard-demo-v1', JSON.stringify([{ subject: 'FAKE OLD RESULT' }]))
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetcher)
    renderRoute()
    expect(
      await screen.findByRole('heading', { name: 'The mailbox could not be loaded' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('FAKE OLD RESULT')).not.toBeInTheDocument()
    fetcher.mockImplementation(async () => json(listing()))
    await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }))
    expect(await screen.findByRole('link', { name: 'Please check the draft' })).toBeInTheDocument()
  })
  it('distinguishes an empty import from an empty search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...listing(),
          items: [],
          total: 0,
          summary: { total: 0, attachments: 0, states: {} },
        }),
      ),
    )
    renderRoute()
    expect(
      await screen.findByRole('heading', { name: 'Your dataset has not been imported' }),
    ).toBeInTheDocument()
  })
  it('opens real evidence and exposes no pretend review or completion actions', async () => {
    vi.stubGlobal('fetch', mockApi())
    renderRoute('/tasks/email_test')
    await screen.findByRole('heading', { name: 'Please check the draft' })
    await userEvent.click(screen.getByRole('button', { name: 'Inspect SI Consignee' }))
    const evidence = screen.getByRole('region', { name: 'Source evidence' })
    expect(within(evidence).getByRole('heading', { name: 'Consignee' })).toBeInTheDocument()
    expect(within(evidence).getByRole('link', { name: 'Open original · page 1' })).toHaveAttribute(
      'href',
      '/api/v1/samples/email_test/documents/si/content#page=1',
    )
    expect(
      screen.queryByRole('button', { name: /Complete review|Correct extraction|Save & recheck/ }),
    ).not.toBeInTheDocument()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: 'Print report' }))
    expect(screen.getByRole('heading', { name: 'Document analysis report' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }))
    expect(print).toHaveBeenCalledOnce()
  })
  it('retains the last successful result when a rerun fails and recovers on retry', async () => {
    let current = sample()
    let posts = 0
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({ expected_revision: 1 })
        posts++
        if (posts === 1)
          current = {
            ...current,
            workflow_state: 'FAILED',
            latest_run: {
              ...current.latest_run!,
              id: 'run-failed',
              status: 'FAILED',
              result: null,
              error: { code: 'analysis_timeout', message: 'Analysis timed out. Retry this email.' },
            },
          }
        else current = { ...sample(), latest_run: { ...sample().latest_run!, id: 'run-new' } }
      }
      return json(url.startsWith('/api/v1/samples?') ? listing() : current)
    })
    vi.stubGlobal('fetch', fetcher)
    renderRoute('/tasks/email_test')
    await userEvent.click(await screen.findByRole('button', { name: 'Reanalyze' }))
    expect(await screen.findByText('Latest analysis failed')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Seven-field comparison' })).toHaveTextContent(
      'SOURCE LTD',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reanalyze' }))
    await screen.findByRole('button', { name: 'Reanalyze' })
    expect(screen.queryByText('Latest analysis failed')).not.toBeInTheDocument()
    expect(posts).toBe(2)
  })
  it('does not show stale list results after a new search starts', async () => {
    let finish: ((r: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('q=missing')
          ? new Promise<Response>((resolve) => {
              finish = resolve
            })
          : Promise.resolve(json(listing())),
      ),
    )
    const router = renderRoute()
    await screen.findByRole('link', { name: 'Please check the draft' })
    await act(async () => {
      await router.navigate('/overview?q=missing')
    })
    expect(screen.queryByRole('link', { name: 'Please check the draft' })).not.toBeInTheDocument()
    await act(async () => {
      finish!(json({ ...listing(), items: [], total: 0 }))
    })
    expect(
      await screen.findByRole('heading', { name: 'No emails on this page' }),
    ).toBeInTheDocument()
  })
  it('shows scan blockers without fabricated extracted values', async () => {
    const detail = sample()
    detail.workflow_state = 'REVIEW_REQUIRED'
    const result = detail.current_run!.result!
    result.review_requirements = [
      { code: 'visual_extraction_required', message: 'This PDF has no usable text layer.' },
    ]
    result.fields = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => json(url.startsWith('/api/v1/samples?') ? listing() : detail)),
    )
    renderRoute('/tasks/email_test')
    expect(await screen.findByText('Visual extraction required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm candidate' })).not.toBeInTheDocument()
  })
})
