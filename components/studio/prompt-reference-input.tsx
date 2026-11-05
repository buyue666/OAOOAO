'use client'

import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {FileAudio, FileVideo, Image as ImageIcon} from 'lucide-react'
import {insertReferenceMention, referenceMentionQuery, type PromptReference} from '@/lib/studio/prompt-references'

export function PromptReferenceInput({id, value, onChange, references, placeholder}: {id: string; value: string; onChange: (value: string) => void; references: PromptReference[]; placeholder?: string}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const restoredCaret = useRef<number | null>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({top: 0, left: 0, width: 280, maxHeight: 240})
  const mention = referenceMentionQuery(value, caret)
  const candidates = references.map((reference, index) => ({...reference, index})).filter(reference => !mention?.query || `${reference.index + 1} ${reference.name}`.toLowerCase().includes(mention.query.toLowerCase()))
  const visible = open && Boolean(mention)
  useLayoutEffect(() => {
    if (restoredCaret.current !== null && textarea.current) {textarea.current.focus(); textarea.current.setSelectionRange(restoredCaret.current, restoredCaret.current); restoredCaret.current = null}
  }, [value])
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
    const next = insertReferenceMention(value, mention.start, caret, index)
    restoredCaret.current = next.caret; setCaret(next.caret); onChange(next.value); setOpen(false)
  }
  return <>
    <textarea ref={textarea} id={id} value={value} rows={5} placeholder={placeholder} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={visible} aria-controls={visible ? listId : undefined} aria-activedescendant={visible && candidates.length ? `${listId}-${candidates[Math.min(active, candidates.length - 1)].index}` : undefined}
      onChange={event => {onChange(event.target.value); setCaret(event.target.selectionStart); setOpen(Boolean(referenceMentionQuery(event.target.value, event.target.selectionStart))); setActive(0)}}
      onSelect={event => setCaret(event.currentTarget.selectionStart)} onFocus={event => {setCaret(event.target.selectionStart); setOpen(Boolean(referenceMentionQuery(value, event.target.selectionStart)))}} onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (!visible || event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setOpen(false)}
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault(); setActive(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, candidates.length)) % Math.max(1, candidates.length))}
        else if ((event.key === 'Enter' || event.key === 'Tab') && candidates.length) {event.preventDefault(); choose(candidates[Math.min(active, candidates.length - 1)].index)}
      }} className="studio-field min-h-36 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
    {visible && createPortal(<div id={listId} role="listbox" aria-label="选择已上传的参考素材" className="fixed z-[100] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl" style={position}>
      <p className="px-2 py-1 text-[11px] text-muted-foreground">选择素材引用 · 按提交顺序编号</p>
      {candidates.length ? candidates.map((reference, position) => {
        const Icon = reference.type === 'audio' ? FileAudio : reference.type === 'video' ? FileVideo : ImageIcon
        return <button key={`${reference.id}:${reference.index}`} id={`${listId}-${reference.index}`} type="button" role="option" aria-selected={position === Math.min(active, candidates.length - 1)} disabled={reference.ready === false} onMouseDown={event => event.preventDefault()} onClick={() => choose(reference.index)} className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-xs disabled:opacity-50 ${position === Math.min(active, candidates.length - 1) ? 'bg-studio-accent/10 text-foreground' : 'hover:bg-muted'}`}>
          {reference.type === 'image' && reference.preview ? <img src={reference.preview} alt="" className="size-9 rounded-md border border-border object-cover" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted"><Icon className="size-4" /></span>}
          <span className="min-w-0 flex-1"><span className="font-semibold text-studio-accent">@{reference.index + 1}</span><span className="ml-2 break-words">{reference.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{reference.type === 'image' ? '图片' : reference.type === 'video' ? '视频' : '音频'}{reference.ready === false ? ' · 读取中' : ''}</span></span>
        </button>
      }) : <p className="px-2 py-3 text-xs text-muted-foreground">{references.length ? '没有匹配的素材' : '先上传或选择参考素材，再输入 @ 引用'}</p>}
    </div>, document.body)}
  </>
}
