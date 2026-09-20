import { useSearchParams } from 'react-router'

export function useExtractionParams() {
  const [params, setParams] = useSearchParams()
  function update(changes: Record<string, string | null>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )
  }
  return { params, update }
}

export function pageOffset(value: string | null) {
  const offset = Number(value)
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
}

export function runPath(runId: string, search: string) {
  return `/extraction/runs/${encodeURIComponent(runId)}?from=${encodeURIComponent(`/extraction${search}`)}`
}

export function returnPath(from: string | null) {
  return from === '/extraction' || from?.startsWith('/extraction?') ? from : '/extraction'
}
