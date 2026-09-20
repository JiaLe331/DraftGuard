import { useCallback, useEffect, useState } from 'react'

export const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const timeout = AbortSignal.timeout(45000)
  try {
    const response = await fetch(apiBase + path, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new ApiError(
        body?.detail?.message ??
          ([502, 503, 504].includes(response.status)
            ? 'The backend is unavailable. Check that it is running, then retry.'
            : `Request failed (${response.status}).`),
        response.status,
      )
    }
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      'The backend could not be reached or the request timed out. Check the service and retry.',
    )
  }
}
export function documentUrl(emailId: string, documentId: string, page?: number) {
  return `${apiBase}/api/v1/samples/${encodeURIComponent(emailId)}/documents/${encodeURIComponent(documentId)}/content${page ? `#page=${page}` : ''}`
}
export function useResource<T>(path: string) {
  const [attempt, setAttempt] = useState(0)
  const key = `${path}:${attempt}`
  const [state, setState] = useState<{ key: string; data?: T; error?: ApiError }>({ key: '' })
  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    request<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key, data })
      },
      (error) => {
        if (!controller.signal.aborted) setState({ key, error })
      },
    )
    return () => controller.abort()
  }, [path, key])
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    loading: state.key !== key,
    reload,
  }
}
