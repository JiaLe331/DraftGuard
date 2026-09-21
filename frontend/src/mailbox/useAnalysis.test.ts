import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnalysis } from './useAnalysis'
import { request } from './api'
import type { SampleDetail } from './types'
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  request: vi.fn(),
}))
const initial = { id: 'one', revision: 1, latest_run: null } as SampleDetail
const saved = {
  ...initial,
  latest_run: { id: 'run', status: 'SUCCEEDED', finished_at: 'original-time' },
} as SampleDetail
const failed = { ...saved, latest_run: { ...saved.latest_run, status: 'FAILED' } } as SampleDetail

describe('analysis presentation pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(request).mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('holds a fast saved response until four seconds without changing its timestamp', async () => {
    vi.mocked(request).mockResolvedValue(saved)
    const { result } = renderHook(() => useAnalysis(initial, vi.fn()))
    await act(async () => {
      await result.current.analyze()
    })
    expect(result.current.phase).toBe('preparing')
    expect(result.current.task).toBe(initial)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999)
    })
    expect(result.current.phase).toBe('preparing')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.task).toBe(saved)
    expect(result.current.phase).toBe('revealed')
  })
  it('allows early reveal and prevents duplicate requests throughout presentation', async () => {
    vi.mocked(request).mockResolvedValue(saved)
    const { result } = renderHook(() => useAnalysis(initial, vi.fn()))
    await act(async () => {
      await result.current.analyze()
      await result.current.analyze()
    })
    expect(request).toHaveBeenCalledTimes(1)
    act(() => result.current.reveal())
    expect(result.current.phase).toBe('revealed')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not add a delay after a slow request', async () => {
    let resolve!: (value: SampleDetail) => void
    vi.mocked(request).mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const { result } = renderHook(() => useAnalysis(initial, vi.fn()))
    act(() => {
      void result.current.analyze()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
      resolve(saved)
    })
    expect(result.current.phase).toBe('revealed')
  })
  it.each(['http', 'run'])('presents %s failures immediately', async (kind) => {
    if (kind === 'http') vi.mocked(request).mockRejectedValue(new Error('Offline'))
    else vi.mocked(request).mockResolvedValue(failed)
    const { result } = renderHook(() => useAnalysis(initial, vi.fn()))
    await act(async () => {
      await result.current.analyze()
    })
    expect(result.current.phase).toBe('failed')
    expect(result.current.busy).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('skips the presentation hold for reduced motion', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList)
    vi.mocked(request).mockResolvedValue(saved)
    const { result } = renderHook(() => useAnalysis(initial, vi.fn()))
    await act(async () => {
      await result.current.analyze()
    })
    expect(result.current.phase).toBe('revealed')
  })
  it('cleans pending presentation timers on unmount', async () => {
    vi.mocked(request).mockResolvedValue(saved)
    const { result, unmount } = renderHook(() => useAnalysis(initial, vi.fn()))
    await act(async () => {
      await result.current.analyze()
    })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores a response after leaving the task', async () => {
    let resolve!: (value: SampleDetail) => void
    vi.mocked(request).mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const refresh = vi.fn()
    const { result, unmount } = renderHook(() => useAnalysis(initial, refresh))
    act(() => {
      void result.current.analyze()
    })
    unmount()
    await act(async () => {
      resolve(saved)
    })
    expect(refresh).not.toHaveBeenCalled()
  })
  it('polls background runs without duplicate submissions and reveals the terminal result', async () => {
    const running = {
      ...saved,
      latest_run: { ...saved.latest_run, status: 'RUNNING' },
    } as SampleDetail
    vi.mocked(request).mockResolvedValueOnce(running).mockResolvedValueOnce(saved)
    const { result } = renderHook(() => useAnalysis(initial, vi.fn()))
    act(() => {
      void result.current.analyze()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.phase).toBe('running')
    expect(result.current.task.latest_run?.status).toBe('RUNNING')
    await act(async () => {
      await result.current.analyze()
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.current.phase).toBe('preparing')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(result.current.task).toBe(saved)
    expect(result.current.phase).toBe('revealed')
  })
  it('stops background polling on navigation', async () => {
    vi.mocked(request).mockResolvedValue({
      ...saved,
      latest_run: { ...saved.latest_run, status: 'RUNNING' },
    } as SampleDetail)
    const { result, unmount } = renderHook(() => useAnalysis(initial, vi.fn()))
    act(() => {
      void result.current.analyze()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('releases the UI lock when observing a background run fails', async () => {
    vi.mocked(request)
      .mockResolvedValueOnce({
        ...saved,
        latest_run: { ...saved.latest_run, status: 'RUNNING' },
      } as SampleDetail)
      .mockRejectedValueOnce(new Error('Connection lost'))
    const { result } = renderHook(() => useAnalysis(initial, vi.fn()))
    act(() => {
      void result.current.analyze()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phase).toBe('failed')
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toBe('Connection lost')
  })
})
