import { useEffect, useState } from 'react'
import { requestJson, type AuditEvent, type AuditEventPage } from './api'

export function useAuditEvents(runId: string) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    runId: string
    items: AuditEvent[]
    error?: string
    traceMode?: string
  }>({ runId: '', items: [] })
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = false
    let finished = false
    let cursor = 0
    const items = new Map<number, AuditEvent>()
    async function refresh() {
      if (pending || controller.signal.aborted || document.hidden) return
      pending = true
      clearTimeout(timer)
      try {
        let page: AuditEventPage
        do {
          page = await requestJson<AuditEventPage>(
            `/api/v1/dev/runs/${encodeURIComponent(runId)}/events?after_sequence=${cursor}&limit=100`,
            { signal: controller.signal },
          )
          if (controller.signal.aborted) return
          for (const item of page.items) items.set(item.sequence, item)
          cursor = page.next_after_sequence
          setState({ runId, items: [...items.values()], traceMode: page.trace_mode })
        } while (page.has_more && !document.hidden)
        finished = !page.has_more && page.processing_status !== 'RUNNING'
      } catch (error) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            runId,
            items: previous.runId === runId ? previous.items : [],
            error: (error as Error).message,
          }))
      } finally {
        pending = false
        if (!controller.signal.aborted && !finished) timer = setTimeout(refresh, 1000)
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
  }, [runId, revision])
  return {
    items: state.runId === runId ? state.items : [],
    error: state.runId === runId ? state.error : undefined,
    traceMode: state.runId === runId ? state.traceMode : undefined,
    loading: state.runId !== runId,
    reload: () => setRevision((value) => value + 1),
  }
}
