import { useEffect, useState } from 'react'
import { requestJson } from './api'

export function useResource<T>(path: string) {
  const [revision, setRevision] = useState(0)
  const key = `${path}:${revision}`
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' })
  useEffect(() => {
    const controller = new AbortController()
    requestJson<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key, data })
      },
      (error: Error) => {
        if (!controller.signal.aborted) setState({ key, error: error.message })
      },
    )
    return () => controller.abort()
  }, [path, key])
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    loading: state.key !== key,
    reload: () => setRevision((value) => value + 1),
  }
}
