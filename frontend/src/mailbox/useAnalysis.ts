import { useEffect, useRef, useState } from 'react'
import { request, taskPath } from './api'
import type { SampleDetail } from './types'

export type AnalysisPhase = 'idle' | 'running' | 'preparing' | 'revealed' | 'failed'

export function useAnalysis(initial: SampleDetail, refresh: () => void) {
  const [task, setTask] = useState(initial)
  const [phase, setPhase] = useState<AnalysisPhase>('idle')
  const [error, setError] = useState('')
  const [savedResult, setSavedResult] = useState<SampleDetail['current_run']>(null)
  const locked = useRef(false)
  const mounted = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<SampleDetail | null>(null)
  const controller = useRef<AbortController | null>(null)

  function reveal() {
    clearTimeout(timer.current)
    if (!mounted.current || !pending.current) return
    setTask(pending.current)
    pending.current = null
    locked.current = false
    setPhase('revealed')
  }

  useEffect(() => {
    mounted.current = true
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => {
      if (media.matches) reveal()
    }
    media.addEventListener('change', changed)
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
      controller.current?.abort()
      media.removeEventListener('change', changed)
    }
  }, [])

  async function analyze(source: SampleDetail = task) {
    if (locked.current) return
    if (source.record_kind !== 'task') {
      setError('This sample is read only. Create a working copy before analyzing.')
      setPhase('failed')
      return
    }
    locked.current = true
    setTask(source)
    setError('')
    setSavedResult(null)
    setPhase('running')
    const started = performance.now()
    controller.current = new AbortController()
    try {
      let next = await request<SampleDetail>(`${taskPath(source.id)}/analyze?wait=false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: source.revision }),
        signal: controller.current.signal,
      })
      if (!mounted.current) return
      const signal = controller.current.signal
      while (next.latest_run?.status === 'RUNNING') {
        setTask(next)
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(poll)
            reject(new Error('Analysis observation stopped.'))
          }
          const poll = setTimeout(() => {
            signal.removeEventListener('abort', abort)
            resolve()
          }, 1000)
          signal.addEventListener('abort', abort, { once: true })
        })
        if (!mounted.current) return
        next = await request<SampleDetail>(taskPath(source.id), {
          signal,
        })
        if (!mounted.current) return
      }
      refresh()
      if (next.latest_run?.status !== 'SUCCEEDED') {
        setTask(next)
        setPhase('failed')
        locked.current = false
        return
      }
      pending.current = next
      setSavedResult(next.current_run)
      const remaining = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : Math.max(0, 4000 - (performance.now() - started))
      if (remaining === 0) reveal()
      else {
        setPhase('preparing')
        timer.current = setTimeout(reveal, remaining)
      }
    } catch (failure) {
      if (!mounted.current) return
      setError((failure as Error).message)
      setPhase('failed')
      locked.current = false
    }
  }
  function replaceTask(next: SampleDetail) {
    clearTimeout(timer.current)
    pending.current = null
    setTask(next)
  }
  return {
    task,
    phase,
    error,
    savedResult,
    analyze,
    replaceTask,
    reveal,
    busy: phase === 'running' || phase === 'preparing',
  }
}
