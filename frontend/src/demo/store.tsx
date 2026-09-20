import { useState, type ReactNode } from 'react'
import { createSeedTasks } from './fixtures'
import { loadTasks, persistTasks, STORAGE_KEY } from './storage'
import type { Task } from './model'
import { DemoContext } from './context'
export function DemoProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(() => {
    try {
      return loadTasks(window.localStorage)
    } catch {
      return {
        tasks: createSeedTasks(),
        warning:
          'Browser storage is unavailable. You can explore samples, but changes cannot be saved.',
      }
    }
  })
  function update(task: Task) {
    const tasks = snapshot.tasks.map((item) => (item.id === task.id ? task : item))
    persistTasks(window.localStorage, tasks)
    setSnapshot({ tasks })
  }
  function reset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      throw new Error(
        'The browser could not reset saved data. Check your storage settings and retry.',
      )
    }
    setSnapshot({ tasks: createSeedTasks() })
  }
  return (
    <DemoContext.Provider value={{ ...snapshot, update, reset }}>{children}</DemoContext.Provider>
  )
}
