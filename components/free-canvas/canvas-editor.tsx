'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ReactFlowProvider, useReactFlow, type Viewport, type XYPosition } from '@xyflow/react'
import type { LibraryAssetView } from '@/lib/studio/account-api'
import type { CanvasBackendProject } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { defaultGenerationDefaults } from '@/lib/studio/studio-models'
import { categoryOf, referenceOf } from './asset-reference'
import { readBoard, writeBoard } from './board-codec'
import { CanvasActionsProvider, type CanvasActions } from './canvas-context'
import { CanvasAssetLibrary } from './canvas-asset-library'
import { CanvasSkillDialog } from './canvas-skill-dialog'
import { CanvasNoticeToast, CanvasSelectionBar, CanvasTopBar, CanvasZoomDock, EmptyCanvasGuide } from './canvas-chrome'
import { CanvasFlow } from './canvas-flow'
import { CanvasContextMenu } from './canvas-menu'
import { flushCanvasSave, flushCanvasSaveOnHide, startCanvasAutosave, stopCanvasSaveTimer } from './canvas-persistence'
import { useCanvasStore } from './canvas-store'
import { createMediaNode, createNodeOfKind, type CreatableKind } from './node-factory'
import type { NodeSide } from './types'
import { useAgentActions } from './use-agent-actions'
import { useGenerationActions } from './use-generation-actions'
import { useWorkHandoff } from './use-work-handoff'

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }
const MAX_REFERENCES = 4
const PROJECT_FIELDS_OWNED_BY_BOARD = ['nodes', 'connections', 'viewport', 'title', 'updatedAt']

export function CanvasEditor({ projectId, project, loadError }: { projectId: string; project: CanvasBackendProject | null; loadError: string | null }) {
  const hydrated = useCanvasStore((state) => state.hydrated && state.projectId === projectId)
  const hydrate = useCanvasStore((state) => state.hydrate)
  const reset = useCanvasStore((state) => state.reset)

  useEffect(() => {
    if (!project || hydrated) return
    const board = readBoard(project)
    hydrate({
      projectId,
      title: project.title,
      updatedAt: project.updatedAt,
      projectMeta: projectMetaOf(project),
      nodes: board.nodes,
      edges: board.edges,
      viewport: board.viewport ?? DEFAULT_VIEWPORT,
    })
  }, [hydrate, hydrated, project, projectId])

  useEffect(() => {
    const stopAutosave = startCanvasAutosave()
    const saveOnHide = () => flushCanvasSaveOnHide()
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') saveOnHide()
    }
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      const current = useCanvasStore.getState()
      if (current.hydrated && current.revision !== current.savedRevision) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('pagehide', saveOnHide)
    window.addEventListener('beforeunload', warnUnsaved)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stopAutosave()
      window.removeEventListener('pagehide', saveOnHide)
      window.removeEventListener('beforeunload', warnUnsaved)
      document.removeEventListener('visibilitychange', handleVisibility)
      void flushCanvasSave().catch(() => undefined)
      stopCanvasSaveTimer()
      reset()
    }
  }, [reset])

  if (!project) {
    return <CanvasStatusScreen title="无法打开这个画布" description={loadError ?? '画布可能已被删除，或当前账号没有访问权限。'} />
  }
  if (!hydrated) {
    return <CanvasStatusScreen title="正在打开画布" description="正在读取节点、连线与视口。" />
  }
  return (
    <ReactFlowProvider>
      <CanvasWorkspace />
    </ReactFlowProvider>
  )
}

