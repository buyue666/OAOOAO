'use client'

import useSWR, { useSWRConfig } from 'swr'
import { useCallback, useRef, useState } from 'react'
import { request } from './api'
import { useStudio } from './store'

export function teamIdFromPath(path: string) {
  return /^\/teams\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/i.exec(path)?.[1] ?? null
}

export function useTeamQuery<T>(path: string | null, refreshInterval = 0) {
  const { state } = useStudio()
  const connected = state.backendStatus === 'connected' && !!state.user.id
  const result = useSWR<T>(connected && path ? ['team', state.user.id, path] : null, ([, , url]: [string, string, string]) => request<T>(url), {
    keepPreviousData: false,
    shouldRetryOnError: false,
    refreshInterval,
    revalidateOnFocus: true,
  })
  return { ...result, data: connected && path && !result.error ? result.data : undefined, connected }
}

export function useTeamAction() {
  const { state } = useStudio()
  const { mutate } = useSWRConfig()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const account = useRef(state.user.id)
  account.current = state.user.id
  const run = useCallback(async <T,>(path: string, body?: unknown, method = 'POST', headers?: HeadersInit): Promise<T | undefined> => {
    if (busy.current) return
    setError('')
    if (state.backendStatus !== 'connected' || !state.user.id) { setError('请先登录并连接后端服务。'); return }
    busy.current = true
    setPending(true)
    try {
      const result = await request<T>(path, { method, headers, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
      if (account.current !== state.user.id) return
      await mutate(key => Array.isArray(key) && key[0] === 'team' && key[1] === state.user.id).catch(() => undefined)
      return result
    } catch (reason) { if (account.current === state.user.id) setError(reason instanceof Error ? reason.message : '操作未完成，请刷新后确认状态。'); return undefined }
    finally { busy.current = false; setPending(false) }
  }, [mutate, state.backendStatus, state.user.id])
  return { run, pending, error, clearError: () => setError('') }
}
