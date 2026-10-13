'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { backendUserToStudioUser, deleteCanvasProjects, isUnauthorized, listCanvasProjects, createCanvasProject, getSession } from './api'
import { clearScopedTaskCache } from './task-cache'
import { loadSessionSnapshot, sessionIdentity } from './session'
import { defaultGenerationDefaults, estimatePoints } from './studio-models'
import { createSiteBrandSync, subscribeSiteBrandRefresh, subscribeSiteBrandUpdates } from './site-brand-sync'
import type { GenerationSettings, Project, StudioAction, StudioContextValue, StudioSkin, StudioState, Theme, User } from './types'

const storageKey = 'oaooao-studio-preferences-v1'
const legacyStorageKey = 'oaooao-studio-demo'
const fallbackAvatar = '/icon.svg'

/**
 * 退出登录后的占位用户。
 *
 * 保持 `state.user` 恒为对象，避免几十处 `state.user.name` 读空崩溃；
 * 界面是否展示真实账户统一以 `backendStatus === 'connected'` 判断。
 * 该占位不含任何上一个账号的信息。
 */
function signedOutUser(): User {
  return { id: '', name: '', email: '', role: 'member', avatar: fallbackAvatar, plan: '', credits: 0 }
}

export function emptyAccountState(): Pick<StudioState, 'user' | 'credits' | 'projects' | 'assets' | 'models' | 'liveModels' | 'tasks' | 'works' | 'shots' | 'agentPlans' | 'orders' | 'adminUsers' | 'adminChannels' | 'adminModels' | 'canvasBoards' | 'selectedProjectId' | 'notifications'> {
  return { user: signedOutUser(), credits: 0, projects: [], assets: [], models: [], liveModels: [], tasks: [], works: [], shots: [], agentPlans: [], orders: [], adminUsers: [], adminChannels: [], adminModels: [], canvasBoards: {}, selectedProjectId: '', notifications: 0 }
}

/** Only harmless UI preferences may cross sessions; historical caches are untrusted. */
export function readStudioPreferences(raw: string | null): Pick<StudioState, 'theme' | 'skin' | 'sidebarCollapsed'> {
  let value: Record<string, unknown> = {}
  try { const parsed = raw ? JSON.parse(raw) : {}; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed } catch { /* Invalid storage must not prevent session loading. */ }
  return { theme: value.theme === 'dark' ? 'dark' : 'light', skin: 'minimal', sidebarCollapsed: value.sidebarCollapsed === true }
}

function getInitialState(): StudioState {
  return {
    hydrated: false,
    backendStatus: 'checking',
    theme: 'light',
    skin: 'minimal',
    sidebarCollapsed: false,
    ...emptyAccountState(),
    sessionSettings: undefined,
    /**
     * 默认不选中任何项目。
     *
     * 早先写死 `'aurora'`（演示项目），于是真实账号一进工作台就指向一个
     * 并不属于自己、也不存在的项目：画布请求 `/api/canvas/projects/aurora` 直接 404，
     * 「加入项目」也会写到这个名字上。真实项目列表加载后会由
     * `SET_SELECTED_PROJECT` 选中第一个属于当前用户的项目。
     */
    selectedProjectId: '',
  }
}

function projectFromCanvasSummary(summary: { id: string; title: string; updatedAt: string; nodeCount: number; cover?: { kind: string; url: string } }): Project {
  return {
    id: summary.id,
    title: summary.title,
    type: '个人作品',
    // 封面用画布上第一个真实生成结果，没有就留空而不是编造演示图。
    cover: summary.cover?.url ?? '',
    updatedAt: summary.updatedAt,
    status: '进行中',
    progress: 0,
    tags: [],
    shotCount: summary.nodeCount,
    chapterCount: 0,
    description: '',
    favorite: false,
  }
}

function reducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'HYDRATE': {
      const changedAccount = action.payload.user !== undefined && state.user.id !== action.payload.user.id
      return { ...state, ...(changedAccount ? emptyAccountState() : {}), ...action.payload, hydrated: true }
    }
    case 'SET_SITE_BRAND':
      return { ...state, sessionSettings: { ...state.sessionSettings, site: { ...state.sessionSettings?.site, ...action.site } } }
    case 'SET_BACKEND_STATUS':
      return { ...state, backendStatus: action.status, ...(action.error ? { backendError: action.error } : { backendError: undefined }) }
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    case 'SET_SKIN':
      // 旧版本仍可能从缓存或外部调用发来 SET_SKIN，但当前产品只保留液态玻璃。
      return { ...state, skin: 'minimal' }
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed }
    case 'SET_SELECTED_PROJECT':
      return { ...state, selectedProjectId: action.projectId }
    case 'CREATE_PROJECT':
      return { ...state, projects: [action.project, ...state.projects], selectedProjectId: action.project.id }
    case 'DELETE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter((project) => project.id !== action.projectId),
        selectedProjectId: state.selectedProjectId === action.projectId ? (state.projects.find((project) => project.id !== action.projectId)?.id ?? '') : state.selectedProjectId,
      }
    case 'ARCHIVE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((project) => project.id === action.projectId ? { ...project, status: '已归档' } : project),
      }
    // Legacy dispatch names remain inert for compatibility. Only API responses
    // may create tasks, settle results, or change an account balance.
    case 'ADD_TASK':
    case 'RETRY_TASK':
    case 'TICK_TASKS':
    case 'SPEND_CREDITS':
      return state
    case 'ADD_ASSET_TO_PROJECT':
      return {
        ...state,
        assets: state.assets.map((asset) => asset.id === action.assetId && !asset.projectIds.includes(action.projectId)
          ? { ...asset, projectIds: [...asset.projectIds, action.projectId] }
          : asset),
      }
    case 'ADD_WORK_TO_PROJECT': {
      // 同一份结果重复加入同一个项目时只保留一条，避免素材列表出现重复项。
      const exists = state.assets.some((asset) => asset.id === action.work.id)
      const assets = exists
        ? state.assets.map((asset) => asset.id === action.work.id && !asset.projectIds.includes(action.projectId)
          ? { ...asset, projectIds: [...asset.projectIds, action.projectId] }
          : asset)
        : [{ ...action.work, projectIds: [...new Set([...action.work.projectIds, action.projectId])] }, ...state.assets]
      return {
        ...state,
        assets,
        projects: state.projects.map((project) => project.id === action.projectId ? { ...project, updatedAt: '刚刚' } : project),
      }
    }
    case 'DELETE_ASSET':
      return { ...state, assets: state.assets.filter((asset) => asset.id !== action.assetId) }
    case 'SELECT_SHOT_CANDIDATE':
      return {
        ...state,
        shots: state.shots.map((shot) => shot.id === action.shotId ? {
          ...shot,
          status: '已完成',
          candidates: shot.candidates.map((candidate) => ({ ...candidate, selected: candidate.id === action.candidateId })),
        } : shot),
      }
    case 'UPDATE_SHOT_STATUS':
      return { ...state, shots: state.shots.map((shot) => shot.id === action.shotId ? { ...shot, status: action.status } : shot) }
    case 'ADD_SHOT':
      return {
        ...state,
        shots: [...state.shots, action.shot],
        projects: state.projects.map((project) => project.id === action.shot.projectId
          ? { ...project, shotCount: project.shotCount + 1, updatedAt: '刚刚' }
          : project),
      }
    case 'ADD_AGENT_PLAN':
      return { ...state, agentPlans: [action.plan, ...state.agentPlans] }
    case 'UPDATE_AGENT_PLAN':
      return {
        ...state,
        agentPlans: state.agentPlans.map((plan) => plan.id === action.planId ? { ...plan, status: action.status, steps: action.steps ?? plan.steps } : plan),
      }
    case 'SAVE_CANVAS_BOARD':
      return {
        ...state,
        canvasBoards: { ...state.canvasBoards, [action.projectId]: action.board },
      }
    default:
      return state
  }
}