function CanvasWorkspace() {
  const { state } = useStudio()
  const defaults = useMemo(() => defaultGenerationDefaults(state.sessionSettings), [state.sessionSettings])
  const generation = useGenerationActions()
  const agent = useAgentActions()
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [initialViewport] = useState<Viewport>(() => useCanvasStore.getState().viewport)
  const [skillNodeId, setSkillNodeId] = useState<string | null>(null)
  const nodeCount = useCanvasStore((store) => store.nodes.length)
  const assetPanelOpen = useCanvasStore((store) => store.assetPanelOpen)
  const assetTargetNodeId = useCanvasStore((store) => store.assetTargetNodeId)
  const setAssetPanel = useCanvasStore((store) => store.setAssetPanel)

  const viewportCenter = useCallback(
    (): XYPosition => screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [screenToFlowPosition],
  )
  useWorkHandoff(viewportCenter)

  const createNodeAt = useCallback((kind: CreatableKind, position: XYPosition) => {
    const store = useCanvasStore.getState()
    const node = createNodeOfKind(kind, position, defaults)
    const isGeneration = kind === 'image' || kind === 'video' || kind === 'text' || kind === 'audio'
    store.insertNodes([node], [], { select: true, focus: isGeneration })
    if (kind === 'reference' || kind === 'asset') store.setAssetPanel(true, node.id)
  }, [defaults])

  const createNodeNear = useCallback((sourceId: string, side: NodeSide, kind: CreatableKind) => {
    const store = useCanvasStore.getState()
    const id = store.insertNodeNear(sourceId, side, createNodeOfKind(kind, { x: 0, y: 0 }, defaults))
    if (id && (kind === 'reference' || kind === 'asset')) store.setAssetPanel(true, id)
  }, [defaults])

  const focusAgent = useCallback(() => {
    const store = useCanvasStore.getState()
    const existing = store.nodes.find((node) => node.type === 'agent')
    if (existing) {
      store.selectNodeOnly(existing.id)
      void fitView({ nodes: [{ id: existing.id }], padding: 0.6, duration: 240, maxZoom: 1 })
      return
    }
    createNodeAt('agent', viewportCenter())
  }, [createNodeAt, fitView, viewportCenter])

  const exportCanvas = useCallback(() => {
    const store = useCanvasStore.getState()
    const board = writeBoard(store.nodes, store.edges)
    const payload = { title: store.title, exportedAt: new Date().toISOString(), nodes: board.nodes, connections: board.connections }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${store.title.trim() || '未命名画布'}.json`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    store.setNotice('画布已导出')
  }, [])

  const handleAssetPick = useCallback((asset: LibraryAssetView) => {
    const store = useCanvasStore.getState()
    const target = store.assetTargetNodeId ? store.nodes.find((node) => node.id === store.assetTargetNodeId) : undefined

    if (asset.kind === 'text') return store.setNotice('请通过节点上的“选择技能”添加创作指令')

    const reference = referenceOf(asset)
    if (!reference) return store.setNotice('这个素材没有可用的地址')

    if (target?.type === 'generation') {
      if (target.data.kind !== 'image' && target.data.kind !== 'video') return store.setNotice('这个节点类型不使用参考素材')
      if (target.data.references.some((item) => item.id === reference.id)) return
      if (target.data.references.length >= MAX_REFERENCES) return store.setNotice(`最多添加 ${MAX_REFERENCES} 个参考素材`)
      store.updateNodeData(target.id, { references: [...target.data.references, reference] }, { history: true })
      return
    }

    if (target?.type === 'media') {
      store.updateNodeData(target.id, { media: reference, title: reference.title }, { history: true })
      store.setAssetPanel(false)
      return
    }

    const kind = categoryOf(asset) === 'general' ? 'reference' : 'asset'
    store.insertNodes([createMediaNode(kind, viewportCenter(), reference)], [], { select: true })
  }, [viewportCenter])

  const actions = useMemo<CanvasActions>(() => ({
    ...generation,
    ...agent,
    createNodeNear,
    createNodeAt,
    focusAgent,
    exportCanvas,
    selectSkills: setSkillNodeId,
  }), [generation, agent, createNodeNear, createNodeAt, focusAgent, exportCanvas])

  return (
    <CanvasActionsProvider value={actions}>
      <main className="relative h-full min-h-0 w-full overflow-hidden bg-black text-white">
        <CanvasFlow initialViewport={initialViewport} />
        <CanvasTopBar onExport={exportCanvas} onFocusAgent={focusAgent} />
        {nodeCount === 0 ? <EmptyCanvasGuide onCreate={(kind) => createNodeAt(kind, viewportCenter())} /> : null}
        <CanvasZoomDock />
        <CanvasSelectionBar />
        <CanvasContextMenu />
        {skillNodeId ? <CanvasSkillDialog nodeId={skillNodeId} onClose={() => setSkillNodeId(null)} /> : null}
        {assetPanelOpen ? (
          <div className="pointer-events-auto absolute top-16 right-3 z-50 w-[min(360px,calc(100%-1.5rem))]">
            <CanvasAssetLibrary targetNodeId={assetTargetNodeId} onPick={handleAssetPick} onClose={() => setAssetPanel(false)} />
          </div>
        ) : null}
        <CanvasNoticeToast />
      </main>
    </CanvasActionsProvider>
  )
}

function projectMetaOf(project: CanvasBackendProject): Record<string, unknown> {
  return Object.fromEntries(Object.entries(project).filter(([key]) => !PROJECT_FIELDS_OWNED_BY_BOARD.includes(key)))
}

function CanvasStatusScreen({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-black px-6 text-center text-white">
      <h1 className="text-base font-medium">{title}</h1>
      <p className="max-w-sm text-sm leading-relaxed text-neutral-500">{description}</p>
      <Link href="/canvas" className="mt-4 flex h-9 items-center rounded-xl border border-white/20 px-4 text-sm text-white hover:bg-white/10">
        返回画布列表
      </Link>
    </main>
  )
}
