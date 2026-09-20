import { createContext, useContext } from 'react'
import type { Task } from './model'
interface DemoContextValue {
  tasks: Task[]
  warning?: string
  update: (task: Task) => void
  reset: () => void
}
export const DemoContext = createContext<DemoContextValue | null>(null)
export function useDemo() {
  const context = useContext(DemoContext)
  if (!context) throw new Error('DemoProvider is required')
  return context
}
