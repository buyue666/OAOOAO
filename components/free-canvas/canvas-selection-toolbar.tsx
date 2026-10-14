'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, CopyPlus, FolderPlus, Group, MoreHorizontal, Puzzle, Ungroup } from 'lucide-react'
import { useCanvasActions } from './canvas-context'
import { selectionNodes, selectionRoots } from './canvas-selection'
import { useCanvasStore } from './canvas-store'
import type { FreeCanvasNode, GenerationFlowNode } from './types'

export function CanvasSelectionBar() {
  const nodes = useCanvasStore(state => state.nodes)
  const chosen = useMemo(() => selectionNodes(nodes), [nodes])
  const roots = useMemo(() => selectionRoots(nodes), [nodes])
  if (!chosen.length) return null
  return <SelectionToolbar key={chosen.map(node => node.id).join('|')} nodes={chosen} rootCount={roots.length} />
}

function SelectionToolbar({ nodes, rootCount }: { nodes: FreeCanvasNode[]; rootCount: number }) {
  const actions = useCanvasActions()
  const [moreOpen, setMoreOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const ids = nodes.map(node => node.id)
  const hasGroup = nodes.some(node => node.type === 'group')
  const contentCount = nodes.filter(node => node.type !== 'group').length
  const hasOutputs = nodes.some(node => node.type === 'media' ? Boolean(node.data.media) : node.type === 'generation' && (node.data.results.length > 0 || Boolean(node.data.text?.trim())))
  const hasSkillContent = nodes.some(node => node.type === 'generation' && node.data.prompt.trim())
  const runnable = nodes.filter((node): node is GenerationFlowNode => node.type === 'generation' && Boolean(node.data.prompt.trim()) && !['queued', 'running'].includes(node.data.task?.phase ?? ''))
  const allGeneration = nodes.filter(node => node.type !== 'group').every(node => node.type === 'generation')
  const state = () => useCanvasStore.getState()
  const close = () => { setMoreOpen(false); trigger.current?.focus() }

  useEffect(() => {
    if (!moreOpen) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) setMoreOpen(false) }
    const previous = document.activeElement
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside); if (previous instanceof HTMLElement && previous.isConnected && document.activeElement === document.body) previous.focus() }
  }, [moreOpen])

  return <div role="toolbar" aria-label="选中内容操作" className="pointer-events-auto absolute bottom-[76px] left-1/2 z-40 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-2xl border border-white/20 bg-neutral-950/95 p-1.5 shadow-[0_16px_50px_rgba(0,0,0,.6)] backdrop-blur-md">
    <span className="px-2 text-[11px] text-neutral-400" title={hasGroup ? '包含所选分组内的全部节点' : undefined}>{hasGroup ? '含组内 ' : '已选 '}{contentCount || nodes.length} 项</span>
    <SelectionButton label="保存结果到资产" icon={<FolderPlus />} disabled={!hasOutputs} onClick={() => actions.saveSelectionResults(ids)} />
    <SelectionButton label="创建副本" icon={<CopyPlus />} onClick={() => state().duplicateSelection()} />
    {rootCount >= 2 && <SelectionButton label="分组" icon={<Group />} onClick={() => state().groupSelection()} />}
    {hasGroup && <SelectionButton label="解散分组" icon={<Ungroup />} onClick={() => state().ungroupSelection()} />}
    <SelectionButton label="交给助手" icon={<Bot />} onClick={() => actions.draftAgentFromSelection(ids)} />
    <SelectionButton label="创建 Skill" icon={<Puzzle />} disabled={!hasSkillContent} onClick={() => actions.createSkillFromSelection(ids)} />
    <div ref={menu} className="static" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMoreOpen(false) }}>
      <button ref={trigger} type="button" aria-label="更多选中内容操作" title="更多：复制、对齐、导出、删除" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(open => !open)} className="flex size-8 items-center justify-center rounded-xl text-neutral-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><MoreHorizontal className="size-4" aria-hidden="true" /></button>
      {moreOpen && <div role="menu" aria-label="更多选中内容操作" className="absolute bottom-[calc(100%+0.5rem)] left-1/2 max-h-[55dvh] w-56 -translate-x-1/2 overflow-y-auto rounded-xl border border-white/15 bg-neutral-900 p-1.5 shadow-2xl" onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }
      }}>
        <MenuButton onClick={() => { state().copySelection(); close() }}>复制到画布剪贴板</MenuButton>
        {rootCount >= 2 && <><MenuButton onClick={() => { state().alignSelection('x'); close() }}>左对齐</MenuButton><MenuButton onClick={() => { state().alignSelection('y'); close() }}>顶对齐</MenuButton></>}
        <MenuButton onClick={() => { actions.exportSelection(ids); close() }}>导出选中内容 JSON</MenuButton>
        {allGeneration && runnable.length >= 2 && <MenuButton onClick={() => { runnable.forEach(node => void actions.submitNode(node.id)); close() }}>生成选中节点（{runnable.length} 项）</MenuButton>}
        <div role="separator" className="my-1 h-px bg-white/10" />
        <MenuButton onClick={() => { state().deleteSelection(); close() }}>{hasGroup ? '删除整组（含内容，可撤销）' : '删除选中内容（可撤销）'}</MenuButton>
      </div>}
    </div>
  </div>
}

function SelectionButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button type="button" title={disabled ? `${label}：当前选中内容没有可用的${label.includes('Skill') ? '提示词' : '结果'}` : label} aria-label={label} disabled={disabled} onClick={onClick} className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs text-neutral-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-35"><span className="[&>svg]:size-3.5" aria-hidden="true">{icon}</span><span>{label}</span></button>
}

function MenuButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" role="menuitem" tabIndex={-1} onClick={onClick} className="w-full rounded-lg px-2.5 py-2 text-left text-xs text-neutral-200 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none">{children}</button>
}
