'use client'

import { useUiText } from '@/lib/studio/i18n'
import {useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type KeyboardEvent} from 'react'
import {createPortal} from 'react-dom'
import {FileAudio, FileText, FileVideo, Image as ImageIcon} from 'lucide-react'
import {insertReferenceMention, promptReferenceMentions, referenceMentionLabel, referenceMentionQuery, type PromptReference} from '@/lib/studio/prompt-references'

export function PromptReferenceInput({id, value, onChange, references, placeholder, inputRef, disabled, compact, appearance, onFocus, onKeyDown}: {id: string; value: string; onChange: (value: string) => void; references: PromptReference[]; placeholder?: string; inputRef?: RefObject<HTMLTextAreaElement | null>; disabled?: boolean; compact?: boolean; appearance?: 'composer'; onFocus?: () => void; onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void}) {
  const tx = useUiText()
  const ownTextarea = useRef<HTMLTextAreaElement>(null)
  const textarea = inputRef ?? ownTextarea
  const mirror = useRef<HTMLDivElement>(null)
  const restoredCaret = useRef<number | null>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({top: 0, left: 0, width: 280, maxHeight: 240})
  const mention = referenceMentionQuery(value, caret)
  const candidates = references.map((reference, index) => ({...reference, index, label: referenceMentionLabel(references, index)})).filter(reference => !mention?.query || `${reference.index + 1} ${reference.label} ${reference.type === 'image' ? '图片' : reference.type === 'video' ? '视频' : reference.type === 'text' ? '文档' : '音频'} ${reference.name}`.toLowerCase().includes(mention.query.toLowerCase()))
  const visible = !disabled && open && Boolean(mention)
  const syncMirror = () => {
    if (!textarea.current || !mirror.current) return
    mirror.current.style.width = `${textarea.current.clientWidth}px`
    mirror.current.scrollTop = textarea.current.scrollTop
    mirror.current.scrollLeft = textarea.current.scrollLeft
  }
  useLayoutEffect(() => {
    if (restoredCaret.current !== null && textarea.current) {textarea.current.focus(); textarea.current.setSelectionRange(restoredCaret.current, restoredCaret.current); restoredCaret.current = null}
    syncMirror()
  }, [value])
  useEffect(() => {
    const input = textarea.current
    if (!input) return
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(syncMirror)
    observer?.observe(input)
    window.addEventListener('resize', syncMirror)
    return () => {observer?.disconnect(); window.removeEventListener('resize', syncMirror)}
  }, [])
  useEffect(() => {
    if (!visible) return
    const place = () => {
      const rect = textarea.current?.getBoundingClientRect(); if (!rect) return
      const width = Math.min(Math.max(280, rect.width), window.innerWidth - 24)
      const height = Math.min(240, Math.max(72, candidates.length * 52 + 36))
      const below = window.innerHeight - rect.bottom > height + 12
      const top = below ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)
      setPosition({top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width, maxHeight: Math.min(height, window.innerHeight - top - 12)})
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => {window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true)}
  }, [visible, candidates.length])
  const choose = (index: number) => {
    if (!mention || references[index]?.ready === false) return
    const next = insertReferenceMention(value, mention.start, caret, index, references)
    restoredCaret.current = next.caret; setCaret(next.caret); onChange(next.value); setOpen(false)
  }
  const highlighted: ReactNode[] = []
  let end = 0
  for (const token of promptReferenceMentions(value, references)) {
    highlighted.push(value.slice(end, token.start), <mark key={`${token.start}:${token.index}`} className="prompt-reference-mention" title={references[token.index].name}>{token.text}</mark>)
    end = token.end
  }
  highlighted.push(value.slice(end))
  return <>
    <div className={`prompt-reference-editor relative text-sm leading-6 text-foreground ${appearance === 'composer' ? 'agent-prompt-editor' : 'studio-field rounded-lg border border-border bg-background focus-within:border-studio-accent/60 focus-within:ring-2 focus-within:ring-studio-accent/15'}`}>
    <div ref={mirror} aria-hidden="true" className={`prompt-reference-mirror pointer-events-none absolute inset-0 overflow-hidden ${value ? '' : 'text-muted-foreground'}`}>{value ? highlighted : placeholder}{'\u200b'}</div>
    <textarea ref={textarea} id={id} value={value} disabled={disabled} aria-label="提示词" rows={compact ? 3 : 5} placeholder={placeholder} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={visible} aria-controls={visible ? listId : undefined} aria-activedescendant={visible && candidates.length ? `${listId}-${candidates[Math.min(active, candidates.length - 1)].index}` : undefined}
      onChange={event => {onChange(event.target.value); setCaret(event.target.selectionStart); setOpen(Boolean(referenceMentionQuery(event.target.value, event.target.selectionStart))); setActive(0)}}
      onScroll={syncMirror} onSelect={event => {setCaret(event.currentTarget.selectionStart); setOpen(Boolean(referenceMentionQuery(value, event.currentTarget.selectionStart)))}} onFocus={event => {onFocus?.(); setCaret(event.target.selectionStart); setOpen(Boolean(referenceMentionQuery(value, event.target.selectionStart)))}} onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (!visible) { onKeyDown?.(event); return }
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setOpen(false)}
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault(); setActive(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, candidates.length)) % Math.max(1, candidates.length))}
        else if ((event.key === 'Enter' || event.key === 'Tab') && candidates.length) {event.preventDefault(); choose(candidates[Math.min(active, candidates.length - 1)].index)}
        if (!event.defaultPrevented) onKeyDown?.(event)
      }} className={`prompt-reference-textarea nodrag nowheel relative block w-full resize-y bg-transparent outline-none disabled:opacity-60 ${compact ? 'min-h-24' : 'min-h-36'}`} />
    </div>
    {visible && createPortal(<div id={listId} role="listbox" aria-label={tx("选择已上传的参考素材")} className="fixed z-[100] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl" style={position}>
      <p className="px-2 py-1 text-[11px] text-muted-foreground">{tx(references.some(reference => reference.mention) ? '引用相关文件 · ↑ ↓ 选择 · Enter 插入' : '选择参考素材 · 图、视频、音频分别编号')}</p>
      {candidates.length ? candidates.map((reference, position) => {
        const Icon = reference.type === 'audio' ? FileAudio : reference.type === 'video' ? FileVideo : reference.type === 'text' ? FileText : ImageIcon
        return <button key={`${reference.id}:${reference.index}`} id={`${listId}-${reference.index}`} type="button" role="option" aria-selected={position === Math.min(active, candidates.length - 1)} disabled={reference.ready === false} onMouseDown={event => event.preventDefault()} onClick={() => choose(reference.index)} className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-xs disabled:opacity-50 ${position === Math.min(active, candidates.length - 1) ? 'bg-studio-accent/10 text-foreground' : 'hover:bg-muted'}`}>
          {reference.type === 'image' && reference.preview ? <img src={reference.preview} alt="" className="size-9 rounded-md border border-border object-cover" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted"><Icon className="size-4" /></span>}
          <span className="min-w-0 flex-1"><span className="prompt-reference-mention break-words rounded px-1 py-0.5 font-medium">{reference.label}</span>{!reference.mention && <span className="ml-2 break-words">{reference.name}</span>}<span className="mt-0.5 block text-[10px] text-muted-foreground">{reference.type === 'image' ? tx('图片') : reference.type === 'video' ? tx('视频') : reference.type === 'text' ? tx('文档') : tx('音频')}{reference.ready === false ? tx(' · 读取中') : ''}</span></span>
        </button>
      }) : <p className="px-2 py-3 text-xs text-muted-foreground">{references.length ? tx('没有匹配的素材') : tx('先上传或选择参考素材，再输入 @ 引用')}</p>}
    </div>, document.body)}
  </>
}
