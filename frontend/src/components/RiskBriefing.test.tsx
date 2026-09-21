import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RiskBriefing } from './RiskBriefing'

const briefing = {
  revision: 2,
  notes: [
    { field: 'consignee', consequence: 'The wrong receiver cannot take delivery.' },
    { field: 'notify_party', consequence: 'Arrival notices reach the wrong company.' },
  ],
  provider_call: {
    model_version: 'gemini-3.8-flash-001',
    configured_model: 'gemini-3.8-flash',
    duration_ms: 3179,
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function stubFetch(respond: () => Response) {
  const fetchMock = vi.fn<Fetch>(() => Promise.resolve(respond()))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('RiskBriefing', () => {
  it('stays silent until asked, then explains each confirmed discrepancy', async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify(briefing), { status: 200 }))
    render(
      <RiskBriefing taskId="task-1" revision={2} discrepancies={['consignee', 'notify_party']} />,
    )
    // Nothing is requested on render; the reviewer decides when to ask.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/cannot take delivery/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Explain with Gemini/ }))

    expect(screen.getByText('Consignee')).toBeInTheDocument()
    expect(screen.getByText('The wrong receiver cannot take delivery.')).toBeInTheDocument()
    expect(screen.getByText('Notify party')).toBeInTheDocument()
    expect(screen.getByText(/gemini-3\.8-flash-001/)).toBeInTheDocument()
    expect(screen.getByText(/not a legal, customs or cargo-release opinion/)).toBeInTheDocument()

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ expected_revision: 2 })
  })

  it('renders nothing when the run has no confirmed discrepancy', () => {
    const { container } = render(<RiskBriefing taskId="task-1" revision={1} discrepancies={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('surfaces a provider failure and allows another attempt', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ detail: { code: 'AI_TIMEOUT', message: 'Gemini timed out.' } }),
          { status: 502 },
        ),
    )
    render(<RiskBriefing taskId="task-1" revision={1} discrepancies={['consignee']} />)
    await userEvent.click(screen.getByRole('button', { name: /Explain with Gemini/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Gemini timed out.')
    expect(screen.getByRole('button', { name: /Explain with Gemini/ })).toBeEnabled()
  })
})
