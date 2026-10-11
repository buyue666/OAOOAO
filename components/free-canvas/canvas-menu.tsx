'use client'

import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useCanvasActions } from './canvas-context'
import { useCanvasStore } from './canvas-store'
import { CREATABLE_KINDS, NODE_META } from './node-factory'
import type { FreeCanvasNode } from './types'
import { settingsSideFor } from './nodes/node-kit'

type MenuEntry =
  | { type: 'item'; key: string; label: string; onSelect: () => void; disabled?: boolean }
  | { type: 'heading'; key: string; label: string }
  | { type: 'separator'; key: string }

const MENU_WIDTH = 232
const MENU_HEIGHT_ESTIMATE = 360

export function CanvasContextMenu() {
  const menu = useCanvasStore((state) => state.contextMenu)
  const openContextMenu = useCanvasStore((state) => state.openContextMenu)
  const targetNodeId = menu?.target.type === 'node' ? menu.target.nodeId : null
  const targetNode = useCanvasStore((state) => state.nodes.find((node) => node.id === targetNodeId))
  const canUndo = useCanvasStore((state) => state.past.length > 0)
  const canRedo = useCanvasStore((state) => state.future.length > 0)
  const clipboard = useCanvasStore((state) => state.clipboard)
  const trash = useCanvasStore((state) => state.trash)
  const actions = useCanvasActions()
  const { fitView } = useReactFlow()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) openContextMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [menu, openContextMenu])

  if (!menu) return null

  const close = () => openContextMenu(null)
  const store = () => useCanvasStore.getState()
  const entries: MenuEntry[] = menu.target.type === 'node'
    ? targetNode ? nodeEntries(targetNode, actions, store) : []
    : paneEntries(menu.target.position, { actions, store, canUndo, canRedo, clipboard: Boolean(clipboard), trash, fit: () => void fitView({ padding: 0.25, duration: 200 }) })

  const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - MENU_HEIGHT_ESTIMATE))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="画布菜单"
      className="fixed z-[70] max-h-[calc(100dvh-16px)] w-[232px] overflow-y-auto rounded-2xl border border-white/15 bg-neutral-950 p-1.5 text-white shadow-[0_24px_60px_rgba(0,0,0,0.75)]"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry) => {
        if (entry.type === 'separator') return <div key={entry.key} role="separator" className="my-1 h-px bg-white/10" />
        if (entry.type === 'heading') return <p key={entry.key} className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-[0.12em] text-neutral-500 uppercase">{entry.label}</p>
        return (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect()
              close()
            }}
            className={cn('flex w-full items-center rounded-xl px-2.5 py-2 text-left text-[13px] text-neutral-100 transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:opacity-35 disabled:hover:bg-transparent')}
          >
            {entry.label}
          </button>
        )
      })}
    </div>
  )
}

function selectOnly(nodeId: string) {
  useCanvasStore.getState().selectNodeOnly(nodeId)
}

function nodeEntries(
  node: FreeCanvasNode,
  actions: ReturnType<typeof useCanvasActions>,
  store: () => ReturnType<typeof useCanvasStore.getState>,
): MenuEntry[] {
  const entries: MenuEntry[] = []
  if (node.type === 'generation') {
    const phase = node.data.task?.phase
    const busy = phase === 'queued' || phase === 'running'
    entries.push(busy
      ? { type: 'item', key: 'cancel', label: '取消生成', onSelect: () => void actions.cancelNode(node.id) }
      : { type: 'item', key: 'generate', label: phase === 'error' ? '重新生成' : '生成', disabled: !node.data.prompt.trim(), onSelect: () => void actions.submitNode(node.id) })
    entries.push({
      type: 'item',
      key: 'settings',
      label: '节点配置',
      onSelect: () => {
        const element = document.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`)
        store().openSettings(node.id, settingsSideFor(element))
      },
    })
    entries.push({ type: 'item', key: 'favorite', label: '收藏第一个结果', disabled: !node.data.results.length, onSelect: () => void actions.saveResultToLibrary(node.id, 0) })
    entries.push({ type: 'item', key: 'skill', label: '存为技能', disabled: !node.data.prompt.trim(), onSelect: () => void actions.saveSkillFromNode(node.id) })
  }
  if (node.type === 'media') {
    entries.push({ type: 'item', key: 'replace', label: node.data.media ? '替换素材' : '选择素材', onSelect: () => store().setAssetPanel(true, node.id) })
  }
  if (node.type === 'agent') {
    entries.push({ type: 'item', key: 'run', label: '运行 Agent', disabled: !node.data.prompt.trim(), onSelect: () => void actions.startAgent(node.id) })
  }
  if (node.type === 'group') {
    entries.push({
      type: 'item',
      key: 'ungroup',
      label: '解散分组',
      onSelect: () => {
        selectOnly(node.id)
        store().ungroupSelection()
      },
    })
  }
  entries.push({ type: 'separator', key: 'sep-1' })
  entries.push({
    type: 'item',
    key: 'duplicate',
    label: '复制节点',
    onSelect: () => {
      selectOnly(node.id)
      store().duplicateSelection()
    },
  })
  entries.push({ type: 'item', key: 'delete', label: '删除节点', onSelect: () => store().removeNodes([node.id]) })
  return entries
}

function paneEntries(
  position: { x: number; y: number },
  context: {
    actions: ReturnType<typeof useCanvasActions>
    store: () => ReturnType<typeof useCanvasStore.getState>
    canUndo: boolean
    canRedo: boolean
    clipboard: boolean
    trash: ReturnType<typeof useCanvasStore.getState>['trash']
    fit: () => void
  },
): MenuEntry[] {
  const { actions, store, canUndo, canRedo, clipboard, trash, fit } = context
  const entries: MenuEntry[] = [{ type: 'heading', key: 'h-new', label: '新建节点' }]
  for (const kind of CREATABLE_KINDS) {
    entries.push({ type: 'item', key: `new-${kind}`, label: NODE_META[kind].label, onSelect: () => actions.createNodeAt(kind, position) })
  }
  entries.push({ type: 'separator', key: 'sep-1' })
  entries.push({ type: 'item', key: 'paste', label: '粘贴', disabled: !clipboard, onSelect: () => store().pasteClipboard(position) })
  entries.push({ type: 'item', key: 'undo', label: '撤销', disabled: !canUndo, onSelect: () => store().undo() })
  entries.push({ type: 'item', key: 'redo', label: '重做', disabled: !canRedo, onSelect: () => store().redo() })
  entries.push({ type: 'item', key: 'fit', label: '适应画面', onSelect: fit })
  if (trash.length) {
    entries.push({ type: 'separator', key: 'sep-2' })
    entries.push({ type: 'heading', key: 'h-trash', label: '最近删除' })
    for (const entry of trash.slice(0, 5)) {
      entries.push({
        type: 'item',
        key: `restore-${entry.id}`,
        label: `恢复 ${entry.nodes.length} 个节点`,
        onSelect: () => store().restoreTrash(entry.id),
      })
    }
  }
  return entries
}
