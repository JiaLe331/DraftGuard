import { act, render, screen, waitFor, within } from '@testing-library/react'
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
  it('shows a first analysis journey without fabricated previous results', async () => {
    const pending: SampleDetail = {
      ...sample(),
      category: null,
      workflow_state: 'NOT_ANALYZED',
      current_run: null,
      latest_run: null,
      last_analyzed: null,
      runs: [],
    }
    let saved = false
    let finish!: () => void
    const wait = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
          await wait
          saved = true
          return json(sample())
        }
        return json(url.includes('/samples?') ? listing() : saved ? sample() : pending)
      }),
    )
    renderRoute('/tasks/email_test')
    await screen.findByRole('button', { name: 'Start analysis' })
    expect(screen.queryByRole('table', { name: 'Seven-field comparison' })).not.toBeInTheDocument()
    expect(screen.getByText(/Not classified yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start analysis' }))
    expect(screen.getByText('Reading email context…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled()
    expect(screen.queryByText(/previous saved result remains/)).not.toBeInTheDocument()
    await act(async () => {
      finish()
      await wait
    })
    expect(screen.queryByRole('button', { name: 'Show results now' })).not.toBeInTheDocument()
    expect(
      await screen.findByRole('table', { name: 'Seven-field comparison' }, { timeout: 4500 }),
    ).toBeInTheDocument()
  })
  it('shows only real files and expands more than two attachments', async () => {
    const pending = {
      ...sample(),
      current_run: null,
      latest_run: null,
      category: null,
      workflow_state: 'NOT_ANALYZED',
      documents: [0, 1, 2].map((i) => ({
        ...sample().documents[0],
        id: `doc-${i}`,
        filename: `long-original-source-${i}.pdf`,
        byte_count: 1024,
      })),
      attachment_count: 3,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => json(url.includes('/samples?') ? listing() : pending)),
    )
    renderRoute('/tasks/email_test')
    await screen.findByRole('button', { name: 'Start analysis' })
    expect(screen.getAllByRole('button', { name: 'Start analysis' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Analyze email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /long-original-source-2/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all attachments (3)' }))
    expect(
      screen.getByRole('button', { name: /long-original-source-2.pdf PDF · 1.0 KB/ }),
    ).toBeInTheDocument()
  })
  it('offers classification for email without invented attachments', async () => {
    const pending = {
      ...sample(),
      current_run: null,
      latest_run: null,
      category: null,
      workflow_state: 'NOT_ANALYZED',
      documents: [],
      attachment_count: 0,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => json(url.includes('/samples?') ? listing() : pending)),
    )
    renderRoute('/tasks/email_test')
    expect(
      await screen.findByText('No attachments · Email classification only'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start analysis' })).toBeEnabled()
  })
  it('opens real evidence and exposes no pretend review or completion actions', async () => {
    vi.stubGlobal('fetch', mockApi())
    renderRoute('/tasks/email_test')
    await screen.findByRole('heading', { name: 'Please check the draft' })
    await userEvent.click(screen.getByRole('button', { name: 'Inspect SI Consignee' }))
    const evidence = screen.getByRole('region', { name: 'Source evidence' })
    expect(within(evidence).getByRole('heading', { name: 'Consignee' })).toBeInTheDocument()
    expect(within(evidence).getByRole('button', { name: 'Open original · page 1' })).toBeEnabled()
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
    expect(screen.queryByRole('button', { name: 'Show results now' })).not.toBeInTheDocument()
    await screen.findByRole('button', { name: 'Reanalyze' }, { timeout: 4500 })
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
  it('starts background analysis once and links the live and historical audit', async () => {
    let current = sample()
    let activeReads = 0
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/health') return json({ capabilities: { development_extraction: true } })
      if (url.startsWith('/api/v1/samples?')) {
        const list = listing()
        if (current.latest_run?.id === 'new-run' && current.latest_run.status === 'SUCCEEDED')
          list.summary.states = { DISCREPANCIES_FOUND: 12 }
        return json(list)
      }
      if (options?.method === 'POST') {
        expect(url).toContain('/analyze?wait=false')
        current = {
          ...current,
          latest_run: {
            ...current.latest_run!,
            id: 'new-run',
            audit_run_id: 'audit-new',
            status: 'RUNNING',
          },
        }
        return json(current, 202)
      }
      if (current.latest_run?.status === 'RUNNING' && ++activeReads >= 2) {
        const done = { ...current.latest_run, status: 'SUCCEEDED' as const }
        current = { ...current, latest_run: done, current_run: done, runs: [done] }
      }
      return json(current)
    })
    vi.stubGlobal('fetch', fetcher)
    renderRoute('/tasks/email_test')
    await userEvent.dblClick(await screen.findByRole('button', { name: 'Reanalyze' }))
    expect(await screen.findByRole('link', { name: 'View live audit' })).toHaveAttribute(
      'href',
      '/audit/runs/audit-new',
    )
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled()
    await waitFor(
      () =>
        expect(screen.getByRole('link', { name: 'View audit trail' })).toHaveAttribute(
          'href',
          '/audit/runs/audit-new',
        ),
      { timeout: 4500 },
    )
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /^Overview/ })).toHaveTextContent('Overview12'),
    )
    expect(
      screen.getByRole('link', { name: 'Open this run’s audit', hidden: true }),
    ).toHaveAttribute('href', '/audit/runs/audit-new')
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