const StudioContext = createContext<StudioContextValue | null>(null)

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState)
  const [brandSync] = useState(createSiteBrandSync)
  const sessionTicket = useRef(0)
  const sessionIdentityRef = useRef('')

  const refreshSession = useCallback<StudioContextValue['refreshSession']>(async () => {
    const ticket = ++sessionTicket.current
    const brandRevision = brandSync.getRevision()
    const current = () => ticket === sessionTicket.current
    try {
      const snapshot = await loadSessionSnapshot()
      if (!current()) return { status: 'superseded' }
      const settings = brandSync.merge(snapshot.settings, brandRevision)
      const previousIdentity = sessionIdentityRef.current
      const nextIdentity = sessionIdentity(snapshot.user)
      if (previousIdentity && previousIdentity !== nextIdentity) clearScopedTaskCache(previousIdentity)
      sessionIdentityRef.current = nextIdentity
      if (!snapshot.user) {
        dispatch({ type: 'HYDRATE', payload: { ...emptyAccountState(), sessionSettings: settings, backendStatus: 'unauthenticated', backendError: undefined } })
        return { status: 'unauthenticated' }
      }
      const user = backendUserToStudioUser(snapshot.user, fallbackAvatar)
      dispatch({ type: 'HYDRATE', payload: {
        ...(previousIdentity !== nextIdentity ? emptyAccountState() : {}),
        user, credits: user.credits, sessionSettings: settings,
        models: snapshot.models, liveModels: snapshot.models,
        backendStatus: 'connected', backendError: undefined,
      } })
      // The same request token guards the dependent project query as well.
      // An old account's delayed list can never populate the next account.
      void listCanvasProjects().then((result) => {
        if (current()) dispatch({ type: 'HYDRATE', payload: { projects: result.projects.map(projectFromCanvasSummary) } })
      }).catch(() => { /* Keep genuine cached rows for this account; never synthesize projects. */ })
      return { status: 'connected' }
    } catch (error) {
      if (!current()) return { status: 'superseded' }
      if (isUnauthorized(error)) {
        if (sessionIdentityRef.current) clearScopedTaskCache(sessionIdentityRef.current)
        sessionIdentityRef.current = ''
        dispatch({ type: 'HYDRATE', payload: emptyAccountState() })
      }
      const status = isUnauthorized(error) ? 'unauthenticated' : 'offline'
      const message = error instanceof Error ? error.message : '会话读取失败'
      dispatch({ type: 'SET_BACKEND_STATUS', status, error: message })
      return { status, error: message }
    }
  }, [brandSync])

  useEffect(() => {
    const unsubscribe = brandSync.subscribe((site) => dispatch({ type: 'SET_SITE_BRAND', site }))
    const disconnect = subscribeSiteBrandUpdates((site) => brandSync.publish(site))
    const stopRefreshing = subscribeSiteBrandRefresh(brandSync, async () => (await getSession()).settings?.site)
    return () => { stopRefreshing(); disconnect(); unsubscribe() }
  }, [brandSync])

  useEffect(() => {
    let raw: string | null = null
    try { raw = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey) } catch { /* Storage may be disabled. */ }
    dispatch({ type: 'HYDRATE', payload: readStudioPreferences(raw) })
  }, [])

  useEffect(() => {
    if (!state.hydrated) return
    void refreshSession()
    return () => { sessionTicket.current += 1 }
  }, [state.hydrated, refreshSession])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark')
    document.documentElement.style.colorScheme = state.theme
  }, [state.theme])

  /**
   * 保证 `selectedProjectId` 始终指向**当前用户的真实项目**。
   *
   * 早先默认值是写死的演示项目 `'aurora'`，真实账号下它并不存在：
   * 画布请求 404、「加入项目」写到不存在的项目上。
   *
   * 只在已连接后端时校准，断线期间保留当前账户最近一次真实选择。
   */
  useEffect(() => {
    if (!state.hydrated) return
    if (state.backendStatus !== 'connected') return
    const projects = state.projects
    if (!projects.length) {
      if (state.selectedProjectId) dispatch({ type: 'SET_SELECTED_PROJECT', projectId: '' })
      return
    }
    /**
     * 校验选中项目确实存在。
     *
     * localStorage 里可能残留**旧版本写死的演示项目 ID**（例如 `aurora`），
     * 它不在服务端项目列表里；不校验会让画布与「加入项目」持续指向不存在的项目。
     */
    if (projects.some((project) => project.id === state.selectedProjectId)) return
    dispatch({ type: 'SET_SELECTED_PROJECT', projectId: projects[0].id })
  }, [state.backendStatus, state.hydrated, state.projects, state.selectedProjectId])

  useEffect(() => {
    if (!state.hydrated) return
    const payload = { version: 1, theme: state.theme, skin: 'minimal', sidebarCollapsed: state.sidebarCollapsed }
    try { window.localStorage.setItem(storageKey, JSON.stringify(payload)) } catch { /* Preferences are optional; API state is unaffected. */ }
  }, [state.hydrated, state.theme, state.sidebarCollapsed])

  const setTheme = useCallback((theme: Theme) => dispatch({ type: 'SET_THEME', theme }), [])
  const setSkin = useCallback((_skin: StudioSkin) => dispatch({ type: 'SET_SKIN', skin: 'minimal' }), [])
  const toggleTheme = useCallback(() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' }), [state.theme])
  const toggleSidebar = useCallback(() => dispatch({ type: 'TOGGLE_SIDEBAR' }), [])
  const liveModelList = state.liveModels
  const estimateCredits = useCallback((modelId: string, settings: Partial<GenerationSettings> = {}) => {
    if (!liveModelList.some((model) => model.id === modelId)) return 0
    const seconds = settings.duration ? Number.parseInt(settings.duration, 10) : undefined
    return estimatePoints(modelId, state.sessionSettings, liveModelList, {
      count: settings.count, quality: settings.quality,
      seconds: Number.isFinite(seconds) ? seconds : undefined,
    })
  }, [liveModelList, state.sessionSettings])
  // Compatibility only: the production provider never starts simulated tasks.
  const addDemoTask = useCallback<StudioContextValue['addDemoTask']>(() => null, [])

  /**
   * 新建项目。
   *
   * 早先只 `dispatch({ type: 'CREATE_PROJECT' })` 写本地状态，
   * 刷新后被服务端画布列表整体覆盖，项目等于没保存。
   * 现在先在后端创建画布项目，成功后才写入本地状态；失败时抛出后端原因。
   */
  const createProject = useCallback(async (title: string): Promise<Project> => {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('项目名称不能为空')
    if (state.backendStatus !== 'connected') {
      throw new Error('请先登录并连接服务后再创建项目。')
    }
    const identity = sessionIdentityRef.current
    const created = await createCanvasProject({ title: trimmed })
    if (identity !== sessionIdentityRef.current) throw new Error('账户已变化，请在原账户中查看新建项目。')
    const project = projectFromCanvasSummary({ id: created.id, title: created.title, updatedAt: created.updatedAt, nodeCount: created.nodes.length })
    dispatch({ type: 'CREATE_PROJECT', project })
    return project
  }, [state.backendStatus])

  /**
   * 删除项目。
   *
   * 后端的画布项目没有「归档」状态（`CanvasProject` 契约里只有 id/title/时间/节点），
   * 因此这里只提供后端真正支持的删除操作，而不是改一个本地字段假装归档。
   * 服务端删除成功后本地列表才移除，失败时抛出原因。
   */
  const deleteProject = useCallback(async (projectId: string) => {
    if (!projectId) throw new Error('项目标识为空')
    if (state.backendStatus !== 'connected') {
      throw new Error('请先登录并连接服务后再删除项目。')
    }
    const identity = sessionIdentityRef.current
    await deleteCanvasProjects([projectId])
    if (identity !== sessionIdentityRef.current) return
    dispatch({ type: 'DELETE_PROJECT', projectId })
  }, [state.backendStatus])

  const value = useMemo<StudioContextValue>(() => ({
    state,
    dispatch,
    setTheme,
    setSkin,
    toggleTheme,
    toggleSidebar,
    estimateCredits,
    addDemoTask,
    liveModels: liveModelList,
    /** 后端连接且拿到真实模型目录时才算真实可用。 */
    liveReady: state.backendStatus === 'connected' && liveModelList.length > 0,
    defaultModels: defaultGenerationDefaults(state.sessionSettings),
    refreshSession,
    createProject,
    deleteProject,
  }), [addDemoTask, createProject, deleteProject, estimateCredits, liveModelList, refreshSession, setSkin, setTheme, state, toggleSidebar, toggleTheme])

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudio() {
  const context = useContext(StudioContext)
  if (!context) throw new Error('useStudio 必须在 StudioProvider 内使用')
  return context
}

/**
 * 读取指定项目。
 *
 * 早先的实现找不到 ID 时返回 `state.projects[0]`，既会掩盖「项目不存在」，
 * 也会在列表为空时返回 undefined，导致详情页读 `.id` 崩溃。
 * 现在返回 undefined，由调用方分别处理加载中 / 空列表 / 不存在。
 */
export function getProject(state: StudioState, projectId: string) {
  if (!projectId) return undefined
  return state.projects.find((project) => project.id === projectId)
}

export function getSelectedProjectShots(state: StudioState, projectId: string) {
  return state.shots.filter((shot) => shot.projectId === projectId)
}
