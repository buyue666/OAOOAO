'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useStudio } from './store'
import { parseWorkspaceIdentity, workspaceHref, workspaceIdentity } from './workspace-navigation'

type WorkspaceIdentity = { teamId: string; projectId?: string }
const WorkspaceContext = createContext<{ ready: boolean; identity: WorkspaceIdentity | null; select: (identity: WorkspaceIdentity | null) => void; href: (target: string) => string }>({ ready: true, identity: null, select() {}, href: target => target })

/** Login identity and working identity are separate; a team selection persists until explicitly changed. */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { state } = useStudio(), pathname = usePathname(), account = state.user.id
  const [snapshot, setSnapshot] = useState<{ account: string; identity: WorkspaceIdentity | null } | null>(null)
  const seenPath = useRef('')
  const key = `oao:workspace:${account}`
  const persist = (identity: WorkspaceIdentity | null) => { try { if (identity) localStorage.setItem(key, JSON.stringify(identity)); else localStorage.removeItem(key) } catch { /* The in-memory identity remains authoritative for this visit. */ } }
  useEffect(() => {
    if (!account) { setSnapshot(null); return }
    let saved: WorkspaceIdentity | null = null
    try { saved = parseWorkspaceIdentity(localStorage.getItem(key)) } catch {}
    const identity = workspaceIdentity(pathname) || saved
    seenPath.current = pathname; setSnapshot({ account, identity }); persist(identity)
    // Each open tab keeps its own working identity. A switch in another tab must
    // not relabel an already-open project while its route still belongs elsewhere.
  }, [account, key])
  useEffect(() => {
    if (!account || seenPath.current === pathname) return
    seenPath.current = pathname
    const identity = workspaceIdentity(pathname)
    if (identity) { setSnapshot({ account, identity }); persist(identity) }
  }, [account, pathname])
  const ready = !account || snapshot?.account === account
  const identity = snapshot?.account === account ? snapshot.identity : null
  const select = (next: WorkspaceIdentity | null) => { seenPath.current = pathname; setSnapshot({ account, identity: next }); persist(next) }
  const href = (target: string) => identity ? workspaceHref(`/teams/${identity.teamId}${identity.projectId ? `/projects/${identity.projectId}` : ''}`, target) : target
  return <WorkspaceContext.Provider value={{ ready, identity, select, href }}>{children}</WorkspaceContext.Provider>
}
export const useWorkspace = () => useContext(WorkspaceContext)
