import { createBrowserRouter, RouterProvider } from 'react-router'
import { MailboxProvider } from './mailbox/provider'
import { Shell } from './components/Shell'
import { Landing } from './pages/Landing'
import { Overview } from './pages/Overview'
import { lazy, Suspense } from 'react'
const Workspace = lazy(() =>
  import('./pages/Workspace').then((module) => ({ default: module.Workspace })),
)
const Extraction = lazy(() =>
  import('./pages/Extraction').then((module) => ({ default: module.Extraction })),
)
const LegacyExtractionRedirect = lazy(() =>
  import('./pages/Extraction').then((module) => ({ default: module.LegacyExtractionRedirect })),
)
const Audit = lazy(() => import('./pages/Audit').then((module) => ({ default: module.Audit })))

const router = createBrowserRouter([
  {
    path: '/',
    element: <Landing />,
  },
  {
    element: <Shell />,
    errorElement: (
      <div className="page">
        <h1>The workspace could not be opened.</h1>
        <p>Your saved analysis remains in the local mailbox.</p>
        <a className="button primary" href="/overview">
          Reload workspace
        </a>
      </div>
    ),
    children: [
      { path: '/overview', element: <Overview /> },
      { path: '/inbox', element: <Overview inbox /> },
      ...['/audit', '/audit/runs/:runId'].map((path) => ({
        path,
        element: (
          <Suspense
            fallback={
              <div className="page" role="status">
                Opening audit trail…
              </div>
            }
          >
            <Audit />
          </Suspense>
        ),
      })),
      {
        path: '/extraction',
        element: (
          <Suspense>
            <LegacyExtractionRedirect />
          </Suspense>
        ),
      },
      ...['/inbox/upload', '/extraction/runs/:runId'].map((path) => ({
        path,
        element: (
          <Suspense
            fallback={
              <div className="page" role="status">
                Opening extraction…
              </div>
            }
          >
            <Extraction />
          </Suspense>
        ),
      })),
      {
        path: '/tasks/:taskId',
        element: (
          <Suspense
            fallback={
              <div className="page" role="status">
                Opening workspace…
              </div>
            }
          >
            <Workspace />
          </Suspense>
        ),
      },
      {
        path: '*',
        element: (
          <div className="page">
            <h1>Page not found</h1>
            <a className="button" href="/overview">
              Return to overview
            </a>
          </div>
        ),
      },
    ],
  },
])
function App() {
  return (
    <MailboxProvider>
      <RouterProvider router={router} />
    </MailboxProvider>
  )
}
export default App
