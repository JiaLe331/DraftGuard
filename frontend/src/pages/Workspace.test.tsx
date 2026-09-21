import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { MailboxProvider } from '../mailbox/provider'
import {
  fieldLabels,
  type AmendmentDraft,
  type SampleDetail,
  type SampleList,
  type SourceUnit,
} from '../mailbox/types'
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
      method: 'rule' as const,
      requires_human_confirmation: false,
      reason: 'whitespace_and_case',
      evidence: [evidence(role)],
    })
    return { key, si: extraction('si'), bl: extraction('bl'), finding: 'MISMATCH' as const }
  })
  const result = {
    classification: {
      category: 'BL_COMPARISON' as const,
      method: 'rule' as const,
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
    record_kind: 'sample',
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
function workingSample(): SampleDetail {
  return { ...sample(), record_kind: 'task' }
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
      ...workingSample(),
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
          return json(workingSample())
        }
        return json(url.includes('/samples?') ? listing() : saved ? workingSample() : pending)
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
      ...workingSample(),
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
      ...workingSample(),
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
      screen.queryByRole('button', {
        name: /Complete review|Complete seven-field check|Correct extraction|Save & recheck/,
      }),
    ).not.toBeInTheDocument()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: 'Print report' }))
    expect(screen.getByRole('heading', { name: 'Document review report' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }))
    expect(print).toHaveBeenCalledOnce()
  })
  it('retains the last successful result when a rerun fails and recovers on retry', async () => {
    let current = workingSample()
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
        else
          current = {
            ...workingSample(),
            latest_run: { ...workingSample().latest_run!, id: 'run-new' },
          }
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
    let current = workingSample()
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

function localTask(): SampleDetail {
  return {
    ...sample(),
    id: 'task-copy',
    record_kind: 'task',
    baseline_id: 'email_test',
    current_si_id: 'si',
    current_bl_id: 'bl',
  }
}
function amendmentDraft(method: 'gemini' | 'standard' = 'gemini'): AmendmentDraft {
  return {
    id: 'draft-1',
    task_id: 'task-copy',
    revision: 1,
    run_id: 'run-1',
    recipient: 'sender@example.test',
    subject: 'Please revise the draft BL',
    opening: 'Hello,\n\nPlease address the items below.',
    closing: 'Thank you. Please send the revised documents.',
    issue_items: [
      {
        id: 'consignee:mismatch',
        field: 'consignee',
        field_label: 'Consignee',
        kind: 'mismatch',
        source_role: 'bl',
        si_value: 'SOURCE LTD',
        bl_value: 'OTHER LTD',
        summary: 'Consignee differs between the SI and draft BL.',
        requested_action: 'Revise the draft BL to match the confirmed SI value.',
      },
      {
        id: 'notify_party:mismatch',
        field: 'notify_party',
        field_label: 'Notify party',
        kind: 'mismatch',
        source_role: 'bl',
        si_value: 'SOURCE LTD',
        bl_value: 'OTHER LTD',
        summary: 'Notify party differs between the SI and draft BL.',
        requested_action: 'Revise the draft BL to match the confirmed SI value.',
      },
    ],
    generation_method: method,
    provider_call:
      method === 'gemini'
        ? {
            operation: 'amendment_email',
            document_id: null,
            provider: 'gemini',
            configured_model: 'fake-model',
            model_version: 'fake-v1',
            response_id: 'response-1',
            prompt_version: 'amendment-email-wording-v1',
            duration_ms: 8,
            usage: { total_token_count: 20 },
            cost_usd: null,
          }
        : null,
    user_edited: false,
    created_at: '2026-09-21T00:00:00Z',
    updated_at: '2026-09-21T00:00:00Z',
  }
}
function visualTask(): SampleDetail {
  const task = structuredClone(localTask())
  task.workflow_state = 'REVIEW_REQUIRED'
  task.known_defect_fields = []
  task.coverage = { checked: 0, total: 7 }
  const machine = task.current_run!.result!
  machine.workflow_state = 'REVIEW_REQUIRED'
  machine.known_defect_fields = []
  machine.coverage = { checked: 0, total: 7 }
  machine.provider_calls = [
    {
      operation: 'vision_extraction',
      document_id: 'bl',
      provider: 'gemini',
      configured_model: 'fake-model',
      model_version: 'fake-v1',
      response_id: 'fake-response',
      prompt_version: 'scan-seven-fields-v1',
      duration_ms: 12,
      usage: null,
      cost_usd: null,
    },
  ]
  machine.review_requirements = machine.fields.flatMap((item) =>
    (['si', 'bl'] as const).map((role) => ({
      code: 'AI_CONFIRMATION_REQUIRED',
      message: 'Confirm the visual candidate.',
      document_id: role,
      field: item.key,
    })),
  )
  for (const item of machine.fields) {
    item.finding = 'NEEDS_REVIEW'
    for (const role of ['si', 'bl'] as const) {
      item[role] = {
        ...item[role],
        method: 'gemini_vision',
        requires_human_confirmation: true,
        reason: 'AI_CONFIRMATION_REQUIRED',
        evidence: item[role].evidence.map((evidence) => ({
          ...evidence,
          verified: false,
          verification_source: 'ai_visual_candidate',
        })),
      }
    }
  }
  for (const document of machine.documents) document.state = 'VISUAL_CANDIDATES'
  task.current_run!.reviewed_result = structuredClone(machine)
  task.current_run!.review_actions = []
  task.current_run!.review_progress = {
    total: 14,
    reviewed: 0,
    confirmed: 0,
    corrected: 0,
    pending: 14,
  }
  task.latest_run = task.current_run
  return task
}
function missingValueTask(): SampleDetail {
  const task = structuredClone(localTask())
  const machine = task.current_run!.result!
  const field = machine.fields[0]
  field.bl = {
    ...field.bl,
    raw_value: null,
    normalized_value: null,
    value_state: 'MISSING',
    reason: 'FIELD_NOT_FOUND',
    evidence: [],
  }
  field.finding = 'NEEDS_REVIEW'
  machine.coverage = { checked: 6, total: 7 }
  machine.workflow_state = 'REVIEW_REQUIRED'
  machine.review_requirements = [
    {
      code: 'FIELD_NOT_FOUND',
      message: 'Shipper was not found in the BL.',
      document_id: 'bl',
      field: 'shipper',
    },
  ]
  task.workflow_state = 'REVIEW_REQUIRED'
  task.coverage = machine.coverage
  task.current_run!.reviewed_result = structuredClone(machine)
  task.current_run!.review_actions = []
  task.current_run!.review_progress = {
    total: 0,
    reviewed: 0,
    confirmed: 0,
    corrected: 0,
    supplied: 0,
    pending: 0,
  }
  task.current_run!.completion_eligibility = {
    eligible: false,
    blockers: [{ code: 'coverage_incomplete', message: 'Only 6 of 7 fields are checked.' }],
  }
  task.latest_run = task.current_run
  return task
}
function readyTask(): SampleDetail {
  const task = structuredClone(localTask())
  const machine = task.current_run!.result!
  for (const field of machine.fields) {
    field.bl = {
      ...field.si,
      evidence: field.bl.evidence,
    }
    field.finding = 'MATCH'
  }
  machine.known_defect_fields = []
  machine.review_requirements = []
  machine.coverage = { checked: 7, total: 7 }
  machine.workflow_state = 'READY'
  task.workflow_state = 'READY'
  task.known_defect_fields = []
  task.coverage = machine.coverage
  task.current_run!.reviewed_result = structuredClone(machine)
  task.current_run!.review_actions = []
  task.current_run!.completion_eligibility = { eligible: true, blockers: [] }
  task.latest_run = task.current_run
  return task
}
function taskApi(task = localTask()) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/health')
      return json({ capabilities: { development_tasks: true, development_extraction: false } })
    if (url.startsWith('/api/v1/samples?')) return json(listing())
    if (url.startsWith('/api/v1/dev/tasks?') && options?.method !== 'POST')
      return json({ ...listing(), items: [task] })
    if (url === '/api/v1/records/email_test') return json(sample())
    return json(task)
  })
}

