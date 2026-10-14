'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from './api'
import type { CheckInStatus } from './check-in-rules'

export type { CheckInStatus } from './check-in-rules'
type Snapshot = { epoch: number; status?: CheckInStatus; loading: boolean; claiming: boolean; error: string }

/** The server owns the reward and day boundary; a response never crosses accounts. */
export function useCheckIn({ accountId, connected, active, refreshSession }: { accountId: string; connected: boolean; active: boolean; refreshSession: () => Promise<{ status: string }> }) {
  const scope = useRef({ accountId, connected, epoch: 0 })
  if (scope.current.accountId !== accountId || scope.current.connected !== connected) scope.current = { accountId, connected, epoch: scope.current.epoch + 1 }
  const epoch = scope.current.epoch
  const mounted = useRef(true)
  const reading = useRef(0)
  const claimLock = useRef<number | null>(null)
  const confirmed = useRef<{ epoch: number; date: string } | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>({ epoch, loading: false, claiming: false, error: '' })
  const current = useCallback(() => mounted.current && scope.current.epoch === epoch && scope.current.connected, [epoch])
  const visible = snapshot.epoch === epoch ? snapshot : { epoch, loading: false, claiming: false, error: '', status: undefined }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reading.current++ } }, [])

  const refresh = useCallback(async () => {
    if (!current() || claimLock.current === epoch) return
    const revision = ++reading.current
    setSnapshot(previous => ({ epoch, status: previous.epoch === epoch ? previous.status : undefined, loading: true, claiming: false, error: '' }))
    try {
      const status = await request<CheckInStatus>('/api/account/check-in')
      if (current() && reading.current === revision) setSnapshot({ epoch, status, loading: false, claiming: false, error: '' })
    } catch (reason) {
      if (current() && reading.current === revision) setSnapshot({ epoch, loading: false, claiming: false, error: reason instanceof Error ? reason.message : '签到状态读取失败，请重试。' })
    }
  }, [current, epoch])

  useEffect(() => {
    if (!active || !connected) return
    void refresh()
    const timer = setInterval(() => { void refresh() }, 60_000)
    return () => clearInterval(timer)
  }, [active, connected, refresh])

  async function claim() {
    if (!current() || !accountId || claimLock.current === epoch || visible.loading || !visible.status?.enabled || visible.status.claimed || (confirmed.current?.epoch === epoch && confirmed.current.date === visible.status.date)) return
    claimLock.current = epoch
    const revision = ++reading.current
    setSnapshot({ epoch, status: visible.status, loading: false, claiming: true, error: '' })
    let status: CheckInStatus | undefined
    let error = ''
    try {
      status = await request<CheckInStatus & { balance: number }>('/api/account/check-in', { method: 'POST', body: JSON.stringify({}) })
    } catch (reason) {
      if (!current()) return
      // A lost POST reply is resolved with a read; do not automatically submit another claim.
      try { status = await request<CheckInStatus>('/api/account/check-in') } catch {}
      if (!status?.claimed) error = reason instanceof Error ? reason.message : '领取结果暂未确认，请刷新签到状态。'
    } finally {
      if (claimLock.current === epoch) claimLock.current = null
    }
    if (!current()) return
    if (status?.claimed) confirmed.current = { epoch, date: status.date }
    setSnapshot({ epoch, status, loading: false, claiming: false, error })
    if (status?.claimed) {
      const session = await refreshSession().catch(() => ({ status: 'offline' }))
      if (current() && reading.current === revision && session.status !== 'connected') setSnapshot({ epoch, status, loading: false, claiming: false, error: '已签到，积分余额暂未同步，请稍后刷新账户。' })
    }
  }

  return { ...visible, refresh, claim }
}
