import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Landing } from './Landing'

describe('Landing', () => {
  it('shows the evidence-first product promise and switches comparison examples', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/every draft/i)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/checked against/i)
    expect(screen.getByRole('link', { name: /try the live workspace/i })).toHaveAttribute(
      'href',
      '/overview',
    )
    expect(screen.getByText('Mismatch detected')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Verified' }))

    expect(screen.getByText('Field verified')).toBeVisible()
    expect(screen.getByText('23,702 KGS')).toBeVisible()
  })

  it('keeps a revealed section visible when navigation state changes', async () => {
    const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollIntoView',
    )
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    })

    try {
      const user = userEvent.setup()
      render(
        <MemoryRouter>
          <Landing />
        </MemoryRouter>,
      )

      const workflowSection = screen
        .getByRole('heading', { name: 'A clear path through every draft.' })
        .closest('section')

      expect(workflowSection).toHaveClass('is-visible')

      await user.click(screen.getAllByRole('link', { name: 'Workflow' })[0])

      expect(workflowSection).toHaveClass('is-visible')
      expect(workflowSection).toHaveClass('dg-section-arrival')
    } finally {
      if (scrollIntoViewDescriptor) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor)
      } else {
        delete (Element.prototype as { scrollIntoView?: () => void }).scrollIntoView
      }
    }
  })
})
