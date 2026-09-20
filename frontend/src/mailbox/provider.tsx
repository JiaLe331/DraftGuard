import type { ReactNode } from 'react'
import { MailboxContext } from './context'
import { useResource } from './api'
import type { SampleList } from './types'
export function MailboxProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useResource<SampleList>('/api/v1/samples?limit=1')
  return (
    <MailboxContext.Provider value={{ summary: data?.summary, refresh: reload }}>
      {children}
    </MailboxContext.Provider>
  )
}
