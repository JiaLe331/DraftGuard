import { createSeedTasks } from './fixtures'
import type { Task } from './model'
export const STORAGE_KEY = 'draftguard-ui-demo-v1'
export function loadTasks(storage: Pick<Storage, 'getItem'>): { tasks: Task[]; warning?: string } {
  const seed = createSeedTasks()
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { tasks: seed }
    const saved = JSON.parse(raw) as { version: number; tasks: Task[] }
    if (saved.version !== 1 || !Array.isArray(saved.tasks) || saved.tasks.length !== seed.length)
      throw new Error('Invalid snapshot')
    for (const [index, task] of saved.tasks.entries()) {
      const original = seed[index]
      if (
        task.id !== original.id ||
        JSON.stringify(task.revisions) !== JSON.stringify(original.revisions) ||
        !Array.isArray(task.reviews) ||
        !task.revisions.some((r) => r.number === task.currentRevision) ||
        task.reviews.some(
          (r) =>
            !r ||
            typeof r.value !== 'string' ||
            typeof r.reason !== 'string' ||
            !['correct', 'supply', 'confirm'].includes(r.action) ||
            !['si', 'bl'].includes(r.role) ||
            !original.revisions.some(
              (v) => v.number === r.revision && v.fields.some((f) => f.key === r.field),
            ),
        )
      )
        throw new Error('Invalid task')
    }
    return { tasks: saved.tasks }
  } catch {
    return {
      tasks: seed,
      warning:
        'Saved demo data could not be loaded. Original samples are shown; reset the demo to clear the saved copy.',
    }
  }
}
export function persistTasks(storage: Pick<Storage, 'setItem'>, tasks: Task[]) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tasks }))
  } catch {
    throw new Error(
      'Your browser could not save this change. Keep this page open and try again after allowing local storage.',
    )
  }
}
