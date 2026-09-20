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

export function runPath(runId: string, from: string) {
  return `/extraction/runs/${encodeURIComponent(runId)}?from=${encodeURIComponent(returnPath(from))}`
}

export function legacyExtractionPath(search: string) {
  const params = new URLSearchParams(search)
  if (params.get('section') === 'upload') return '/inbox/upload'
  if (params.get('section') === 'history') {
    const offset = pageOffset(params.get('history_offset'))
    return offset ? `/audit?offset=${offset}` : '/audit'
  }
  const query = params.get('q') || params.get('email')
  return query ? `/inbox?${new URLSearchParams({ q: query })}` : '/inbox'
}

export function returnPath(from: string | null) {
  if (from === '/inbox' || from?.startsWith('/inbox?')) return from
  if (from === '/extraction' || from?.startsWith('/extraction?')) {
    const destination = legacyExtractionPath(from.slice('/extraction'.length))
    return destination.startsWith('/inbox?') ? destination : '/inbox'
  }
  return '/inbox'
}
