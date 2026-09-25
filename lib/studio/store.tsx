'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import { assets, adminChannels, adminModels, adminUsers, models as demoModels, orders, projects, shots, tasks as demoTasks, works, demoUser, media } from './mock-data'
import { createDemoTask, demoResultForTask, estimateCredits as estimateDemoCredits } from './mock-service'
import { backendUserToStudioUser, deleteCanvasProjects, isUnauthorized, listCanvasProjects, createCanvasProject } from './api'
import { clearScopedTaskCache } from './task-cache'
import { loadSessionSnapshot, sessionIdentity } from './session'
import { defaultGenerationDefaults, estimatePoints, modelsFromSession } from './studio-models'
import type { AgentPlan, GenerationSettings, ModelConfig, Project, StudioAction, StudioContextValue, StudioSkin, StudioState, Theme, User } from './types'

const storageKey = 'oaooao-studio-demo'

/**
 * 退出登录后的占位用户。
 *
 * 保持 `state.user` 恒为对象，避免几十处 `state.user.name` 读空崩溃；
 * 界面是否展示真实账户统一以 `backendStatus === 'connected'` 判断。
 * 该占位不含任何上一个账号的信息。
 */
function signedOutUser(): User {
  return { id: '', name: '', email: '', role: 'member', avatar: media.portrait, plan: '', credits: 0 }
}

/**
 * 本地演示数据只在后端不可用或未登录时作为预览使用。
 * `state.liveModels` 非空表示模型目录来自后端，页面据此区分真实生成与本地预览。
 */
function getLiveDemoTasks() {
  const now = Date.now()
  return demoTasks.map((task) => {
    const elapsed = task.status === 'processing' ? 2800 : task.status === 'queued' ? 500 : 0
    return {
      ...task,
      resultAssetIds: [...task.resultAssetIds],
      settings: { ...task.settings },
      createdAt: elapsed ? now - elapsed : task.createdAt,
      updatedAt: elapsed ? now - elapsed : task.updatedAt,
    }
  })
}

