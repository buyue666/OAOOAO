'use client'

import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { useId, useRef } from 'react'
import Link from 'next/link'
import { DropdownMenu } from 'radix-ui'
import { AudioLines, Box, ChevronRight, FileImage, Film, FolderOpen, Grid2X2, Layers3, List, MoreHorizontal, Mountain, Palette, Pencil, Shirt, Sparkles, Trash2, UserRound } from 'lucide-react'
import { useUiText } from '@/lib/studio/i18n'
import type { Asset, AssetCategory } from '@/lib/studio/types'
import { assetCategoryLabels } from '@/lib/studio/reference-assets'
import { assetLibraryCounts, assetMediaKind, assetUsageCategory, type AssetCategoryFilter, type AssetMediaFilter } from '@/lib/studio/asset-library'
import { cn } from '@/lib/utils'
import { MediaThumb, Modal, ControlButton } from './ui'
import { MediaDownloadButton } from './media-download-button'
import motion from './asset-library-motion.module.css'

// Motion Prompt #049 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#049
const dialogMotion = { backdropClassName: motion.dialogBackdrop, surfaceClassName: motion.dialogSurface, exitMs: 280 }
export function AssetLibraryModal(props: ComponentProps<typeof Modal>) {
  const titleId = useId()
  return <Modal {...props} motion={{ ...dialogMotion, titleId }} />
}

