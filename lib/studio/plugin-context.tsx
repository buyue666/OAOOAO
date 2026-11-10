'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { request } from './api'
import { useStudio } from './store'
import { normalizeInstalledPlugins, type CreativePluginId } from './creative-plugins'

type PluginSnapshot = { owner: string; installed: CreativePluginId[] }
type PluginContextValue = {
  installed: readonly CreativePluginId[]
  ready: boolean
  pending: CreativePluginId | null
  error: string
  isInstalled: (id: CreativePluginId) => boolean
  setInstalled: (id: CreativePluginId, installed: boolean) => Promise<boolean>
}
const PluginContext = createContext<PluginContextValue | null>(null)

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const { state, refreshSession } = useStudio()
  const router = useRouter()
  const owner = state.backendStatus === 'connected' ? state.user.id : ''
  const identity = useRef(owner)
  identity.current = owner
  const [snapshot, setSnapshot] = useState<PluginSnapshot>({ owner: '', installed: [] })
  const [operation, setOperation] = useState<{ owner: string; id: CreativePluginId } | null>(null)
  const [failure, setFailure] = useState({ owner: '', message: '' })
  const busy = useRef(false)
  const revision = useRef(0)
  const ready = Boolean(owner && state.hydrated)
  const installed = useMemo(() => !ready ? [] : snapshot.owner === owner ? snapshot.installed
    : normalizeInstalledPlugins(state.sessionSettings?.installedPlugins), [ready, snapshot, owner, state.sessionSettings?.installedPlugins])

  const sync = useCallback(async () => {
    const account = identity.current, ticket = revision.current
    if (!account || busy.current) return
    try {
      const result = await request<{ installedPlugins: unknown }>('/api/account/plugins')
      if (identity.current === account && ticket === revision.current) setSnapshot({ owner: account, installed: normalizeInstalledPlugins(result.installedPlugins) })
    } catch { /* Retain the last confirmed preference if the connection is unavailable. */ }
  }, [])

  useEffect(() => {
    if (!owner) return
    const onStorage = (event: StorageEvent) => { if (event.key === `oao-plugins:${owner}`) void sync() }
    const onFocus = () => { if (document.visibilityState === 'visible') void sync() }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onFocus)
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onFocus) }
  }, [owner, sync])

  const setInstalled = useCallback(async (id: CreativePluginId, enabled: boolean) => {
    const account = identity.current
    if (!account || busy.current) return false
    busy.current = true
    revision.current += 1
    setOperation({ owner: account, id })
    setFailure({ owner: account, message: '' })
    try {
      const result = await request<{ installedPlugins: unknown }>('/api/account/plugins', {
        method: 'PATCH', body: JSON.stringify({ pluginId: id, installed: enabled }),
      })
      if (identity.current !== account) return false
      setSnapshot({ owner: account, installed: normalizeInstalledPlugins(result.installedPlugins) })
      try { localStorage.setItem(`oao-plugins:${account}`, String(Date.now())) } catch {}
      // Refresh server-loaded canvas data only after installation is committed.
      router.refresh()
      void refreshSession()
      return true
    } catch (reason) {
      if (identity.current === account) setFailure({ owner: account, message: reason instanceof Error ? reason.message : '插件设置保存失败，请重试。' })
      return false
    } finally {
      busy.current = false
      setOperation(current => current?.owner === account ? null : current)
    }
  }, [router, refreshSession])

  const value = useMemo<PluginContextValue>(() => ({ installed, ready,
    pending: operation?.owner === owner ? operation.id : null,
    error: failure.owner === owner ? failure.message : '',
    isInstalled: id => installed.includes(id), setInstalled,
  }), [installed, ready, operation, failure, owner, setInstalled])
  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
}

export function usePlugins() {
  const context = useContext(PluginContext)
  if (!context) throw new Error('PluginProvider is required')
  return context
}
