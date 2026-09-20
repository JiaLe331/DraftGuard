import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Extraction } from './Extraction'
import type { ExtractionRun, ExtractedDocument, Locator } from '../extraction/api'

const email = {
  email_id: 'email_004',
  from: 'sender@example.test',
  subject: 'Shipment instructions',
  body: 'Please review both attachments.',
  attachments: ['attachments/SI.txt', 'attachments/BL.txt'],
}
const locator: Locator = {
  page: null,
  line: 1,
  paragraph: null,
  table: null,
  row: null,
  column: null,
  sheet: null,
  cell: null,
}
function document(id: string, filename: string): ExtractedDocument {
  return {
    document_id: id,
    filename,
    content_sha256: 'abc123',
    byte_count: 80,
    has_original: true,
    processing_status: 'SUCCEEDED',
    error: null,
    result: {
      document_id: id,
      detected_format: 'txt',
      detected_role: 'SI',
      parsing_status: 'READABLE',
      needs_review: false,
      issues: [],
      source_units: [
        {
          ...locator,
          unit_id: `${id}-1`,
          document_id: id,
          text: 'SHIPPING INSTRUCTION',
          is_formula: false,
        },
        {
          ...locator,
          line: 2,
          unit_id: `${id}-2`,
          document_id: id,
          text: `Shipper: ${id} Logistics`,
          is_formula: false,
        },
      ],
      fields: [
        {
          field: 'shipper',
          raw_value: `${id} Logistics`,
          normalized_value: `${id} Logistics`,
          value_state: 'PRESENT',
          method: 'rule',
          evidence: [
            {
              ...locator,
              line: 2,
              unit_id: `${id}-2`,
              document_id: id,
              excerpt: `${id} Logistics`,
              verified: true,
            },
          ],
        },
      ],
    },
    events: [
      {
        sequence: 1,
        timestamp: '2026-09-20T01:00:00Z',
        elapsed_ms: 2,
        stage: 'validation',
        status: 'COMPLETED',
        message: 'Validated source file',
        details: { parser: 'txt' },
      },
    ],
  }
}
const run: ExtractionRun = {
  run_id: 'run-1',
  request_id: 'req-1',
  source_type: 'dataset_email',
  source_label: email.subject,
  created_at: '2026-09-20T01:00:00Z',
  finished_at: '2026-09-20T01:00:02Z',
  processing_status: 'SUCCEEDED',
  needs_review: false,
  document_count: 2,
  pipeline_version: 'rules-1',
  email,
  documents: [document('doc-si', 'SI.txt'), document('doc-bl', 'BL.txt')],
  issues: [],
}
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function setup(
  path = '/extraction',
  override?: (path: string, init?: RequestInit) => Promise<Response> | undefined,
) {
  vi.stubGlobal('innerWidth', 1440)
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const overridden = override?.(input, init)
    if (overridden) return overridden
    if (input === '/api/health')
      return Promise.resolve(
        response({
          capabilities: { development_extraction: true, upload_limit_bytes: 3 * 1024 * 1024 },
        }),
      )
    if (input.startsWith('/api/v1/dev/emails?'))
      return Promise.resolve(
        response({ items: [{ ...email, attachment_count: 2 }], total: 1, dataset_total: 520 }),
      )
    if (input === '/api/v1/dev/emails/email_004') return Promise.resolve(response(email))
    if (input === '/api/v1/dev/runs/run-1') return Promise.resolve(response(run))
    if (input.startsWith('/api/v1/dev/runs?'))
      return Promise.resolve(response({ items: [run], total: 1 }))
    if (init?.method === 'POST') return Promise.resolve(response(run))
    return Promise.resolve(response({}, 404))
  })
  vi.stubGlobal('fetch', fetchMock)
  const router = createMemoryRouter(
    [
      { path: '/extraction', element: <Extraction /> },
      { path: '/extraction/runs/:runId', element: <Extraction /> },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return { fetchMock, router }
}

afterEach(() => vi.unstubAllGlobals())

it('shows retained mailbox attachments as skipped when comparison was not requested', async () => {
  const skipped: ExtractionRun = {
    ...run,
    source_type: 'mailbox_email',
    mailbox: { email_id: 'email_004', run_id: 'run-1', revision: 1, mode: 'interactive' },
    documents: [{ ...run.documents[0], result: null, processing_status: 'SKIPPED' }],
    document_count: 1,
  }
  setup('/extraction/runs/run-1', (path) =>
    path === '/api/v1/dev/runs/run-1' ? Promise.resolve(response(skipped)) : undefined,
  )
  expect(await screen.findByText('MAILBOX EMAIL · email_004')).toBeInTheDocument()
  expect(screen.getByText('Skipped')).toBeInTheDocument()
  expect(screen.getByText(/retained without extraction/)).toBeInTheDocument()
  expect(screen.queryByText('Processing')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open mailbox results' })).toHaveAttribute(
    'href',
    '/tasks/email_004',
  )
})

describe('local extraction journeys', () => {
  it('opens an email without processing, then extracts all attachments in one request', async () => {
    const { fetchMock } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /email_004/ }))
    expect(await screen.findByText(email.body)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Extract attachments' }))
    const tabs = await screen.findByRole('navigation', { name: 'Attachments' })
    expect(within(tabs).getAllByRole('button')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/dev/emails/email_004/extract?wait=false', {
      method: 'POST',
    })
  })

  it('sends the file and expected role as multipart data and blocks duplicate submission', async () => {
    let finish!: (value: Response) => void
    const { fetchMock } = setup('/extraction', (path) =>
      path === '/api/v1/dev/extract?wait=false'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : undefined,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Upload a document' }))
    const file = new File(['SHIPPING INSTRUCTION'], 'source.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText('Document'), file)
    await userEvent.selectOptions(screen.getByLabelText('Expected document role'), 'SI')
    await userEvent.dblClick(screen.getByRole('button', { name: 'Extract document' }))
    expect(screen.getByRole('button', { name: 'Extracting document…' })).toBeDisabled()
    const uploads = fetchMock.mock.calls.filter(
      ([path]) => path === '/api/v1/dev/extract?wait=false',
    )
    expect(uploads).toHaveLength(1)
    expect((uploads[0][1]?.body as FormData).get('file')).toBe(file)
    expect((uploads[0][1]?.body as FormData).get('expected_role')).toBe('SI')
    expect(uploads[0][1]?.headers).toBeUndefined()
    finish(response(run))
    expect(await screen.findByRole('heading', { name: 'Extracted fields' })).toBeInTheDocument()
  })

  it('opens the selected source evidence and keeps attachment sources separate', async () => {
    setup('/extraction/runs/run-1')
    await screen.findByRole('heading', { name: 'Extracted fields' })
    expect(screen.getByTestId('source-evidence')).toHaveTextContent('SHIPPING INSTRUCTION')
    await userEvent.click(screen.getByRole('button', { name: 'View Shipper evidence 1: Line 2' }))
    expect(screen.getByTestId('source-evidence')).toHaveTextContent('doc-si Logistics')
    await userEvent.click(screen.getByRole('button', { name: /BL.txt/ }))
    await userEvent.click(screen.getByRole('button', { name: 'View Shipper evidence 1: Line 2' }))
    expect(screen.getByTestId('source-evidence')).toHaveTextContent('doc-bl Logistics')
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      '/api/v1/dev/runs/run-1/documents/doc-bl/original',
    )
  })

  it('reopens saved history without starting another extraction', async () => {
    const { fetchMock } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'History' }))
    await userEvent.click(await screen.findByRole('link', { name: /Shipment instructions/ }))
    expect(await screen.findByRole('link', { name: 'Download audit JSON' })).toHaveAttribute(
      'href',
      '/api/v1/dev/runs/run-1?download=true',
    )
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('shows a failed save and restores the submit button', async () => {
    setup('/extraction', (path) =>
      path === '/api/v1/dev/emails/email_004/extract?wait=false'
        ? Promise.resolve(
            response(
              {
                error: {
                  code: 'AUDIT_SAVE_FAILED',
                  message: 'Local history could not be saved.',
                  request_id: 'req-failed',
                },
              },
              503,
            ),
          )
        : undefined,
    )
    await userEvent.click(await screen.findByRole('button', { name: /email_004/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Extract attachments' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Local history could not be saved. Request: req-failed',
    )
    expect(screen.getByRole('button', { name: 'Extract attachments' })).toBeEnabled()
    expect(screen.queryByText('Extraction finished')).not.toBeInTheDocument()
  })

  it('searches the dataset and allows emails without attachments', async () => {
    const { fetchMock } = setup()
    const search = await screen.findByRole('textbox', { name: 'Search emails' })
    fireEvent.change(search, { target: { value: 'email_055' } })
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'With attachments only' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/dev/emails?q=email_055&has_attachments=false&limit=20&offset=0',
        expect.any(Object),
      ),
    )
  })

  it('does not access development routes when the feature is disabled', async () => {
    const { fetchMock } = setup('/extraction', (path) =>
      path === '/api/health'
        ? Promise.resolve(response({ capabilities: { development_extraction: false } }))
        : undefined,
    )
    expect(await screen.findByText(/Local extraction is disabled/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([path]) => path === '/api/health')).toBe(true)
  })

  it('returns to the selected email and filters after inspecting a run', async () => {
    const { router } = setup('/extraction?q=email_004&all=true&email=email_004')
    expect(await screen.findByRole('textbox', { name: 'Search emails' })).toHaveValue('email_004')
    await userEvent.click(await screen.findByRole('button', { name: 'Extract attachments' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Back to extraction' }))
    expect(router.state.location.search).toBe('?q=email_004&all=true&email=email_004')
    expect(await screen.findByText(email.body)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'With attachments only' })).not.toBeChecked()
  })

  it('reopens the document and evidence specified by the URL', async () => {
    setup('/extraction/runs/run-1?document=doc-bl&unit=doc-bl-2&field=shipper')
    expect(await screen.findByTestId('source-evidence')).toHaveTextContent('doc-bl Logistics')
    expect(screen.getByRole('button', { name: /BL.txt/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'View Shipper evidence 1: Line 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('moves focus to source evidence on narrower screens and remembers the selection', async () => {
    const { router } = setup('/extraction/runs/run-1')
    const source = await screen.findByRole('region', { name: 'Source evidence' })
    source.scrollIntoView = vi.fn()
    vi.stubGlobal('innerWidth', 390)
    await userEvent.click(screen.getByRole('button', { name: 'View Shipper evidence 1: Line 2' }))
    expect(source).toHaveFocus()
    expect(source.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(new URLSearchParams(router.state.location.search).get('unit')).toBe('doc-si-2')
    expect(screen.getByTestId('source-evidence')).toHaveTextContent('doc-si Logistics')
  })
})
