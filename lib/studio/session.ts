'use client'

/**
 * 统一的会话生命周期管理。
 *
 * 背景：早先只有 store.tsx 里一个只依赖 `state.hydrated` 的 effect。
 * 登录页通过客户端导航跳到 /image 时组件不会重新挂载，effect 不再执行，
 * 于是登录后仍然显示演示模型与「本地预览」，必须整页刷新才正常。
 *
 * 这里把「刷新用户 / 模型目录 / 积分 / 账户数据」收敛成一个函数，
 * 并由明确的会话事件触发：首次挂载、登录成功、退出、切换账号、会话失效。
 * 账号切换时会先清空上一个账号的本地缓存，避免内容残留。
 */
import { getSession, type BackendUser, type SessionSettings } from './api'
import { modelsFromSession, defaultGenerationDefaults } from './studio-models'
import type { SessionGenerationDefaults, ModelConfig } from './types'

export type SessionSnapshot = {
  user: BackendUser | null
  settings: SessionSettings | undefined
  models: ModelConfig[]
  defaults: SessionGenerationDefaults
  credits: number
  /** 会话读取本身是否失败（网络/服务不可用），与「未登录」区分开。 */
  failed: boolean
  error?: string
}

export async function loadSessionSnapshot(): Promise<SessionSnapshot> {
  const session = await getSession()
  const settings = session.settings as SessionSettings | undefined
  const models = session.user ? modelsFromSession(settings) : []
  return {
    user: session.user,
    settings,
    models,
    defaults: defaultGenerationDefaults(settings),
    credits: session.user ? Math.max(0, Number(session.user.pointsBalance ?? session.user.permanentPointsBalance ?? 0) || 0) : 0,
    failed: false,
  }
}

/** 会话读取失败时的快照：明确标记失败，不伪装成已登录或未登录。 */
export function failedSnapshot(error: unknown): SessionSnapshot {
  return {
    user: null,
    settings: undefined,
    models: [],
    defaults: defaultGenerationDefaults(undefined),
    credits: 0,
    failed: true,
    error: error instanceof Error ? error.message : '会话读取失败',
  }
}

/**
 * 账号身份标识。用于判断「是否切换了账号」。
 * 未登录返回空串，切换账号返回不同的 id。
 */
export function sessionIdentity(user: BackendUser | null | undefined) {
  return user?.id ? String(user.id) : ''
}

/** 本地缓存键按账号隔离，切换账号不会读到上一个账号的任务与 Agent 记录。 */
export function accountScopedKey(base: string, userId: string | null | undefined) {
  const identity = sessionIdentity(userId ? ({ id: userId } as BackendUser) : null)
  return identity ? `${base}:${identity}` : `${base}:anonymous`
}

/** 清除某个账号之外的旧缓存键，避免本地存储无限增长。 */
export function pruneScopedKeys(base: string, keepKey: string) {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && key.startsWith(`${base}:`) && key !== keepKey) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // 存储不可用时忽略，后端仍是事实来源。
  }
}