function getInitialState(): StudioState {
  return {
    hydrated: false,
    backendStatus: 'checking',
    theme: 'light',
    skin: 'gradient',
    sidebarCollapsed: true,
    user: demoUser,
    credits: demoUser.credits,
    projects: projects.map((item) => ({ ...item, tags: [...item.tags] })),
    assets: assets.map((item) => ({ ...item, tags: [...item.tags], projectIds: [...item.projectIds], referencedBy: [...item.referencedBy] })),
    models: demoModels.map((item) => ({ ...item, capabilities: { ...item.capabilities, durations: [...item.capabilities.durations], ratios: [...item.capabilities.ratios], qualities: [...item.capabilities.qualities] } })),
    liveModels: [],
    sessionSettings: undefined,
    tasks: demoTasks.map((item) => ({ ...item, resultAssetIds: [...item.resultAssetIds], settings: { ...item.settings } })),
    works: works.map((item) => ({ ...item })),
    shots: shots.map((item) => ({ ...item, referenceAssetIds: [...item.referenceAssetIds], candidates: item.candidates.map((candidate) => ({ ...candidate })) })),
    agentPlans: [],
    orders: orders.map((item) => ({ ...item })),
    adminUsers: adminUsers.map((item) => ({ ...item })),
    adminChannels: adminChannels.map((item) => ({ ...item })),
    adminModels: adminModels.map((item) => ({ ...item })),
    canvasBoards: {},
    /**
     * 默认不选中任何项目。
     *
     * 早先写死 `'aurora'`（演示项目），于是真实账号一进工作台就指向一个
     * 并不属于自己、也不存在的项目：画布请求 `/api/canvas/projects/aurora` 直接 404，
     * 「加入项目」也会写到这个名字上。真实项目列表加载后会由
     * `SET_SELECTED_PROJECT` 选中第一个属于当前用户的项目。
     */
    selectedProjectId: '',
    notifications: 2,
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
    case 'HYDRATE':
      return { ...state, ...action.payload, hydrated: true }
    case 'SET_BACKEND_STATUS':
      return { ...state, backendStatus: action.status, ...(action.error ? { backendError: action.error } : { backendError: undefined }) }
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    case 'SET_SKIN':
      return { ...state, skin: action.skin }
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
    case 'ADD_TASK':
      return { ...state, tasks: [action.task, ...state.tasks] }
    case 'RETRY_TASK':
      return {
        ...state,
        tasks: state.tasks.map((task) => task.id === action.taskId ? {
          ...task,
          status: 'queued',
          stage: '等待重试',
          error: undefined,
          retryCount: task.retryCount + 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } : task),
      }
    case 'TICK_TASKS': {
      const now = Date.now()
      let nextWorks = state.works
      const nextTasks = state.tasks.map((task) => {
        const age = now - task.createdAt
        if (task.status === 'queued' && age > 1800) {
          return { ...task, status: 'processing' as const, stage: task.type === 'export' ? '整理片段' : '生成中', updatedAt: now }
        }
        if (task.status === 'processing' && age > 5200) {
          const result = demoResultForTask(task)
          if (!nextWorks.some((work) => work.id === result.id)) nextWorks = [result, ...nextWorks]
          return { ...task, status: 'completed' as const, stage: '已完成', actualCredits: task.expectedCredits, resultAssetIds: [result.id], updatedAt: now }
        }
        return task
      })
      return { ...state, tasks: nextTasks, works: nextWorks }
    }
    case 'SPEND_CREDITS':
      return { ...state, credits: Math.max(0, state.credits - action.amount), user: { ...state.user, credits: Math.max(0, state.credits - action.amount) } }
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
  /** 会话世代：登录、退出、切换账号时自增，用于强制重新读取会话与模型目录。 */
  const [sessionEpoch, setSessionEpoch] = useState(0)

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StudioState>
        const theme = parsed.theme === 'dark' ? 'dark' : 'light'
        const skin: StudioSkin = parsed.skin === 'minimal' ? 'minimal' : 'gradient'
        dispatch({ type: 'HYDRATE', payload: { ...parsed, theme, skin } })
      } catch {
        dispatch({ type: 'HYDRATE', payload: { tasks: getLiveDemoTasks() } })
      }
    } else {
      dispatch({ type: 'HYDRATE', payload: { tasks: getLiveDemoTasks() } })
    }
  }, [])

  useEffect(() => {
    if (!state.hydrated) return
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await loadSessionSnapshot()
        if (cancelled) return
        if (!snapshot.user) {
          dispatch({ type: 'HYDRATE', payload: { user: signedOutUser(), backendStatus: 'unauthenticated', liveModels: [], sessionSettings: undefined } })
          return
        }
        const user = backendUserToStudioUser(snapshot.user, media.portrait)
        dispatch({
          type: 'HYDRATE',
          payload: {
            user,
            credits: user.credits,
            sessionSettings: snapshot.settings,
            liveModels: snapshot.models,
            ...(snapshot.models.length ? { models: snapshot.models } : {}),
          },
        })
        dispatch({ type: 'SET_BACKEND_STATUS', status: 'connected' })
        void listCanvasProjects()
          .then((result) => {
            if (cancelled) return
            dispatch({ type: 'HYDRATE', payload: { projects: result.projects.map(projectFromCanvasSummary) } })
          })
          .catch(() => {
            // 画布列表不是登录成功的前置条件；接口不可用时保留空状态而不是回退到演示项目。
          })
      } catch (error) {
        if (cancelled) return
        dispatch({
          type: 'SET_BACKEND_STATUS',
          status: isUnauthorized(error) ? 'unauthenticated' : 'offline',
          error: error instanceof Error ? error.message : '后端连接失败',
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.hydrated, sessionEpoch])

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
   * 只在**已连接后端**时校准：未连接时 `state.projects` 是演示数据，
   * 用它校准会把用户带到演示项目上。
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
    const payload = {
      theme: state.theme,
      skin: state.skin,
      sidebarCollapsed: state.sidebarCollapsed,
      credits: state.credits,
      projects: state.projects,
      assets: state.assets,
      tasks: state.tasks,
      works: state.works,
      shots: state.shots,
      agentPlans: state.agentPlans,
      canvasBoards: state.canvasBoards,
      selectedProjectId: state.selectedProjectId,
    }
    window.localStorage.setItem(storageKey, JSON.stringify(payload))
  }, [state])

  useEffect(() => {
    const timer = window.setInterval(() => dispatch({ type: 'TICK_TASKS' }), 1800)
    return () => window.clearInterval(timer)
  }, [])

  const setTheme = useCallback((theme: Theme) => dispatch({ type: 'SET_THEME', theme }), [])
  const setSkin = useCallback((skin: StudioSkin) => dispatch({ type: 'SET_SKIN', skin }), [])
  const toggleTheme = useCallback(() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' }), [state.theme])
  const toggleSidebar = useCallback(() => dispatch({ type: 'TOGGLE_SIDEBAR' }), [])
  /** 有真实模型目录时用后端定价估算，否则退回演示估算并明确标注为本地预览。 */
  const liveModelList = state.liveModels.length ? state.liveModels : []
  const estimateCredits = useCallback((modelId: string, settings: Partial<GenerationSettings> = {}) => {
    if (liveModelList.length) {
      const seconds = settings.duration ? Number.parseInt(settings.duration, 10) : undefined
      return estimatePoints(modelId, state.sessionSettings, liveModelList, {
        count: settings.count,
        quality: settings.quality,
        seconds: Number.isFinite(seconds) ? seconds : undefined,
      })
    }
    return estimateDemoCredits(modelId, settings, state.models)
  }, [liveModelList, state.models, state.sessionSettings])
  const addDemoTask = useCallback((input: Parameters<typeof createDemoTask>[0]) => {
    if (state.credits < input.expectedCredits) return null
    const task = createDemoTask(input)
    dispatch({ type: 'SPEND_CREDITS', amount: input.expectedCredits })
    dispatch({ type: 'ADD_TASK', task })
    return task.id
  }, [state.credits])

  /**
   * 立即重新读取会话并同步用户、模型目录、积分与项目。
   * 登录成功、退出、切换账号后调用它，客户端导航不再需要整页刷新。
   * 切换账号时清空上一个账号的业务数据，避免内容残留。
   */
  const refreshSession = useCallback(async () => {
    const previousIdentity = sessionIdentity(state.user)
    setSessionEpoch((value) => value + 1)
    try {
      const snapshot = await loadSessionSnapshot()
      if (!snapshot.user) {
        // 退出登录：清掉上一个账号的任务缓存，避免下一个登录者看到其提示词与未确认提交。
        clearScopedTaskCache(previousIdentity || state.user.id)
        dispatch({ type: 'HYDRATE', payload: { user: signedOutUser(), credits: 0, liveModels: [], sessionSettings: undefined, projects: [], assets: [], tasks: [], works: [], agentPlans: [] } })
        dispatch({ type: 'SET_BACKEND_STATUS', status: 'unauthenticated' })
        return
      }
      const user = backendUserToStudioUser(snapshot.user, media.portrait)
      const nextIdentity = sessionIdentity(snapshot.user)
      const switched = Boolean(previousIdentity) && previousIdentity !== nextIdentity
      // 切换账号时先清空，防止上一个账号的项目、任务和作品短暂显示给新账号。
      if (switched) clearScopedTaskCache(previousIdentity)
      dispatch({
        type: 'HYDRATE',
        payload: {
          user,
          credits: user.credits,
          sessionSettings: snapshot.settings,
          liveModels: snapshot.models,
          ...(snapshot.models.length ? { models: snapshot.models } : {}),
          ...(switched ? { projects: [], assets: [], tasks: [], works: [], agentPlans: [] } : {}),
        },
      })
      dispatch({ type: 'SET_BACKEND_STATUS', status: 'connected' })
    } catch (error) {
      dispatch({
        type: 'SET_BACKEND_STATUS',
        status: isUnauthorized(error) ? 'unauthenticated' : 'offline',
        error: error instanceof Error ? error.message : '会话刷新失败',
      })
    }
  }, [state.user])

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
      // 未登录时保留本地预览能力，但明确标记为本地项目，不做持久化承诺。
      const local = createProjectFromTitle(trimmed)
      dispatch({ type: 'CREATE_PROJECT', project: local })
      return local
    }
    const created = await createCanvasProject({ title: trimmed })
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
      dispatch({ type: 'DELETE_PROJECT', projectId })
      return
    }
    await deleteCanvasProjects([projectId])
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

export function createProjectFromTitle(title: string): Project {
  return {
    id: `project-${Date.now()}`,
    title,
    type: '个人作品',
    cover: media.studio,
    updatedAt: '刚刚',
    status: '进行中',
    progress: 0,
    tags: ['新项目'],
    shotCount: 0,
    chapterCount: 1,
    description: '由演示工作区创建的新项目。',
    favorite: false,
  }
}