// Motion Prompt #060 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#060
export function AssetLibraryViewControl({ value, onChange }: { value: 'grid' | 'list'; onChange: (value: 'grid' | 'list') => void }) {
  const tx = useUiText()
  return <div role="group" aria-label={tx('素材展示方式')} data-view={value} className={cn('flex h-11 shrink-0 rounded-xl border border-border bg-card p-1', motion.viewSwitch)}>
    <span aria-hidden="true" className={motion.viewIndicator} />
    {([{ value: 'grid', label: '缩略图', icon: Grid2X2 }, { value: 'list', label: '列表', icon: List }] as const).map(option => <button key={option.value} type="button" aria-label={tx(option.label)} title={tx(option.label)} aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={cn('flex w-11 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent', motion.viewChoice, value === option.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}><option.icon className="size-4" /></button>)}
  </div>
}

// Motion Prompt #052 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#052
export function AssetLibrarySelectionPanel({ open, children }: { open: boolean; children: ReactNode }) {
  return <div id="asset-selection-panel" data-open={open} aria-hidden={!open || undefined} inert={!open || undefined} className={motion.selectionPanel}><div className={motion.selectionClip}>{children}</div></div>
}

const mediaOptions = [
  { value: 'all', label: '全部素材', icon: Grid2X2 },
  { value: 'image', label: '图片', icon: FileImage },
  { value: 'video', label: '视频', icon: Film },
  { value: 'audio', label: '音频', icon: AudioLines },
] as const
const categoryIcons: Record<AssetCategory, ComponentType<{ className?: string }>> = { general: Layers3, character: UserRound, scene: Mountain, prop: Box, style: Palette, garment: Shirt }
const categoryOptions: Array<{ value: AssetCategoryFilter; label: string; icon: ComponentType<{ className?: string }> }> = [{ value: 'all', label: '全部分类', icon: FolderOpen }, ...Object.entries(assetCategoryLabels).map(([value, label]) => ({ value: value as AssetCategory, label, icon: categoryIcons[value as AssetCategory] }))]
const kindLabel = { image: '图片', video: '视频', audio: '音频' }

export function AssetLibraryNavigation({ assets, media, category, onMediaChange, onCategoryChange }: {
  assets: Asset[]; media: AssetMediaFilter; category: AssetCategoryFilter
  onMediaChange: (value: AssetMediaFilter) => void; onCategoryChange: (value: AssetCategoryFilter) => void
}) {
  const tx = useUiText()
  const counts = assetLibraryCounts(assets)
  function group<T extends string>(label: string, value: T, options: Array<{ value: T; label: string; icon: ComponentType<{ className?: string }> }>, count: Record<T, number>, onChange: (value: T) => void) {
    return <section aria-label={tx(label)}>
      <h2 className="mb-3 px-3 text-[11px] font-medium tracking-wide text-muted-foreground">{tx(label)}</h2>
      <div className="space-y-1">{options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={cn('flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent', motion.navigationChoice, value === option.value ? 'bg-studio-accent/10 font-semibold text-studio-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
        <option.icon className="size-4 shrink-0" /><span className="flex-1">{tx(option.label)}</span><span className={cn('min-w-6 rounded-md px-1.5 py-0.5 text-center text-[11px] tabular-nums', value === option.value ? 'bg-studio-accent/10' : 'bg-muted text-muted-foreground')}>{count[option.value]}</span>
      </button>)}</div>
    </section>
  }
  return <>
    <aside className="hidden self-start border-r border-border/70 pr-5 lg:sticky lg:top-6 lg:block" aria-label={tx('素材筛选')}>
      {group<AssetMediaFilter>('素材类型', media, [...mediaOptions], counts.media, onMediaChange)}
      <div className="mt-7">{group<AssetCategoryFilter>('用途分类', category, categoryOptions, counts.categories, onCategoryChange)}</div>
      <div className="mt-7 border-t border-border/70 px-3 pt-5 text-xs leading-5 text-muted-foreground"><p>{tx('分类数量按已载入的素材统计。')}</p><Link href="/skills" className="mt-3 inline-flex min-h-11 items-center gap-1 text-foreground hover:text-studio-accent">{tx('管理文本技能')}<ChevronRight className="size-3.5" /></Link></div>
    </aside>
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:hidden">
      <label className="min-w-0 text-xs font-medium text-muted-foreground">{tx('素材类型')}<select className="mt-1.5 h-11 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-sm text-foreground" value={media} onChange={event => onMediaChange(event.target.value as AssetMediaFilter)}>{mediaOptions.map(option => <option key={option.value} value={option.value}>{tx(option.label)} · {counts.media[option.value]}</option>)}</select></label>
      <label className="min-w-0 text-xs font-medium text-muted-foreground">{tx('用途分类')}<select className="mt-1.5 h-11 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-sm text-foreground" value={category} onChange={event => onCategoryChange(event.target.value as AssetCategoryFilter)}>{categoryOptions.map(option => <option key={option.value} value={option.value}>{tx(option.label)} · {counts.categories[option.value as AssetCategoryFilter]}</option>)}</select></label>
    </div>
  </>
}

export function AssetLibraryMenu({ asset, onRename, onDelete, onPreview }: { asset: Asset; onRename: () => void; onDelete: () => void; onPreview: () => void }) {
  const tx = useUiText()
  const pendingAction = useRef<(() => void) | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  function select(action: () => void) { pendingAction.current = action }
  const itemClass = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-muted'
  return <DropdownMenu.Root modal={false} onOpenChange={open => { if (open) pendingAction.current = null }}><DropdownMenu.Trigger asChild><button ref={triggerRef} type="button" aria-label={tx('{0} 的更多操作', [asset.title])} title={tx('更多操作')} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content sideOffset={6} collisionPadding={12} align="end" onCloseAutoFocus={event => { const action = pendingAction.current; if (action) { event.preventDefault(); pendingAction.current = null; triggerRef.current?.focus(); action() } }} className={cn('z-[70] min-w-44 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg', motion.menu)}>
    <DropdownMenu.Item className={itemClass} onSelect={() => select(onPreview)}><FileImage className="size-4" />{tx('预览素材')}</DropdownMenu.Item>
    <DropdownMenu.Item className={itemClass} onSelect={() => select(onRename)}><Pencil className="size-4" />{tx('编辑名称与分类')}</DropdownMenu.Item>
    <DropdownMenu.Separator className="my-1 h-px bg-border" />
    <DropdownMenu.Item className={cn(itemClass, 'text-destructive')} onSelect={() => select(onDelete)}><Trash2 className="size-4" />{tx('删除素材')}</DropdownMenu.Item>
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}

type CardProps = { asset: Asset; selected: boolean; selectionMode: boolean; onToggle: () => void; onRename: () => void; onDelete: () => void; onPreview: () => void }

export function AssetLibraryCard({ asset, selected, selectionMode, onToggle, onRename, onDelete, onPreview }: CardProps) {
  const tx = useUiText()
  const kind = assetMediaKind(asset), category = assetUsageCategory(asset)
  const Icon = kind === 'video' ? Film : kind === 'audio' ? AudioLines : FileImage
  return <article className={cn('group min-w-0 rounded-2xl border bg-card p-1.5', motion.card, selected ? 'border-studio-accent ring-2 ring-studio-accent/20' : 'border-border/70 hover:border-studio-accent/35 hover:shadow-sm')}>
    <div className="relative overflow-hidden rounded-xl bg-muted/45">
      <button type="button" className="relative block aspect-square w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-studio-accent" aria-label={tx(selectionMode ? '选择 {0}' : '预览 {0}', [asset.title])} aria-pressed={selectionMode ? selected : undefined} onClick={selectionMode ? onToggle : onPreview}>
        {kind === 'audio' ? <div className="flex size-full flex-col items-center justify-center gap-4 bg-studio-accent/5 text-studio-accent"><AudioLines className="size-10 stroke-1" /><div className="flex h-8 items-center gap-1.5" aria-hidden="true">{[12, 24, 18, 32, 20, 28, 14, 24, 10].map((height, index) => <span key={index} className="w-1 rounded-full bg-studio-accent/35" style={{ height }} />)}</div></div>
          : kind === 'video' && !asset.poster ? <div className="flex size-full items-center justify-center bg-studio-accent/5 text-studio-accent"><Film className="size-10 stroke-1" /></div>
          : <MediaThumb src={kind === 'video' ? asset.poster : asset.src} alt={asset.title} fallback={tx('预览暂不可用')} className="size-full [&_img]:object-contain" />}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card/95 px-2 py-1 text-[10px] font-medium text-foreground"><Icon className="size-3" />{tx(kindLabel[kind])}{asset.duration ? ` · ${asset.duration}` : ''}</span>
        {selected && <span className="absolute inset-0 border-2 border-studio-accent/40 bg-studio-accent/5" aria-hidden="true" />}
      </button>
      {selectionMode && <label className="absolute left-1 top-1 flex size-11 cursor-pointer items-center justify-center"><input type="checkbox" checked={selected} onChange={onToggle} className="size-5 rounded border-border accent-studio-accent" aria-label={tx('选择 {0}', [asset.title])} /></label>}
    </div>
    <div className="px-1.5 pb-0.5 pt-2">
      <div className="flex min-w-0 items-center gap-1"><p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={asset.title}>{asset.title}</p><button type="button" onClick={onRename} aria-label={tx('编辑 {0} 的名称与分类', [asset.title])} title={tx('编辑名称与分类')} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button></div>
      <div className="flex min-h-9 min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{tx(assetCategoryLabels[category])}{asset.size ? ` · ${asset.size}` : ''}</span><AssetLibraryMenu asset={asset} onRename={onRename} onDelete={onDelete} onPreview={onPreview} /></div>
    </div>
  </article>
}

export function AssetLibraryRow({ asset, selected, selectionMode, onToggle, onRename, onDelete, onPreview }: CardProps) {
  const tx = useUiText(), kind = assetMediaKind(asset)
  return <article className={cn('flex min-w-0 items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 sm:gap-4', motion.row, selected ? 'bg-studio-accent/5' : 'hover:bg-muted/40')}>
    {selectionMode && <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center"><input type="checkbox" checked={selected} onChange={onToggle} className="size-4 accent-studio-accent" aria-label={tx('选择 {0}', [asset.title])} /></label>}
    <button type="button" onClick={selectionMode ? onToggle : onPreview} aria-label={tx(selectionMode ? '选择 {0}' : '预览 {0}', [asset.title])} className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">{kind === 'audio' ? <AudioLines className="mx-auto size-6 text-studio-accent" /> : <MediaThumb src={asset.src} poster={asset.poster} kind={kind} alt={asset.title} fallback={tx('素材')} className="size-full [&_img]:object-contain [&_video]:object-contain" />}</button>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground" title={asset.title}>{asset.title}</p><p className="mt-1.5 truncate text-xs text-muted-foreground">{tx(kindLabel[kind])} · {tx(assetCategoryLabels[assetUsageCategory(asset)])}</p></div>
    <span className="hidden w-20 text-xs tabular-nums text-muted-foreground sm:block">{asset.size || '—'}</span>
    <button type="button" onClick={onRename} aria-label={tx('编辑 {0} 的名称与分类', [asset.title])} title={tx('编辑名称与分类')} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-4" /></button>
    <AssetLibraryMenu asset={asset} onRename={onRename} onDelete={onDelete} onPreview={onPreview} />
  </article>
}

export function AssetLibraryEmpty({ filtered, unavailable = false, onReset, onUpload, onRetry }: { filtered: boolean; unavailable?: boolean; onReset: () => void; onUpload: () => void; onRetry?: () => void }) {
  const tx = useUiText()
  return <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-5 py-12 text-center">
    <div className={motion.emptyContent}>
    <div className="relative mb-7 flex size-20 items-center justify-center rounded-2xl border border-studio-accent/20 bg-studio-accent/5 text-studio-accent"><Layers3 className="size-9 stroke-1" /><span className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border border-border bg-card text-studio-accent"><Sparkles className="size-3.5" /></span></div>
    <h3 className="text-base font-semibold text-foreground">{tx(unavailable ? '素材暂时无法读取' : filtered ? '没有匹配的素材' : '为下一次创作，留住好素材')}</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{tx(unavailable ? '请稍后重试，或检查上方错误提示。' : filtered ? '试试其他关键词，或调整素材类型与用途分类。' : '上传图片、视频或音频，在创作时随时引用。生成结果也会保存在这里。')}</p>
    <ControlButton className="mt-6 h-11 px-5" variant={filtered || unavailable ? 'secondary' : 'primary'} onClick={unavailable ? onRetry : filtered ? onReset : onUpload}>{tx(unavailable ? '重试' : filtered ? '清除筛选' : '上传第一份素材')}</ControlButton>
    </div>
  </div>
}

export function AssetLibraryPreview({ asset, onClose, onRename }: { asset: Asset | null; onClose: () => void; onRename: (asset: Asset) => void }) {
  const tx = useUiText()
  const kind = asset ? assetMediaKind(asset) : 'image'
  return <AssetLibraryModal open={Boolean(asset)} onClose={onClose} title={asset?.title ?? tx('预览素材')} className="max-w-4xl" footer={asset && <><ControlButton className="min-h-11" variant="ghost" onClick={() => { onClose(); onRename(asset) }}><Pencil className="size-4" />{tx('编辑名称与分类')}</ControlButton><MediaDownloadButton media={{ url: asset.src, kind }} title={asset.title} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm text-foreground" /></>}>
    {asset && <div className="flex min-h-48 items-center justify-center rounded-xl bg-muted/50">{kind === 'video' ? <video src={asset.src} poster={asset.poster} controls playsInline preload="metadata" className="max-h-[65dvh] max-w-full rounded-lg" aria-label={asset.title} /> : kind === 'audio' ? <div className="flex w-full flex-col items-center gap-5 p-8"><AudioLines className="size-12 text-studio-accent" /><audio src={asset.src} controls preload="metadata" className="max-w-full" aria-label={asset.title} /></div> : <img src={asset.src} alt={asset.title} className="max-h-[65dvh] max-w-full rounded-lg object-contain" />}</div>}
  </AssetLibraryModal>
}
