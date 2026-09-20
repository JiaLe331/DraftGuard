import { useEffect, useState } from 'react'
import { requestJson } from './api'

// One request at a time. Retain the last saved snapshot on refresh or connection failure.
export function usePollingResource<T>(path: string, interval = 1000, untilFinished = false) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>({ path: '' })
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = false
    let finished = false
    async function refresh() {
      if (pending || controller.signal.aborted || document.hidden) return
      pending = true
      clearTimeout(timer)
      try {
        const data = await requestJson<T>(path, { signal: controller.signal })
        if (controller.signal.aborted) return
        setState({ path, data })
        finished =
          untilFinished && (data as { processing_status?: string }).processing_status !== 'RUNNING'
      } catch (error) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            path,
            data: previous.path === path ? previous.data : undefined,
            error: (error as Error).message,
          }))
      } finally {
        pending = false
        if (!controller.signal.aborted && !finished) timer = setTimeout(refresh, interval)
      }
    }
    function visible() {
      if (!document.hidden && !finished) void refresh()
    }
    void refresh()
    document.addEventListener('visibilitychange', visible)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [path, revision, interval, untilFinished])
  return {
    data: state.path === path ? state.data : undefined,
    error: state.path === path ? state.error : undefined,
    loading: state.path !== path,
    reload: () => setRevision((value) => value + 1),
  }
}
