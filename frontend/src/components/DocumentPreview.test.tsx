import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DocumentPreview } from './DocumentPreview'

const document = {
  id: 'doc',
  filename: 'source.txt',
  sha256: 'hash',
  byte_count: 20,
  version: 1,
  created_at: '',
}
describe('Document preview', () => {
  it('loads original text as text and closes without opening another tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          new TextEncoder().encode('Original source\n<script>not markup</script>').buffer,
      }),
    )
    const close = vi.fn()
    render(<DocumentPreview emailId="email" document={document} onClose={close} />)
    expect(await screen.findByText(/<script>not markup<\/script>/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      '/api/v1/records/email/documents/doc/content?download=true',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(close).toHaveBeenCalledOnce()
  })
  it('shows file request failure and retries', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('Recovered source').buffer,
      })
    vi.stubGlobal('fetch', fetcher)
    render(<DocumentPreview emailId="email" document={document} onClose={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('503')
    await userEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
    expect(await screen.findByText('Recovered source')).toBeInTheDocument()
  })
  it('labels office content as extracted rather than an original layout', () => {
    render(
      <DocumentPreview
        emailId="email"
        document={{ ...document, filename: 'source.xlsx' }}
        parsed={{
          id: 'doc',
          role: 'si',
          state: 'PARSED',
          error: null,
          units: [
            { id: 'u', document_id: 'doc', locator: 'Sheet1!A1', text: 'Gross weight: 20 KG' },
          ],
        }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/not the original document layout/)).toBeInTheDocument()
    expect(screen.getByText('Sheet1!A1')).toBeInTheDocument()
    expect(screen.getByText('Gross weight: 20 KG')).toBeInTheDocument()
  })
})
