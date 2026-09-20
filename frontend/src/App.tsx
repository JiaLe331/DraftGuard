import { useEffect, useState } from 'react'

type ConnectionStatus = 'loading' | 'connected' | 'unavailable'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
const messages: Record<ConnectionStatus, string> = {
  loading: 'Checking the backend connection...',
  connected: 'The DraftGuard API is reachable.',
  unavailable: 'The backend could not be reached. Start the API and try again.',
}

function App() {
  const [status, setStatus] = useState<ConnectionStatus>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    let active = true

    async function checkHealth() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/health`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Health check failed')
        const data: unknown = await response.json()
        if (
          typeof data !== 'object' || data === null ||
          !('status' in data) || data.status !== 'ok' ||
          !('service' in data) || data.service !== 'draftguard-api'
        ) {
          throw new Error('Unexpected health response')
        }
        if (active) setStatus('connected')
      } catch {
        if (active) setStatus('unavailable')
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void checkHealth()
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt])

  return (
    <main>
      <h1>DraftGuard</h1>
      <p>Development scaffold</p>
      <section aria-labelledby="connection-heading">
        <h2 id="connection-heading">Backend connection</h2>
        <div role="status" aria-live="polite">
          <strong>{status.charAt(0).toUpperCase() + status.slice(1)}</strong>
          <p>{messages[status]}</p>
        </div>
        <button
          disabled={status === 'loading'}
          onClick={() => {
            setStatus('loading')
            setAttempt((current) => current + 1)
          }}
        >
          {status === 'loading' ? 'Checking...' : 'Retry connection'}
        </button>
      </section>
      <p className="note">This checks API availability only. Document processing and cloud integrations are not connected yet.</p>
    </main>
  )
}

export default App
