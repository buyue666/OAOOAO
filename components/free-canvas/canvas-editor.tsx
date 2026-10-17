'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ReactFlowProvider, useReactFlow, type Viewport, type XYPosition } from '@xyflow/react'
import type { LibraryAssetView } from '@/lib/studio/account-api'
import { createLibraryAsset } from '@/lib/studio/account-api'
import type { CanvasBackendProject } from '@/lib/studio/api'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { defaultGenerationDefaults } from '@/lib/studio/studio-models'
import { categoryOf, referenceOf } from './asset-reference'
import { readBoard, writeBoard } from './board-codec'
import { CanvasActionsProvider, type CanvasActions } from './canvas-context'
import { CanvasAssetLibrary } from './canvas-asset-library'
import { CanvasSkillDialog } from './canvas-skill-dialog'
import { CanvasSelectionSkillDialog, type SelectionSkillSession } from './canvas-selection-skill-dialog'
import { createSelectionSkillDraft } from './canvas-selection-skill'
import { CanvasNoticeToast, CanvasSelectionBar, CanvasTopBar, CanvasZoomDock, EmptyCanvasGuide } from './canvas-chrome'
import { CanvasFlow } from './canvas-flow'
import { nodePositionAtCenter } from './canvas-position'
import { CanvasContextMenu } from './canvas-menu'
import { flushCanvasSave, flushCanvasSaveOnHide, startCanvasAutosave, stopCanvasSaveTimer } from './canvas-persistence'
import { useCanvasStore } from './canvas-store'
import { createMediaNode, createNodeOfKind, type CreatableKind } from './node-factory'
import type { ImageEditorTarget, NodeSide } from './types'
import { useAgentActions } from './use-agent-actions'
import { useGenerationActions } from './use-generation-actions'
import { useWorkHandoff } from './use-work-handoff'
import { useCanvasSelectionActions } from './use-canvas-selection-actions'
import { ImageEditorPanel, type ImageEditRequest, type ImageEditOperation, type ImageEditorVersion } from './image-editor-panel'

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
  const generationRuntime = useGeneration()
  const agent = useAgentActions()
  const selectionActions = useCanvasSelectionActions()
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [initialViewport] = useState<Viewport>(() => useCanvasStore.getState().viewport)
  const [skillNodeId, setSkillNodeId] = useState<string | null>(null)
  const [selectionSkill, setSelectionSkill] = useState<(SelectionSkillSession & { id: number }) | null>(null)
  const skillDraftSequence = useRef(0)
  const nodeCount = useCanvasStore((store) => store.nodes.length)
  const canvasNodes = useCanvasStore((store) => store.nodes)
  const imageEditor = useCanvasStore((store) => store.imageEditor)
  const closeImageEditor = useCanvasStore((store) => store.closeImageEditor)
  const assetPanelOpen = useCanvasStore((store) => store.assetPanelOpen)
  const assetTargetNodeId = useCanvasStore((store) => store.assetTargetNodeId)
  const setAssetPanel = useCanvasStore((store) => store.setAssetPanel)

  const viewportCenter = useCallback(
    (): XYPosition => screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [screenToFlowPosition],
  )
  useWorkHandoff(viewportCenter)

  const closeSelectionSkill = useCallback(() => setSelectionSkill(null), [])
  const createSkillFromSelection = useCallback((nodeIds?: readonly string[]) => {
    const store = useCanvasStore.getState()
    if (!store.hydrated || !store.projectId || !state.user.id) return store.setNotice('请先登录并打开画布，再创建技能')
    try {
      const selection = createSelectionSkillDraft(store.nodes, store.edges, nodeIds, state.models)
      store.closeOverlays()
      setSkillNodeId(null)
      setSelectionSkill({ id: ++skillDraftSequence.current, selection, projectId: store.projectId, projectMeta: store.projectMeta, accountId: state.user.id })
    } catch (cause) {
      store.setNotice(cause instanceof Error ? cause.message : '无法从这些节点创建技能，请重新选择')
    }
  }, [state.models, state.user.id])
  const saveSkillFromNode = useCallback(async (nodeId: string) => { createSkillFromSelection([nodeId]) }, [createSkillFromSelection])

  const createNodeAt = useCallback((kind: CreatableKind, position: XYPosition) => {
    const store = useCanvasStore.getState()
    const node = createNodeOfKind(kind, position, defaults)
    const isGeneration = kind === 'image' || kind === 'video' || kind === 'text' || kind === 'audio'
    store.insertNodes([node], [], { select: true, focus: isGeneration })
    if (kind === 'reference' || kind === 'asset') store.setAssetPanel(true, node.id)
  }, [defaults])

  const openDirector = useCallback((nodeId: string) => useCanvasStore.getState().setDirectorNodeId(nodeId), [])
  const openImageEditor = useCallback((target: ImageEditorTarget) => useCanvasStore.getState().openImageEditor(target), [])

  const editorVersions = useMemo<ImageEditorVersion[]>(() => {
    if (!imageEditor) return []
    const node = canvasNodes.find((item) => item.id === imageEditor.nodeId)
    if (node?.type === 'generation') {
      return node.data.results
        .filter((result) => result.mediaKind === 'image')
        .map((result, index) => ({ id: `${node.id}-${index}-${result.url}`, imageUrl: result.url, label: `版本 ${index + 1}` }))
    }
    if (node?.type === 'media' && node.data.media?.mediaKind === 'image') {
      return [{ id: `${node.id}-${node.data.media.url}`, imageUrl: node.data.media.url, label: node.data.title || '当前图片' }]
    }
    return [{ id: `current-${imageEditor.url}`, imageUrl: imageEditor.url, label: '当前图片' }]
  }, [canvasNodes, imageEditor])

  const handleImageEditSubmit = useCallback(async (request: ImageEditRequest) => {
    const store = useCanvasStore.getState()
    if (!store.projectId) throw new Error('请先保存画布，再提交图片编辑')
    const sourceNode = imageEditor ? canvasNodes.find((node) => node.id === imageEditor.nodeId) : undefined
    const sourceRatio = sourceNode?.type === 'generation' ? sourceNode.data.ratio : undefined
    const source = request.imageUrl.startsWith('data:')
      ? { type: 'image', dataUrl: request.imageUrl }
      : { type: 'image', url: request.imageUrl }
    const regionReferences = (request.regions ?? [])
      .filter((region) => Boolean(region.referenceImageDataUrl))
      .map((region) => ({ type: 'image' as const, dataUrl: region.referenceImageDataUrl, name: `区域 ${region.id} 参考图` }))
    const prompt = request.prompt.trim() || (
      request.operation === 'to-video' ? '让画面自然动起来，保持主体、镜头构图和光影一致。'
        : request.operation === 'erase' ? '移除标记区域，并自然补全背景，保持原图构图和光影。'
          : request.operation === 'remove-background' ? '移除背景，保留主体并生成干净透明背景。'
            : request.operation === 'outpaint' ? '向画布外扩展画面，保持主体、风格和光影一致。'
              : request.operation === 'enhance' ? '提升图片清晰度和细节，保持主体与构图不变。'
                : request.operation === 'layers' ? '将图片拆分为可独立编辑的主体、前景和背景图层，保持原图构图和细节。'
                  : '根据标记区域进行自然编辑，保持未标记区域不变。'
    )
    if (request.operation === 'to-video') {
      await generationRuntime.createVideo({
        prompt: prompt || '让画面自然动起来，保持主体和镜头构图。',
        references: [source],
        surface: 'canvas',
        projectId: store.projectId,
      })
      store.setNotice('已提交视频生成任务，可在任务记录查看进度')
      return
    }
    await generationRuntime.createImage({
      prompt,
      kind: 'edit',
      ...(request.ratio || sourceRatio ? { ratio: request.ratio || sourceRatio } : {}),
      references: [source, ...regionReferences],
      edit: {
        operation: request.operation as Exclude<ImageEditOperation, 'to-video'>,
        ...(request.maskDataUrl ? { mask: { type: 'image', dataUrl: request.maskDataUrl } } : {}),
      },
      surface: 'canvas',
      projectId: store.projectId,
      title: `编辑：${imageEditor?.title || '图片'}`,
    })
    store.setNotice('已提交图片编辑任务，可在任务记录查看结果')
  }, [canvasNodes, generationRuntime, imageEditor])

  const handleSaveEditorVersion = useCallback(async (imageUrl: string) => {
    const target = useCanvasStore.getState().imageEditor
    if (!target) return
    await createLibraryAsset({
      kind: 'image',
      title: `${target.title} 编辑版`.slice(0, 120),
      coverUrl: imageUrl,
      tags: ['图片编辑'],
      source: 'canvas-image-editor',
      data: { serverUrl: imageUrl, dataUrl: imageUrl, mediaKind: 'image', assetRole: 'general' },
    })
    useCanvasStore.getState().setNotice('已保存到资产库')
  }, [])

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
    createNodeAt('agent', nodePositionAtCenter('agent', viewportCenter()))
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
    openDirector,
    openImageEditor,
    focusAgent,
    exportCanvas,
    selectSkills: setSkillNodeId,
    createSkillFromSelection,
    saveSkillFromNode,
    saveSelectionResults: selectionActions.saveSelectionResults,
    draftAgentFromSelection: selectionActions.draftAgentFromSelection,
    exportSelection: selectionActions.exportSelection,
  }), [generation, agent, createNodeNear, createNodeAt, openDirector, openImageEditor, focusAgent, exportCanvas, createSkillFromSelection, saveSkillFromNode, selectionActions.saveSelectionResults, selectionActions.draftAgentFromSelection, selectionActions.exportSelection])

  return (
    <CanvasActionsProvider value={actions}>
      <main className="relative h-full min-h-0 w-full overflow-hidden bg-black text-white">
        <CanvasFlow initialViewport={initialViewport} />
        {imageEditor ? (
          <div className="pointer-events-auto absolute inset-y-0 right-0 z-[60] max-w-full shadow-2xl">
            <ImageEditorPanel
              imageSrc={imageEditor.url}
              title={imageEditor.title}
              versions={editorVersions}
              activeVersionId={editorVersions.find((version) => version.imageUrl === imageEditor.url)?.id}
              onClose={closeImageEditor}
              onSubmit={handleImageEditSubmit}
              onSaveVersion={handleSaveEditorVersion}
              onVersionSelect={(version) => useCanvasStore.getState().openImageEditor({ ...imageEditor, url: version.imageUrl, title: version.label || imageEditor.title })}
            />
          </div>
        ) : null}
        <CanvasTopBar onExport={exportCanvas} onFocusAgent={focusAgent} />
        {nodeCount === 0 ? <EmptyCanvasGuide onCreate={(kind) => createNodeAt(kind, nodePositionAtCenter(kind, viewportCenter()))} /> : null}
        <CanvasZoomDock />
        <CanvasSelectionBar />
        <CanvasContextMenu />
        {skillNodeId ? <CanvasSkillDialog nodeId={skillNodeId} onClose={() => setSkillNodeId(null)} /> : null}
        {selectionSkill ? <CanvasSelectionSkillDialog key={selectionSkill.id} session={selectionSkill} onClose={closeSelectionSkill} /> : null}
        {selectionActions.dialogs}
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
