'use client'

import { useEffect, useRef, useState } from 'react'
import { consumeWechatLoginSession, createWechatLoginSession, getWechatLoginStatus, type WechatLoginSession } from './api'
import { createWechatLoginFlow, type WechatLoginView } from './wechat-login-flow'

const emptyView: WechatLoginView = { session: null, status: 'pending', loading: false, error: '', retryable: false }

export function useWechatLogin(input: { active: boolean; scopeKey?: string; expectedUserId?: string; createSession?: (returnTo: string, policyAccepted: boolean) => Promise<WechatLoginSession>; refreshSession: () => Promise<{ status: string }>; navigate: (path: string) => void }) {
  const latest = useRef(input); latest.current = input
  const mounted = useRef(true)
  const [snapshot, setSnapshot] = useState({ scopeKey: input.scopeKey, view: emptyView })
  const flow = useRef<ReturnType<typeof createWechatLoginFlow> | null>(null)
  const scope = useRef(input.scopeKey)
  if (!flow.current) flow.current = createWechatLoginFlow({
    active: () => mounted.current && latest.current.active && scope.current === latest.current.scopeKey,
    create: (path, accepted) => (latest.current.createSession ?? createWechatLoginSession)(path, accepted), read: getWechatLoginStatus,
    consume: async id => {
      const result = await consumeWechatLoginSession(id)
      if (latest.current.expectedUserId && result.user.id !== latest.current.expectedUserId) throw new Error('当前账户已改变，请重新打开微信绑定。')
      return result
    },
    refresh: () => latest.current.refreshSession(), navigate: path => latest.current.navigate(path),
    changed: next => { if (mounted.current) setSnapshot({ scopeKey: latest.current.scopeKey, view: next }) },
  })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; flow.current?.cancel() } }, [])
  useEffect(() => { flow.current?.close() }, [input.active, input.scopeKey])
  const view = snapshot.scopeKey === input.scopeKey ? snapshot.view : emptyView
  const begin = (path: string, accepted = false) => {
    if (scope.current !== latest.current.scopeKey) { flow.current!.cancel(); scope.current = latest.current.scopeKey }
    return flow.current!.begin(path, accepted)
  }
  return { ...view, begin, close: flow.current.close, retry: flow.current.retry }
}
