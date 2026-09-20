import { Navigate, createBrowserRouter, RouterProvider } from 'react-router'
import { DemoProvider } from './demo/store'
import { Shell } from './components/Shell'
import { Overview } from './pages/Overview'
import { lazy, Suspense } from 'react'
const Workspace = lazy(() =>
  import('./pages/Workspace').then((module) => ({ default: module.Workspace })),
)
const Extraction = lazy(() =>
  import('./pages/Extraction').then((module) => ({ default: module.Extraction })),
)

const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: (
      <div className="page">
        <h1>The workspace could not be opened.</h1>
        <p>Your saved local data has not been cleared.</p>
        <a className="button primary" href="/overview">
          Reload workspace
        </a>
      </div>
    ),
    children: [
      { path: '/', element: <Navigate to="/overview" replace /> },
      { path: '/overview', element: <Overview /> },
      { path: '/inbox', element: <Overview inbox /> },
      ...['/extraction', '/extraction/runs/:runId'].map((path) => ({
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
    <DemoProvider>
      <RouterProvider router={router} />
    </DemoProvider>
  )
}
export default App
