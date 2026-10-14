'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeft, Bot, Check, CircleAlert, Download, FolderOpen, LoaderCircle, Redo2, RefreshCw, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasActions } from './canvas-context'
import { flushCanvasSave } from './canvas-persistence'
import { useCanvasStore, type SaveStatus } from './canvas-store'
import { CREATABLE_KINDS, NODE_META, type CreatableKind } from './node-factory'
import type { GenerationFlowNode } from './types'
import { CanvasLeaveDialog } from './canvas-leave-dialog'
import { CanvasNameEditor } from './canvas-name-editor'
export { CanvasNavigationDock as CanvasZoomDock } from './canvas-navigation'

const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: '已加载',
  dirty: '未保存',
  saving: '保存中',
  saved: '已保存',
  error: '保存失败',
  conflict: '已在别处更新',
}

export function CanvasTopBar({ onExport, onFocusAgent }: { onExport: () => void; onFocusAgent: () => void }) {
  const router = useRouter()
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  const leave = (href: '/studio' | '/canvas') => {
    const current = useCanvasStore.getState()
    if (current.revision !== current.savedRevision) setLeaveTo(href)
    else router.push(href)
  }
  const title = useCanvasStore((state) => state.title)
  const projectId = useCanvasStore((state) => state.projectId)
  const saveStatus = useCanvasStore((state) => state.saveStatus)
  const saveError = useCanvasStore((state) => state.saveError)
  const canUndo = useCanvasStore((state) => state.past.length > 0)
  const canRedo = useCanvasStore((state) => state.future.length > 0)
  const assetPanelOpen = useCanvasStore((state) => state.assetPanelOpen)
  const setTitle = useCanvasStore((state) => state.setTitle)
  const undo = useCanvasStore((state) => state.undo)
  const redo = useCanvasStore((state) => state.redo)
  const setAssetPanel = useCanvasStore((state) => state.setAssetPanel)

  return (
    <header className="pointer-events-none absolute inset-x-3 top-3 z-40 flex flex-wrap items-start justify-between gap-2">
      {leaveTo ? <CanvasLeaveDialog onClose={() => setLeaveTo(null)} onSaved={() => { const href = leaveTo; setLeaveTo(null); router.push(href) }} /> : null}
      <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-2xl border border-white/15 bg-black/85 p-1.5 backdrop-blur-md">
        <button type="button" onClick={() => leave('/studio')} aria-label="返回工作台" title="返回工作台" className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs text-neutral-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
          <ArrowLeft className="size-4" aria-hidden="true" />
          工作台
        </button>
        <button type="button" onClick={() => leave('/canvas')} aria-label="返回画布列表" title="返回画布列表" className="flex size-8 shrink-0 items-center justify-center rounded-xl text-neutral-400 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><FolderOpen className="size-4" aria-hidden="true" /></button>
        <CanvasNameEditor key={projectId} value={title} onCommit={setTitle} label="画布名称" className="w-40 flex-1 sm:w-56" />
        <SaveStatusLabel status={saveStatus} error={saveError} onExport={onExport} />
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-2xl border border-white/15 bg-black/85 p-1.5 backdrop-blur-md">
        <ToolbarButton label="撤销" disabled={!canUndo} onClick={() => undo()}>
          <Undo2 className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="重做" disabled={!canRedo} onClick={() => redo()}>
          <Redo2 className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/15" />
        <ToolbarButton label="定位 OAO Agent" onClick={onFocusAgent}>
          <Bot className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="资产库" pressed={assetPanelOpen} onClick={() => (assetPanelOpen ? setAssetPanel(false) : setAssetPanel(true))}>
          <FolderOpen className="size-4" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="导出画布" onClick={onExport}>
          <Download className="size-4" aria-hidden="true" />
        </ToolbarButton>
      </div>
    </header>
  )
}

function SaveStatusLabel({ status, error, onExport }: { status: SaveStatus; error: string | null; onExport: () => void }) {
  if (status === 'conflict') {
    return (
      <button type="button" aria-label="画布在别处更新，导出本地内容以免丢失" title={error ?? '画布已在别处更新，请先导出本地内容，再刷新同步。'} onClick={onExport} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-amber-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
        <CircleAlert className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">导出本地副本</span>
      </button>
    )
  }
  if (status === 'error') {
    return (
      <button type="button" aria-label="保存失败，重试保存" title={error ?? undefined} onClick={() => void flushCanvasSave().catch(() => undefined)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-amber-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">重试保存</span>
      </button>
    )
  }
  return (
    <span role="status" aria-live="polite" title={SAVE_LABEL[status]} className="flex shrink-0 items-center gap-1.5 px-1.5 text-[11px] text-neutral-400">
      {status === 'saving' ? <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden="true" /> : status === 'dirty' ? <span className="size-1.5 rounded-full bg-amber-300" aria-hidden="true" /> : <Check className="size-3" aria-hidden="true" />}
      <span className="sr-only sm:not-sr-only">{SAVE_LABEL[status]}</span>
    </span>
  )
}

function ToolbarButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-xl text-neutral-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35',
        pressed && 'bg-white text-black hover:bg-white hover:text-black',
      )}
    >
      {children}
    </button>
  )
}

