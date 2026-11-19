'use client'

import { useEffect, useRef, useState } from 'react'
import { request } from './api'
import { readAccountSettingsVisibility, subscribeAccountSettingsVisibility, type AccountSettingsVisibility } from './account-settings-visibility'

export function useAccountSettingsVisibility({ accountId, connected, active }: { accountId: string; connected: boolean; active: boolean }) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; value: AccountSettingsVisibility } | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!connected || !accountId) { setSnapshot(null); refreshRef.current = () => {}; return }
    let disposed = false, revision = 0, pending: AbortController | null = null
    const apply = (value: AccountSettingsVisibility) => { if (!disposed) setSnapshot({ accountId, value }) }
    const refresh = async () => {
      if (disposed || pending || document.visibilityState === 'hidden') return
      const controller = new AbortController(), startedAt = revision
      pending = controller
      try {
        const response = await request<{ visibility: unknown }>('/api/account/settings-visibility', { signal: controller.signal })
        const value = readAccountSettingsVisibility(response.visibility)
        if (value && !controller.signal.aborted && revision === startedAt) apply(value)
      } catch { /* Keep the last confirmed flags; unknown entries stay hidden. */ }
      finally { if (pending === controller) pending = null }
    }
    refreshRef.current = () => { void refresh() }
    const unsubscribe = subscribeAccountSettingsVisibility(value => {
      revision += 1
      pending?.abort(); pending = null
      apply(value)
    })
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    void refresh()
    return () => {
      disposed = true; pending?.abort(); unsubscribe(); refreshRef.current = () => {}
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [accountId, connected])
  useEffect(() => { if (active) refreshRef.current() }, [active, accountId, connected])
  return connected && snapshot?.accountId === accountId ? snapshot.value : null
}
