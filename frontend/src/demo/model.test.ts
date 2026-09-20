import { describe, expect, it } from 'vitest'
import { createSeedTasks } from './fixtures'
import {
  advanceRevision,
  applyReview,
  canComplete,
  completeTask,
  counts,
  currentVersion,
  filterTasks,
  finding,
  revisionDelta,
  workflow,
} from './model'
import { loadTasks, persistTasks, STORAGE_KEY } from './storage'

describe('review and revision safety', () => {
  it('derives work counts from the sample data', () => {
    const tasks = createSeedTasks()
    expect(tasks.filter((t) => workflow(t) === 'attention')).toHaveLength(6)
    expect(tasks.filter((t) => workflow(t) === 'waiting')).toHaveLength(1)
    expect(tasks.filter((t) => workflow(t) === 'ready')).toHaveLength(1)
    expect(tasks.filter((t) => workflow(t) === 'completed')).toHaveLength(1)
    expect(
      filterTasks(tasks, {
        query: 'Amelia',
        status: '',
        category: 'BL_COMPARISON',
        sort: 'priority',
      }),
    ).toHaveLength(2)
  })
  it('tracks resolved and newly introduced discrepancies without reusing completion', () => {
    const original = createSeedTasks()[0]
    expect(counts(original).MISMATCH).toBe(2)
    const v2 = advanceRevision(original)
    expect(revisionDelta(v2, 2)).toEqual({ resolved: 2, remaining: 0, introduced: 1, uncertain: 0 })
    expect(canComplete(v2)).toBe(false)
    expect(() => completeTask(v2)).toThrow()
    const v3 = advanceRevision(v2)
    expect(revisionDelta(v3, 3)?.resolved).toBe(1)
    expect(canComplete(v3)).toBe(true)
    expect(workflow(completeTask(v3))).toBe('completed')
    expect(original.currentRevision).toBe(1)
    expect(original.isCopy).toBeUndefined()
    const oldCompletion = { ...original, completedRevision: 1 }
    expect(advanceRevision(oldCompletion).completedRevision).toBeUndefined()
  })
  it('keeps missing and supplied information unresolved', () => {
    const task = createSeedTasks()[1]
    const reviewed = applyReview(task, {
      revision: 1,
      field: 'gross_weight_kg',
      role: 'si',
      action: 'supply',
      value: '235,550 KG',
      reason: 'Shipper confirmation, pending verification',
    })
    expect(finding(reviewed, currentVersion(reviewed).fields[6])).toBe('NEEDS_REVIEW')
    expect(canComplete(reviewed)).toBe(false)
    expect(currentVersion(reviewed).fields[6].si.raw).toBe('N/A')
    expect(task.reviews).toHaveLength(0)
  })
  it('blocks unconfirmed scan candidates and preserves machine output after confirmation', () => {
    const task = createSeedTasks()[2]
    expect(counts(task).NEEDS_REVIEW).toBe(1)
    expect(() => completeTask(task)).toThrow()
    const reviewed = applyReview(task, {
      revision: 1,
      field: 'gross_weight_kg',
      role: 'bl',
      action: 'confirm',
      value: '131,058 KG',
      reason: 'Checked BL line 9',
    })
    expect(canComplete(reviewed)).toBe(true)
    expect(currentVersion(reviewed).fields[6].bl.candidate).toBe(true)
    expect(reviewed.reviews).toHaveLength(1)
    expect(workflow(reviewed)).toBe('ready')
  })
  it('corrects a misread value from its actual sample evidence', () => {
    const task = createSeedTasks().find((t) => t.id === '160')!
    const corrected = applyReview(task, {
      revision: 1,
      field: 'gross_weight_kg',
      role: 'bl',
      action: 'correct',
      value: '88,750 KG',
      reason: 'BL line 9 shows 88,750 KG.',
    })
    expect(counts(corrected).MISMATCH).toBe(0)
    expect(canComplete(corrected)).toBe(true)
    expect(currentVersion(corrected).fields[6].bl.raw).toBe('88,570 KG')
  })
  it('rejects fabricated extraction corrections and stale reviews', () => {
    const task = createSeedTasks()[0]
    const review = {
      revision: 1,
      field: 'consignee' as const,
      role: 'bl' as const,
      action: 'correct' as const,
      value: 'EAST BRIGHT FZ-LLC',
      reason: 'Try to match SI',
    }
    expect(() => applyReview(task, review)).toThrow('does not match')
    expect(() => applyReview(advanceRevision(task), review)).toThrow('historical')
  })
  it('saves and restores a local working copy without changing the baseline', () => {
    const tasks = createSeedTasks()
    tasks[0] = advanceRevision(tasks[0])
    persistTasks(localStorage, tasks)
    expect(loadTasks(localStorage).tasks[0].currentRevision).toBe(2)
    expect(createSeedTasks()[0].currentRevision).toBe(1)
  })
  it('reports storage failures and safely handles invalid saved data', () => {
    expect(() =>
      persistTasks(
        {
          setItem() {
            throw new Error('Quota')
          },
        },
        createSeedTasks(),
      ),
    ).toThrow('could not save')
    localStorage.setItem(STORAGE_KEY, 'bad JSON')
    expect(loadTasks(localStorage).warning).toBeTruthy()
    expect(loadTasks(localStorage).tasks).toHaveLength(13)
  })
})