export function EmptyCanvasGuide({ onCreate }: { onCreate: (kind: CreatableKind) => void }) {
  return (
    <section aria-labelledby="empty-canvas-title" className="pointer-events-auto absolute top-1/2 left-1/2 z-10 w-[min(calc(100%-1.5rem),520px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/15 bg-neutral-950/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.7)] sm:p-6">
      <h2 id="empty-canvas-title" className="text-lg font-semibold text-white">从一个节点开始</h2>
      <p className="mt-1 text-sm leading-relaxed text-neutral-400">选择节点类型，直接在节点里输入提示词并生成，结果会留在这个节点上。</p>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CREATABLE_KINDS.map((kind) => {
          const meta = NODE_META[kind]
          const Icon = meta.icon
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onCreate(kind)}
              className="flex min-h-16 flex-col items-start justify-between gap-2 rounded-2xl border border-white/12 p-3 text-left transition-colors hover:border-white/50 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-white"
            >
              <Icon className="size-4 text-neutral-300" aria-hidden="true" />
              <span className="text-xs font-medium text-white">{meta.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function CanvasSelectionBar() {
  const selected = useCanvasStore(useShallow((state) => state.nodes.filter((node) => node.selected)))
  const groupSelection = useCanvasStore((state) => state.groupSelection)
  const ungroupSelection = useCanvasStore((state) => state.ungroupSelection)
  const alignSelection = useCanvasStore((state) => state.alignSelection)
  const copySelection = useCanvasStore((state) => state.copySelection)
  const duplicateSelection = useCanvasStore((state) => state.duplicateSelection)
  const deleteSelection = useCanvasStore((state) => state.deleteSelection)
  const actions = useCanvasActions()

  if (selected.length < 2) return null

  const runnable = selected.filter((node): node is GenerationFlowNode => node.type === 'generation' && node.data.prompt.trim().length > 0)
  const allGeneration = selected.every((node) => node.type === 'generation')
  const hasGroup = selected.some((node) => node.type === 'group')
  const topLevelCount = selected.filter((node) => !node.parentId).length

  return (
    <div role="toolbar" aria-label="批量操作" className="pointer-events-auto absolute bottom-[76px] left-1/2 z-40 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-2xl border border-white/15 bg-black/90 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.7)] backdrop-blur-md">
      <span className="px-2 text-xs text-neutral-400">已选 {selected.length}</span>
      <BarButton onClick={() => groupSelection()}>分组</BarButton>
      {hasGroup ? <BarButton onClick={() => ungroupSelection()}>解组</BarButton> : null}
      {topLevelCount >= 2 ? (
        <>
          <BarButton onClick={() => alignSelection('x')}>左对齐</BarButton>
          <BarButton onClick={() => alignSelection('y')}>顶对齐</BarButton>
        </>
      ) : null}
      <BarButton onClick={() => copySelection()}>复制</BarButton>
      <BarButton onClick={() => duplicateSelection()}>副本</BarButton>
      {allGeneration && runnable.length ? (
        <BarButton primary onClick={() => runnable.forEach((node) => void actions.submitNode(node.id))}>批量生成 {runnable.length}</BarButton>
      ) : null}
      <BarButton onClick={() => deleteSelection()}>删除</BarButton>
    </div>
  )
}

function BarButton({ children, onClick, primary }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-xl px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-white',
        primary ? 'bg-white font-medium text-black hover:bg-neutral-200' : 'text-neutral-200 hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
    </button>
  )
}

export function CanvasNoticeToast() {
  const notice = useCanvasStore((state) => state.notice)
  const setNotice = useCanvasStore((state) => state.setNotice)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])

  if (!notice) return null
  return (
    <p role="status" className="pointer-events-none absolute top-20 left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2 truncate rounded-full border border-white/20 bg-black/90 px-4 py-2 text-xs text-white shadow-xl">
      {notice}
    </p>
  )
}
