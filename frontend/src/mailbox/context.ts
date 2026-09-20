import { createContext, useContext } from 'react'
import type { Summary } from './types'
export const MailboxContext = createContext<{ summary?: Summary; refresh: () => void } | null>(null)
export function useMailbox() {
  const context = useContext(MailboxContext)
  if (!context) throw new Error('MailboxProvider is required')
  return context
}
