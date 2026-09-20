import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { DemoProvider } from '../demo/store'
import { Shell } from '../components/Shell'
import { Overview } from './Overview'
import { Workspace } from './Workspace'

function renderRoute(path = '/overview') {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: '/overview', element: <Overview /> },
          { path: '/tasks/:taskId', element: <Workspace /> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(
    <DemoProvider>
      <RouterProvider router={router} />
    </DemoProvider>,
  )
  return router
}
describe('workspace journeys', () => {
  it('opens an issue directly from the work queue', async () => {
    renderRoute()
    await userEvent.click(screen.getAllByRole('link', { name: 'Review differences' })[0])
    expect(await screen.findByRole('heading', { name: 'Consignee' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete review' })).toBeDisabled()
  })
  it('confirms a candidate, saves its review, and enables completion', async () => {
    renderRoute('/tasks/512?field=gross_weight_kg')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm candidate' }))
    await userEvent.type(
      screen.getByLabelText('Source reference and reason'),
      'Checked the weight against BL line 9.',
    )
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Save & recheck' }))
    expect(
      await screen.findByText(
        'Saved in this browser. The seven-field comparison has been updated.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Complete review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm completion' }))
    expect(screen.getByRole('button', { name: 'Review completed' })).toBeDisabled()
  })
  it('keeps the edit open when browser storage rejects a save', async () => {
    renderRoute('/tasks/028?field=shipper')
    await userEvent.click(screen.getByRole('button', { name: 'Correct extraction' }))
    await userEvent.type(screen.getByLabelText('Source reference and reason'), 'Checked line 3.')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota')
    })
    await userEvent.click(screen.getByRole('button', { name: 'Save & recheck' }))
    expect(screen.getByRole('alert')).toHaveTextContent('could not save')
    expect(screen.getByLabelText('Source reference and reason')).toHaveValue('Checked line 3.')
  })
  it('blocks unsaved navigation and returns to the original filter', async () => {
    renderRoute('/overview?status=ready')
    await userEvent.click(screen.getByRole('link', { name: 'Review & complete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Correct extraction' }))
    fireEvent.change(screen.getByLabelText('Source reference and reason'), {
      target: { value: 'Unsaved note' },
    })
    await userEvent.click(screen.getByRole('link', { name: 'Work queue' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Leave without saving?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard & leave' }))
    expect(screen.getByLabelText('Filter by status')).toHaveValue('ready')
  })
})