describe('local task revision journeys', () => {
  it('creates a validated custom task and focuses its workspace heading', async () => {
    const created = { ...localTask(), id: 'opaque-custom-id', subject: 'Local manifest review' }
    const base = taskApi(created)
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/dev/tasks/custom' && options?.method === 'POST') return json(created)
      return base(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    const router = renderRoute('/inbox')

    await user.click(await screen.findByRole('button', { name: 'Create local task' }))
    await user.click(screen.getByRole('button', { name: 'Create task' }))
    expect(screen.getAllByText('This field is required.')).toHaveLength(3)
    expect(screen.getByLabelText(/Subject/)).toHaveFocus()
    await user.type(screen.getByLabelText(/Subject/), 'Local manifest review')
    await user.type(screen.getByLabelText(/Sender/), 'ops@example.test')
    await user.type(screen.getByLabelText(/Email body/), 'Compare the attached shipping files.')
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/opaque-custom-id'))
    expect(await screen.findByRole('heading', { name: 'Local manifest review' })).toHaveFocus()
    const body = JSON.parse(
      fetcher.mock.calls.find(([url]) => url === '/api/v1/dev/tasks/custom')![1]!.body as string,
    )
    expect(body).toEqual({
      subject: 'Local manifest review',
      sender: 'ops@example.test',
      body: 'Compare the attached shipping files.',
    })
  })

  it('binds a rule correction to an explicit source unit', async () => {
    const task = localTask()
    let submitted: Record<string, unknown> | undefined
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/reviews') && options?.method === 'POST') {
        submitted = JSON.parse(options.body as string)
        return json(task)
      }
      return taskApi(task)(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')

    await user.click(await screen.findByRole('button', { name: 'Inspect BL Shipper' }))
    await user.click(screen.getByRole('button', { name: 'Correct extraction' }))
    expect(
      screen.getAllByText('Consignee: SOURCE LTD', { selector: 'pre' }).length,
    ).toBeGreaterThan(0)
    await user.clear(screen.getByLabelText('Value visible in the source'))
    await user.type(screen.getByLabelText('Value visible in the source'), 'SOURCE LTD')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    expect(submitted).toMatchObject({
      action: 'CORRECT_EXTRACTION',
      evidence: { kind: 'source_unit', unit_id: 'u1' },
      raw_value: 'SOURCE LTD',
    })
  })

  it('records supplied information without resolving the field or enabling completion', async () => {
    const task = missingValueTask()
    let submitted: Record<string, unknown> | undefined
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/reviews') && options?.method === 'POST') {
        submitted = JSON.parse(options.body as string)
        const next = structuredClone(task)
        const action = {
          id: 'review-supply',
          task_id: next.id,
          revision: 1,
          run_id: 'run-1',
          document_id: 'bl',
          field: 'shipper' as const,
          action: 'SUPPLY_INFORMATION' as const,
          machine_raw_value: null,
          raw_value: 'SOURCE LTD',
          normalized_value: 'SOURCE LTD',
          page: null,
          unit_id: null,
          provenance_source: 'Carrier confirmation',
          provenance_reference: 'Email dated 21 Sep 2026',
          provenance_note: 'Confirmed by forwarding agent',
          actor: 'Demo reviewer — unverified',
          created_at: '2026-09-21T00:00:00Z',
        }
        next.current_run!.review_actions = [action]
        next.current_run!.review_progress!.supplied = 1
        next.current_run!.reviewed_result!.fields[0].bl.supplied_information = action
        next.current_run!.completion_eligibility = {
          eligible: false,
          blockers: [
            { code: 'supplied_information', message: 'Replace the source document to continue.' },
          ],
        }
        return json(next)
      }
      return taskApi(task)(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')

    await user.click(await screen.findByRole('button', { name: 'Supply information' }))
    await user.type(screen.getByLabelText('Supplied value'), 'SOURCE LTD')
    await user.type(screen.getByLabelText('Source name'), 'Carrier confirmation')
    await user.type(
      screen.getByLabelText('Checkable reference or HTTPS URL'),
      'Email dated 21 Sep 2026',
    )
    await user.type(screen.getByLabelText(/Note/), 'Confirmed by forwarding agent')
    await user.click(screen.getByRole('button', { name: 'Record for handover' }))

    expect(submitted).toEqual({
      expected_revision: 1,
      run_id: 'run-1',
      document_id: 'bl',
      field: 'shipper',
      action: 'SUPPLY_INFORMATION',
      raw_value: 'SOURCE LTD',
      provenance: {
        source_name: 'Carrier confirmation',
        reference: 'Email dated 21 Sep 2026',
        note: 'Confirmed by forwarding agent',
      },
    })
    expect(await screen.findByText('Supplied externally · unresolved')).toBeInTheDocument()
    expect(screen.getByText('Replace the source document to continue.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete seven-field check' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Print report' }))
    expect(
      screen.getByRole('heading', { name: /Supplied information · Shipper/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Source: Carrier confirmation/)).toBeInTheDocument()
  })

  it('requires an explicit dialog acknowledgment and persists CHECK_COMPLETE', async () => {
    const task = readyTask()
    let submitted: Record<string, unknown> | undefined
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/complete') && options?.method === 'POST') {
        submitted = JSON.parse(options.body as string)
        const next = structuredClone(task)
        next.workflow_state = 'CHECK_COMPLETE'
        next.current_run!.reviewed_result!.workflow_state = 'CHECK_COMPLETE'
        next.current_run!.completion = {
          id: 'completion-1',
          task_id: next.id,
          revision: 1,
          run_id: 'run-1',
          actor: 'Demo reviewer — unverified',
          acknowledged_at: '2026-09-21T00:00:00Z',
        }
        return json(next)
      }
      return taskApi(task)(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')

    await user.click(await screen.findByRole('button', { name: 'Complete seven-field check' }))
    const dialog = screen.getByRole('dialog', { name: 'Complete seven-field check?' })
    expect(within(dialog).getByText(/Demo reviewer — unverified/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm completion' }))

    expect(submitted).toEqual({
      expected_revision: 1,
      run_id: 'run-1',
      acknowledge_seven_field_scope: true,
    })
    expect(await screen.findByRole('heading', { name: 'Check complete' })).toBeInTheDocument()
    expect(
      screen.getAllByText(
        (_, element) => element?.tagName === 'P' && !!element.textContent?.includes('Run run-1'),
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /amendment email/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Complete seven-field check' }),
    ).not.toBeInTheDocument()
  })

  it('shows visual candidates, source review controls, busy state and persisted confirmation', async () => {
    const task = visualTask()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    let submitted: Record<string, unknown> | undefined
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/documents/') && url.includes('/content')) {
        return new Response(new Uint8Array([1]), { status: 200 })
      }
      if (url.endsWith('/reviews') && options?.method === 'POST') {
        submitted = JSON.parse(options.body as string)
        await waiting
        const next = structuredClone(task)
        const action = {
          id: 'review-1',
          task_id: next.id,
          revision: 1,
          run_id: 'run-1',
          document_id: 'bl',
          field: 'shipper' as const,
          action: 'CONFIRM_CANDIDATE' as const,
          machine_raw_value: 'OTHER LTD',
          raw_value: 'OTHER LTD',
          normalized_value: 'OTHER LTD',
          page: 1,
          unit_id: 'u1',
          actor: 'Demo reviewer — unverified',
          created_at: '2026-09-20T00:00:02Z',
        }
        next.current_run!.review_actions = [action]
        next.current_run!.review_progress = {
          total: 14,
          reviewed: 1,
          confirmed: 1,
          corrected: 0,
          pending: 13,
        }
        const extraction = next.current_run!.reviewed_result!.fields[0].bl
        extraction.requires_human_confirmation = false
        extraction.review = action
        return json(next)
      }
      return taskApi(task)(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')

    expect(await screen.findByText('AI candidates · 0/14 reviewed')).toBeInTheDocument()
    expect(screen.getAllByText(/AI visual candidate · Confirmation required/)).toHaveLength(14)
    await user.click(screen.getByRole('button', { name: 'Inspect BL Shipper' }))
    expect(screen.getByRole('region', { name: 'Source evidence' })).toHaveFocus()
    expect(screen.getByText('AI candidate — confirm against source')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm candidate' }))
    expect(screen.getByRole('button', { name: 'Confirming…' })).toBeDisabled()
    expect(submitted).toMatchObject({
      expected_revision: 1,
      run_id: 'run-1',
      document_id: 'bl',
      field: 'shipper',
      action: 'CONFIRM_CANDIDATE',
      evidence: { kind: 'visual_page', page: 1 },
    })
    release()
    expect((await screen.findAllByText('Confirmed')).length).toBeGreaterThan(0)
    expect(screen.getByText('Candidate confirmed.')).toBeInTheDocument()
  })

  it('shows a correction form and keeps a rejected review error beside it', async () => {
    const task = visualTask()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url.includes('/documents/') && url.includes('/content')) {
          return new Response(new Uint8Array([1]), { status: 200 })
        }
        if (url.endsWith('/reviews') && options?.method === 'POST') {
          return json({ detail: { message: 'The sources changed. Refresh before saving.' } }, 409)
        }
        return taskApi(task)(url, options)
      }),
    )
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')
    await user.click(await screen.findByRole('button', { name: 'Correct extraction' }))
    const value = screen.getByLabelText('Value visible in the source')
    await user.clear(value)
    await user.type(value, 'Corrected shipper')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(
      await screen.findByText('The sources changed. Refresh before saving.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh task' })).toBeInTheDocument()
  })

  it('keeps visual review controls read only in historical results', async () => {
    const task = visualTask()
    task.is_historical = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url.includes('/documents/') && url.includes('/content')) {
          return new Response(new Uint8Array([1]), { status: 200 })
        }
        return taskApi(task)(url, options)
      }),
    )
    renderRoute('/tasks/task-copy?run=run-1')
    expect(await screen.findByText('Historical review actions are read only.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm candidate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct extraction' })).not.toBeInTheDocument()
  })

  it('clones a baseline and lists working copies even when standalone extraction is disabled', async () => {
    const fetcher = taskApi()
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    const router = renderRoute('/tasks/email_test')
    await user.click(await screen.findByRole('button', { name: 'Start review' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/task-copy'))
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/dev/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sample_id: 'email_test' }),
      }),
    )
    await act(async () => router.navigate('/inbox'))
    expect(await screen.findByRole('heading', { name: 'Recent local tasks' })).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('link', { name: 'Please check the draft' })
        .some((link) => link.getAttribute('href') === '/tasks/task-copy'),
    ).toBe(true)
  })

  it('saves a revised source, analyzes its new revision and keeps it available after analysis submission fails', async () => {
    const original = localTask()
    const revised = { ...original, revision: 2, current_run: null, latest_run: null }
    const base = taskApi(original)
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/documents') && options?.method === 'POST') return json(revised)
      if (url.endsWith('/analyze?wait=false'))
        return json({ detail: { message: 'Service temporarily unavailable' } }, 503)
      return base(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')
    await user.upload(
      await screen.findByLabelText('Revised document'),
      new File(['BL'], 'revised.txt', { type: 'text/plain' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save source and recheck' }))
    await screen.findByText(/Service temporarily unavailable/)
    const upload = fetcher.mock.calls.find(([url]) => url.endsWith('/documents'))![1]!
      .body as FormData
    expect(upload.get('role')).toBe('bl')
    expect(upload.get('expected_revision')).toBe('1')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/dev/tasks/task-copy/analyze?wait=false',
      expect.objectContaining({ body: JSON.stringify({ expected_revision: 2 }) }),
    )
    expect(screen.getByText(/Review workspace · Revision 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry analysis' }))
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/documents'))).toHaveLength(1)
  })

  it('submits explicit pair selection and preserves actionable revision conflicts', async () => {
    const base = taskApi()
    const fetcher = vi.fn(async (url: string, options?: RequestInit) =>
      url.endsWith('/pair')
        ? json({ detail: { message: 'Stale revision' } }, 409)
        : base(url, options),
    )
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')
    await user.click(await screen.findByText('Choose an existing SI / BL pair'))
    await user.selectOptions(screen.getByLabelText('BL document'), '')
    await user.click(screen.getByRole('button', { name: 'Save pair and recheck' }))
    expect(
      await screen.findByRole('button', { name: 'Refresh current revision' }),
    ).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/dev/tasks/task-copy/pair',
      expect.objectContaining({
        body: JSON.stringify({ si_id: 'si', bl_id: null, expected_revision: 1 }),
      }),
    )
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/analyze?wait=false'))).toBe(false)
  })

  it('opens a read-only historical run with deltas and prints only its bound sources', async () => {
    const task = localTask()
    task.is_historical = true
    task.revision = 3
    task.documents.push({
      ...task.documents[1],
      id: 'newer-bl',
      filename: 'newer-source.pdf',
      version: 3,
    })
    task.current_run!.result!.revision_delta = {
      baseline_run_id: 'run-zero',
      resolved: ['consignee', 'notify_party'],
      persisting: [],
      new: ['gross_weight_kg'],
      uncertain: [],
    }
    vi.stubGlobal('fetch', taskApi(task))
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy?run=run-1')
    expect(await screen.findByText('Historical result · Read only')).toBeInTheDocument()
    expect(screen.queryByLabelText('Revised document')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reanalyze' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Consignee, Notify party').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /amendment email/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Print report' }))
    expect(screen.getByText('Historical result · Not the current check')).toBeInTheDocument()
    expect(screen.getByText(/Generated .*Source revision 1/)).toBeInTheDocument()
    expect(screen.queryByText(/newer-source/)).not.toBeInTheDocument()
  })

  it('generates, edits, saves and copies an evidence-locked amendment email', async () => {
    let task = localTask()
    let savedPayload: Record<string, unknown> | undefined
    const copied = vi.fn().mockResolvedValue(undefined)
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/amendment-draft') && options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({
          expected_revision: 1,
          run_id: 'run-1',
          method: 'gemini',
        })
        task = { ...task, amendment_draft: amendmentDraft() }
        return json(task)
      }
      if (url.includes('/amendment-draft/draft-1') && options?.method === 'PUT') {
        savedPayload = JSON.parse(options.body as string)
        task = {
          ...task,
          amendment_draft: {
            ...amendmentDraft(),
            ...savedPayload,
            user_edited: true,
            updated_at: '2026-09-21T00:01:00Z',
          },
        }
        return json(task)
      }
      return taskApi(task)(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copied },
    })
    renderRoute('/tasks/task-copy')

    await user.click(await screen.findByRole('button', { name: 'Draft amendment email' }))
    const emptyDialog = screen.getByRole('dialog', { name: 'Draft amendment email' })
    expect(within(emptyDialog).getByText(/stays under DraftGuard’s control/i)).toBeInTheDocument()
    await user.click(within(emptyDialog).getByRole('button', { name: 'Generate with Gemini' }))

    expect(await screen.findByText('AI-polished')).toBeInTheDocument()
    const locked = screen.getByRole('region', { name: 'Items requiring action · 2' })
    expect(within(locked).getByText('Consignee')).toBeInTheDocument()
    expect(within(locked).getAllByText('SOURCE LTD')).toHaveLength(2)
    expect(within(locked).queryByRole('textbox')).not.toBeInTheDocument()

    const recipient = screen.getByLabelText('Recipient')
    await user.clear(recipient)
    await user.type(recipient, 'carrier@example.test')
    await user.clear(screen.getByLabelText('Subject'))
    await user.type(screen.getByLabelText('Subject'), 'Draft BL corrections required')
    await user.click(screen.getByRole('button', { name: 'Copy email' }))

    expect(savedPayload).toMatchObject({
      expected_revision: 1,
      run_id: 'run-1',
      recipient: 'carrier@example.test',
      subject: 'Draft BL corrections required',
    })
    await waitFor(() => expect(copied).toHaveBeenCalledOnce())
    expect(copied.mock.calls[0][0]).toContain('To: carrier@example.test')
    expect(copied.mock.calls[0][0]).toContain('1. Consignee')
    expect(await screen.findByText('Email copied to clipboard.')).toBeInTheDocument()
  })

  it('shows explicit Gemini recovery and labels a chosen standard draft', async () => {
    let task = localTask()
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/amendment-draft') && options?.method === 'POST') {
        const body = JSON.parse(options.body as string)
        if (body.method === 'gemini')
          return json(
            {
              detail: {
                code: 'AI_NOT_CONFIGURED',
                message: 'Gemini amendment email wording is not configured.',
                retryable: false,
              },
            },
            503,
          )
        task = { ...task, amendment_draft: amendmentDraft('standard') }
        return json(task)
      }
      return taskApi(task)(url, options)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    renderRoute('/tasks/task-copy')

    await user.click(await screen.findByRole('button', { name: 'Draft amendment email' }))
    await user.click(screen.getByRole('button', { name: 'Generate with Gemini' }))
    expect(await screen.findByText(/AI_NOT_CONFIGURED/)).toBeInTheDocument()
    expect(
      screen.getByText(/cannot be retried until its configuration changes/i),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate standard draft' }))
    expect(await screen.findByText('Standard template')).toBeInTheDocument()
    expect(screen.getByText('Standard draft saved locally.')).toBeInTheDocument()
  })

  it('confirms regeneration and preserves manual copy recovery when clipboard fails', async () => {
    const task = { ...localTask(), amendment_draft: amendmentDraft() }
    const clipboard = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('fetch', taskApi(task))
    const user = userEvent.setup()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboard },
    })
    renderRoute('/tasks/task-copy')

    const trigger = await screen.findByRole('button', { name: 'Open amendment draft' })
    await user.click(trigger)
    await user.clear(screen.getByLabelText('Opening'))
    await user.type(screen.getByLabelText('Opening'), 'Hello operations team,')
    await user.click(screen.getByRole('button', { name: 'Regenerate with Gemini' }))
    expect(screen.getByText('Replace the current wording?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm regenerate' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep current draft' }))

    await user.clear(screen.getByLabelText('Opening'))
    await user.type(screen.getByLabelText('Opening'), amendmentDraft().opening)
    await user.click(screen.getByRole('button', { name: 'Copy email' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalledOnce())
    expect(await screen.findByText(/Clipboard access was unavailable/)).toBeInTheDocument()
    const preview = screen.getByLabelText('Full email preview')
    await waitFor(() => expect(preview).toHaveFocus())
    expect((preview as HTMLTextAreaElement).value).toContain('Items requiring action:')
    await user.type(screen.getByLabelText('Subject'), ' updated')
    const confirmClose = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(screen.getByRole('dialog', { name: 'Draft amendment email' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(confirmClose).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('does not offer amendment drafting for read-only samples', async () => {
    vi.stubGlobal('fetch', taskApi(sample()))
    renderRoute('/tasks/email_test')
    await screen.findByRole('heading', { name: 'Please check the draft' })
    expect(screen.queryByRole('button', { name: /amendment email/i })).not.toBeInTheDocument()
  })
})
