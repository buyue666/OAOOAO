'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Archive,
  Check,
  Clock3,
  Copy,
  Download,
  FileAudio,
  FileImage,
  FileVideo,
  FolderPlus,
  Grid2X2,
  Image as ImageIcon,
  List,
  MoreHorizontal,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  UserRound,
  Video,
  WandSparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ControlButton,
  EmptyState,
  IconAction,
  KeyValue,
  MediaThumb,
  Modal,
  Notice,
  PageHeader,
  SearchField,
  SegmentedControl,
  StatusBadge,
} from './ui'
import { getTaskLabel, getTaskTone } from '@/lib/studio/mock-service'
import { useStudio } from '@/lib/studio/store'
import { useGeneration } from '@/lib/studio/generation-store'
import { GenerationErrorNotice, GenerationNotice, GenerationTaskCard, LocalPreviewNotice, QueryUnavailableNotice } from './live-generation'
import {
  createLibraryAsset,
  deleteLibraryAsset,
  listAllWorks,
  readImageSize,
  uploadPersistentAsset,
  type GenerationHistoryItem,
  type LibraryAssetView,
  type StudioWork,
} from '@/lib/studio/account-api'
import { useLibraryAssets, useServerHistory, useServerWorks } from '@/lib/studio/use-account-data'
import { bumpAccountData } from '@/lib/studio/account-data-sync'
import { addMediaToProject, removeMediaFromProject } from '@/lib/studio/project-media'
import { cn } from '@/lib/utils'
import type { AssetKind, Asset, Task, TaskStatus } from '@/lib/studio/types'

const assetFilters: Array<{ value: string; label: string; kind?: AssetKind }> = [
  { value: '全部', label: '全部' },
  { value: 'image', label: '图片', kind: 'image' },
  { value: 'video', label: '视频', kind: 'video' },
  { value: 'audio', label: '音频', kind: 'audio' },
  { value: 'character', label: '角色', kind: 'character' },
  { value: 'scene', label: '场景', kind: 'scene' },
]

function assetIcon(kind: AssetKind) {
  if (kind === 'video') return <FileVideo className="size-4" />
  if (kind === 'audio') return <FileAudio className="size-4" />
  if (kind === 'image') return <FileImage className="size-4" />
  if (kind === 'character') return <UserRound className="size-4" />
  return <Archive className="size-4" />
}

/**
 * 把后端素材库记录转换成素材条目。
 *
 * 素材库是「用户上传并落库的素材」，与生成结果（作品）分开：
 * 前者可删除，后者属于作品记录。两者都出现在素材页，便于复用为参考素材。
 */
function libraryAssetToAsset(record: LibraryAssetView): Asset {
  const data = (record.data ?? {}) as { serverUrl?: string; url?: string; dataUrl?: string; mimeType?: string; bytes?: number; width?: number; height?: number }
  const src = String(data.serverUrl || data.url || data.dataUrl || record.coverUrl || '')
  const bytes = Number(data.bytes) || 0
  return {
    id: record.id,
    kind: record.kind === 'video' ? 'video' : record.kind === 'audio' ? 'audio' : 'image',
    title: record.title,
    src,
    poster: record.kind === 'video' ? record.coverUrl : undefined,
    fallback: record.coverUrl ?? src,
    dimensions: data.width && data.height ? `${data.width}×${data.height}` : undefined,
    tags: record.tags?.length ? record.tags : ['上传'],
    size: bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '',
    status: '可用',
    projectIds: [],
    referencedBy: [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * 把后端生成结果转换成素材条目。
 *
 * 生成结果本身就是可复用的素材（参考图、首尾帧、编辑源图都从素材库选），
 * 因此素材页必须包含真实结果，否则工作台的参考素材选择器在真实账户下是空的。
 */
function workToAsset(work: StudioWork): Asset {
  return {
    id: `generated-${work.id}`,
    kind: work.kind === 'video' ? 'video' : work.kind === 'audio' ? 'audio' : 'image',
    title: work.title,
    src: work.src,
    poster: work.poster,
    fallback: work.fallback,
    tags: ['生成结果', work.model ? String(work.model) : '未记录模型'],
    size: '',
    status: '可用',
    projectIds: [],
    referencedBy: [],
    createdAt: work.createdAt ?? new Date().toISOString(),
  }
}

export function AssetsPage() {
  const { state } = useStudio()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('全部')
  const [view, setView] = useState('grid')
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [projectBusy, setProjectBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  /**
   * 素材来源 = 后端素材库（真实上传与落库）+ 后端生成作品。
   *
   * 早先这里只有「后端生成结果」+ 本地演示素材：上传只提示
   * 「已记录 N 个待上传文件，演示版不会发送到外部存储。」，什么都不落库。
   */
  const serverWorks = useServerWorks({ pageSize: 50 })
  const serverLibrary = useLibraryAssets({ pageSize: 60 })
  const serverAssets = useMemo(() => serverWorks.works.map(workToAsset), [serverWorks.works])
  const libraryAssets = useMemo(() => serverLibrary.assets.map(libraryAssetToAsset), [serverLibrary.assets])
  // 服务端结果优先：后端已经有的结果不再显示重复的本地副本。
  const mergedAssets = useMemo(() => {
    if (state.backendStatus !== 'connected') return state.assets
    const seen = new Set<string>()
    const dedupe = (asset: Asset) => (seen.has(asset.src) ? false : (seen.add(asset.src), true))
    return [...libraryAssets, ...serverAssets].filter(dedupe)
  }, [libraryAssets, serverAssets, state.backendStatus])
  const visible = useMemo(() => mergedAssets.filter((asset) => {
    const definition = assetFilters.find((item) => item.value === filter)
    return (!definition?.kind || asset.kind === definition.kind)
      && `${asset.title} ${asset.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())
  }), [mergedAssets, filter, search])

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  /**
   * 真实上传。
   *
   * 流程：文件 → `/api/reference-assets`（persistent）→ 拿到服务器 key + url
   * → 登记到 `/api/library-assets`。两步都必须成功才算上传完成；
   * 任一步失败都如实报错，绝不显示成「已上传」。
   */
  async function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    if (state.backendStatus !== 'connected') {
      setNotice('未登录：无法上传素材。请先登录后再上传。')
      return
    }
    setUploading(true)
    setNotice(`正在上传 ${files.length} 个文件…`)
    const uploaded: string[] = []
    const failed: string[] = []
    for (const file of files) {
      try {
        const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image'
        const stored = await uploadPersistentAsset(file, kind)
        const size = kind === 'image' ? await readImageSize(file).catch(() => null) : null
        await createLibraryAsset({
          kind,
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || '未命名素材',
          tags: ['上传'],
          source: 'user-upload',
          data: {
            storageKey: stored.key,
            // 后端素材服务要求媒体必须已经保存到服务器，这里给的就是持久地址。
            serverUrl: stored.url,
            dataUrl: kind === 'image' ? stored.url : undefined,
            url: kind !== 'image' ? stored.url : undefined,
            bytes: stored.bytes,
            mimeType: stored.mimeType || file.type,
            ...(size ? { width: size.width, height: size.height } : {}),
          },
        })
        uploaded.push(file.name)
      } catch (reason) {
        failed.push(`${file.name}（${reason instanceof Error ? reason.message : '未知错误'}）`)
      }
    }
    // 上传完成后统一刷新账户数据（素材库是其中之一）。
    bumpAccountData()
    setNotice(
      failed.length
        ? `已上传 ${uploaded.length} 个，失败 ${failed.length} 个：${failed.join('；')}`
        : `已上传并保存 ${uploaded.length} 个素材，刷新或换浏览器都能看到。`,
    )
    setUploading(false)
  }

  /**
   * 加入项目。
   *
   * 真实写入项目画布（`addMediaToProject`），并对每个素材如实报告结果，
   * 而不是一句「已将 N 个素材加入「极光之后」」。
   */
  async function addToProject() {
    if (!state.selectedProjectId) { setNotice('还没有选择项目。请先到「项目」新建或选择一个项目。'); return }
    if (state.backendStatus !== 'connected') { setNotice('未登录：无法写入项目。'); return }
    const project = state.projects.find((item) => item.id === state.selectedProjectId)
    setProjectBusy(true)
    let added = 0
    let already = 0
    const failed: string[] = []
    for (const assetId of selected) {
      const asset = mergedAssets.find((item) => item.id === assetId)
      if (!asset?.src) { failed.push(`${asset?.title ?? assetId}（没有媒体地址）`); continue }
      try {
        const result = await addMediaToProject(state.selectedProjectId, {
          sourceId: asset.src,
          title: asset.title,
          kind: asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image',
          url: asset.src,
          poster: asset.poster,
        })
        if (result.alreadyPresent) already += 1
        else added += 1
      } catch (reason) {
        failed.push(`${asset.title}（${reason instanceof Error ? reason.message : '未知错误'}）`)
      }
    }
    setProjectBusy(false)
    setSelected([])
    const parts = [`已加入 ${added} 个到「${project?.title ?? state.selectedProjectId}」`]
    if (already) parts.push(`${already} 个此前已在项目中`)
    if (failed.length) parts.push(`失败 ${failed.length} 个：${failed.join('；')}`)
    setNotice(parts.join('，'))
  }

  /**
   * 删除素材。
   *
   * 两种删除严格区分（这是「不能误删其他项目仍在使用的素材」的落点）：
   *  - **移除项目引用**：只从画布删掉节点，文件保留，其他项目照常可用；
   *  - **删除素材**：删掉素材库记录；文件是否回收由后端按引用关系判断。
   */
  async function removeReference(assetId: string) {
    const asset = mergedAssets.find((item) => item.id === assetId)
    if (!asset?.src || !state.selectedProjectId) { setNotice('请先选择一个项目，再移除引用。'); return }
    setProjectBusy(true)
    try {
      const result = await removeMediaFromProject(state.selectedProjectId, asset.src)
      setNotice(result.removed
        ? `已从「${state.projects.find((item) => item.id === state.selectedProjectId)?.title ?? state.selectedProjectId}」移除引用；素材文件仍保留，其他项目可继续使用。`
        : '该项目本来就没有引用这个素材。')
    } catch (reason) {
      setNotice(`移除引用失败：${reason instanceof Error ? reason.message : '未知错误'}`)
    } finally {
      setProjectBusy(false)
    }
  }

  async function deleteAsset() {
    if (!deleteId) return
    const asset = mergedAssets.find((item) => item.id === deleteId)
    setDeleteId(null)
    if (!asset) return
    // 后端素材库记录才走删除接口；生成结果属于作品，不在素材库里删除。
    if (serverLibrary.assets.some((item) => item.id === asset.id)) {
      try {
        await deleteLibraryAsset(asset.id)
        bumpAccountData()
        setNotice(`已删除素材「${asset.title}」。`)
      } catch (reason) {
        setNotice(`删除失败：${reason instanceof Error ? reason.message : '未知错误'}`)
      }
      return
    }
    setNotice('生成结果属于「我的作品」，请在作品页删除。素材库里删除的是上传的素材。')
  }

  const deleteAssetView = mergedAssets.find((asset) => asset.id === deleteId)

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 py-5 sm:px-5 md:px-8 md:py-6 xl:px-10">
      <PageHeader
        eyebrow="资源库"
        title="素材"
        description="图片、视频、音频、角色和场景共享同一组资产 ID。"
        actions={(
          <>
            <input ref={fileRef} type="file" multiple className="sr-only" onChange={onFiles} disabled={uploading} />
            <ControlButton variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload className="size-4" />{uploading ? '上传中…' : '上传素材'}</ControlButton>
            {selected.length > 0 && <ControlButton variant="primary" disabled={projectBusy} onClick={() => void addToProject()}><FolderPlus className="size-4" />{projectBusy ? '处理中…' : `加入项目（${selected.length}）`}</ControlButton>}
            {selected.length > 0 && <ControlButton variant="ghost" disabled={projectBusy} onClick={() => void removeReference(selected[0])}>移除引用</ControlButton>}
          </>
        )}
      />
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-full sm:max-w-sm"><SearchField value={search} onChange={setSearch} placeholder="搜索素材、标签或引用位置" /></div>
          <div className="flex max-w-full gap-1 overflow-x-auto" data-mobile-scroll>
            {assetFilters.map((item) => <button type="button" key={item.value} onClick={() => setFilter(item.value)} className={filter === item.value ? 'h-8 shrink-0 rounded-lg bg-studio-accent/12 px-3 text-xs font-medium text-studio-accent' : 'h-8 shrink-0 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'}>{item.label}</button>)}
          </div>
        </div>
        <SegmentedControl value={view} onChange={setView} options={[{ value: 'grid', label: '缩略图', icon: <Grid2X2 className="size-3.5" /> }, { value: 'list', label: '列表', icon: <List className="size-3.5" /> }]} />
      </div>
      {notice && <Notice tone="accent"><Check className="mt-0.5 size-3.5 shrink-0" />{notice}</Notice>}
      {visible.length === 0 ? (
        <EmptyState title="没有找到素材" description="上传一个文件或更换当前筛选条件。" action={<ControlButton variant="primary" onClick={() => fileRef.current?.click()}><Upload className="size-3.5" />上传素材</ControlButton>} />
      ) : view === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selected.includes(asset.id)} onToggle={() => toggle(asset.id)} onDelete={() => setDeleteId(asset.id)} />)}
        </div>
      ) : (
        <div className="flex flex-col studio-surface">
          {visible.map((asset) => (
            <div key={asset.id} className="flex min-w-0 items-center gap-3 border-b border-border p-3 last:border-b-0">
              <input type="checkbox" checked={selected.includes(asset.id)} onChange={() => toggle(asset.id)} className="size-4 shrink-0 accent-studio-accent" aria-label={`选择 ${asset.title}`} />
              <span className="flex size-10 shrink-0 items-center justify-center bg-muted text-muted-foreground">{assetIcon(asset.kind)}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{asset.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{asset.tags.join(' · ')}</p></div>
              <span className="hidden text-xs text-muted-foreground sm:block">{asset.size}</span>
              <StatusBadge tone={asset.status === '处理中' ? 'accent' : 'neutral'}>{asset.status}</StatusBadge>
              <AssetMenu title={asset.title} onDelete={() => setDeleteId(asset.id)} />
            </div>
          ))}
        </div>
      )}
      <Modal
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        title="删除素材"
        description={deleteAssetView?.title}
        footer={(
          <>
            <ControlButton variant="ghost" onClick={() => setDeleteId(null)}>取消</ControlButton>
            <ControlButton variant="danger" onClick={() => void deleteAsset()}>确认删除</ControlButton>
          </>
        )}
      >
        <Notice tone="warning">
          这里删除的是**素材库记录**；素材文件若仍被其他项目引用，后端会保留文件，不会影响那些项目。
          只想解除本项目的使用请用「移除引用」。
        </Notice>
      </Modal>
    </div>
  )
}

function AssetCard({ asset, selected, onToggle, onDelete }: {
  asset: ReturnType<typeof useStudio>['state']['assets'][number]
  selected: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <article className={selected ? 'studio-surface overflow-hidden border-2 border-studio-accent shadow-sm' : 'studio-surface studio-surface-interactive overflow-hidden'}>
      <div className="relative">
        <label className="absolute left-2 top-2 z-10"><input type="checkbox" checked={selected} onChange={onToggle} className="size-4 accent-studio-accent" aria-label={`选择 ${asset.title}`} /></label>
        <MediaThumb src={asset.src} poster={asset.poster} kind={asset.kind === 'video' ? 'video' : 'image'} alt={asset.title} fallback={asset.fallback} className="aspect-[4/3]" overlay={asset.kind === 'video' ? <span className="absolute bottom-2 left-2 rounded bg-studio-ink/65 px-1.5 py-0.5 text-[10px] text-studio-ink-foreground"><Play className="mr-1 inline size-3" />{asset.duration}</span> : undefined} />
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{asset.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{asset.dimensions ?? asset.duration ?? asset.size}</p></div><AssetMenu title={asset.title} onDelete={onDelete} /></div>
        <div className="mt-3 flex flex-wrap gap-1">{asset.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>)}</div>
        <div className="mt-3 flex items-center justify-between gap-2"><StatusBadge tone={asset.status === '处理中' ? 'accent' : 'neutral'}>{asset.status}</StatusBadge><span className="truncate text-[10px] text-muted-foreground">{asset.referencedBy.length ? `${asset.referencedBy.length} 处引用` : '未引用'}</span></div>
      </div>
    </article>
  )
}

function AssetMenu({ title, onDelete }: { title: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <IconAction label={`${title} 的更多操作`} onClick={() => setOpen((current) => !current)}>
        <MoreHorizontal />
      </IconAction>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-28 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
            删除素材
          </button>
        </div>
      )}
    </div>
  )
}

const taskFilters: Array<{ value: string; label: string; statuses?: TaskStatus[] }> = [
  { value: '全部', label: '全部' },
  { value: 'active', label: '进行中', statuses: ['queued', 'processing'] },
  { value: 'completed', label: '完成', statuses: ['completed'] },
  { value: 'failed', label: '失败', statuses: ['failed'] },
  { value: 'cancelled', label: '取消', statuses: ['cancelled'] },
]

const taskDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTaskDate(timestamp: number) {
  return taskDateFormatter.format(timestamp)
}

function TaskTypeIcon({ task }: { task: Task }) {
  if (task.type === 'video') return <Video className="size-5" />
  if (task.type === 'image') return <ImageIcon className="size-5" />
  return <WandSparkles className="size-5" />
}

export function TasksPage() {
  const { state, liveReady } = useStudio()
  const generation = useGeneration()
  const router = useRouter()
  const [filter, setFilter] = useState('全部')
  const [search, setSearch] = useState('')
  const [liveFilter, setLiveFilter] = useState<'all' | 'active' | 'success' | 'error'>('all')
  // 历史任务从服务端分页读取；本地只保留最近任务的轮询状态用于实时进度。
  const history = useServerHistory({ pageSize: 24 })

  // 后端可用时任务列表来自真实接口，只保留本页的筛选与搜索。
  if (liveReady) {
    const filtered = generation.tasks.filter((task) => {
      if (liveFilter === 'active' && !['pending', 'running', 'paused'].includes(task.status)) return false
      if (liveFilter === 'success' && task.status !== 'success') return false
      if (liveFilter === 'error' && !['error', 'cancelled'].includes(task.status)) return false
      if (!search.trim()) return true
      return `${task.title} ${task.prompt} ${task.model}`.toLowerCase().includes(search.trim().toLowerCase())
    })
    const historyFiltered = history.items.filter((item) => {
      if (liveFilter === 'active') return false
      if (liveFilter === 'success' && item.status !== 'success') return false
      if (liveFilter === 'error' && !['error', 'cancelled', 'failed'].includes(item.status)) return false
      if (!search.trim()) return true
      return `${item.title} ${item.prompt} ${item.model ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
    })
    const refreshAll = () => {
      void generation.refresh()
      void history.reload()
    }
    return (
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-5 md:px-8 md:py-6 xl:px-10">
        <PageHeader
          eyebrow="工作区"
          title="任务"
          description="进行中的任务来自后端实时状态，历史记录由服务端分页提供；刷新或换浏览器后仍可恢复。"
          actions={
            <ControlButton variant="secondary" size="sm" onClick={refreshAll} disabled={generation.loading || history.state === 'loading'}>
              <RefreshCw className={cn('size-3.5', (generation.loading || history.state === 'loading') && 'animate-spin')} />刷新状态
            </ControlButton>
          }
        />
        <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex max-w-full gap-1 overflow-x-auto" data-mobile-scroll>
            {([['all', '全部'], ['active', '进行中'], ['success', '已完成'], ['error', '失败或取消']] as const).map(([value, label]) => (
              <button type="button" key={value} onClick={() => setLiveFilter(value)} className={liveFilter === value ? 'h-8 shrink-0 rounded-lg bg-studio-accent/12 px-3 text-xs font-medium text-studio-accent' : 'h-8 shrink-0 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'}>
                {label}
                <span className="ml-1 opacity-60">{value === 'all' ? generation.tasks.length + history.total : generation.tasks.filter((task) => value === 'active' ? ['pending', 'running', 'paused'].includes(task.status) : value === 'success' ? task.status === 'success' : ['error', 'cancelled'].includes(task.status)).length}</span>
              </button>
            ))}
          </div>
          <div className="w-full md:max-w-xs"><SearchField value={search} onChange={setSearch} placeholder="搜索任务" /></div>
        </div>

        <GenerationErrorNotice />
        <QueryUnavailableNotice />
        <GenerationNotice />
        {history.message && <Notice tone="warning"><span className="min-w-0 flex-1">历史记录暂时无法读取：{history.message}</span><button type="button" onClick={() => void history.reload()} className="shrink-0 text-[11px] underline">重试</button></Notice>}

        {filtered.length === 0 && historyFiltered.length === 0 ? (
          <EmptyState title={generation.loading || history.state === 'loading' ? '正在读取后端任务' : '没有符合条件的任务'} description={generation.loading || history.state === 'loading' ? '正在从后端拉取任务状态。' : '在图片或视频工作台提交生成后，任务会出现在这里。'} />
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-foreground">进行中的任务</h2>
                {filtered.map((task) => <GenerationTaskCard key={task.id} task={task} />)}
              </section>
            )}
            {historyFiltered.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-foreground">历史记录（服务端共 {history.total} 条）</h2>
                {historyFiltered.map((item) => <HistoryTaskCard key={item.id} item={item} />)}
                {history.hasMore && (
                  <ControlButton variant="secondary" onClick={() => void history.loadMore()} disabled={history.loadingMore}>
                    {history.loadingMore ? '正在加载…' : `加载更多（已显示 ${history.items.length}/${history.total}）`}
                  </ControlButton>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    )
  }

  return <LocalTasksPage />
}

/** 服务端历史任务卡片：展示状态、模型、耗时、结果与失败原因。 */
function HistoryTaskCard({ item }: { item: GenerationHistoryItem }) {
  const router = useRouter()
  const { state } = useStudio()
  const meta = item.status === 'success' ? { label: '已完成', tone: 'success' as const } : item.status === 'error' || item.status === 'failed' ? { label: '失败', tone: 'warning' as const } : item.status === 'cancelled' ? { label: '已取消', tone: 'muted' as const } : { label: item.status || '未知', tone: 'accent' as const }
  const kindLabel = item.kind === 'video' ? '视频' : item.kind === 'audio' ? '音频' : item.kind === 'text' ? '文本' : '图片'
  const firstAsset = item.assets[0]

  function download() {
    if (!firstAsset?.url) return
    const anchor = document.createElement('a')
    anchor.href = firstAsset.url
    anchor.download = `${item.title}.${item.kind === 'video' ? 'mp4' : item.kind === 'audio' ? 'mp3' : 'png'}`
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  /** 复用参数：把历史记录带回对应工作台。 */
  function reuse() {
    try {
      window.localStorage.setItem('oaooao-reuse-params', JSON.stringify({ kind: item.kind, prompt: item.prompt, model: item.model, taskId: item.taskId ?? item.id, createdAt: Date.now() }))
    } catch {
      // 存储不可用时仍可跳转工作台。
    }
  }

  return (
    <article className="studio-surface flex flex-col gap-3 p-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {kindLabel} · {item.model || '未记录模型'}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}` : ''}{item.durationMs ? ` · 耗时 ${Math.round(item.durationMs / 1000)} 秒` : ''}
          </p>
        </div>
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
      </header>
      {item.assets.length > 0 && (
        <div className={cn('grid gap-2', item.assets.length > 1 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:max-w-xs')}>
          {item.assets.slice(0, 4).map((asset, index) => (
            <MediaThumb key={`${asset.url}-${index}`} src={asset.url} poster={asset.poster} alt={`${item.title} 结果 ${index + 1}`} fallback="结果未能加载" kind={item.kind === 'video' ? 'video' : 'image'} className="h-28 rounded-md" />
          ))}
        </div>
      )}
      {item.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-5 text-destructive" role="alert">失败原因：{item.error}</p>}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        {firstAsset?.url && <ControlButton variant="ghost" size="sm" onClick={download}><Download className="size-3.5" />下载结果</ControlButton>}
        <Link href={item.kind === 'video' ? '/video' : item.kind === 'audio' ? '/image' : '/image'} onClick={reuse} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Copy className="size-3.5" />复用参数</Link>
        <ControlButton variant="ghost" size="sm" onClick={() => router.push('/works')}>在我的作品中查看</ControlButton>
        {state.backendStatus !== 'connected' && <span className="text-[11px] text-muted-foreground">登录后可继续操作</span>}
      </div>
    </article>
  )
}

/** 未登录或后端不可用时的本地预览任务页，明确标注为本地预览。 */
function LocalTasksPage() {
  const { state, dispatch } = useStudio()
  const router = useRouter()
  const [filter, setFilter] = useState('全部')
  const [search, setSearch] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const definition = taskFilters.find((item) => item.value === filter)
  const visible = state.tasks.filter((task) => (!definition?.statuses || definition.statuses.includes(task.status)) && task.title.toLowerCase().includes(search.toLowerCase()))
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? null
  const selectedResult = selectedTask?.resultAssetIds.map((id) => state.assets.find((asset) => asset.id === id)).find(Boolean)
  const selectedProject = state.projects.find((project) => project.id === selectedTask?.projectId)

  function reuseTask(task: Task) {
    router.push(task.type === 'video' ? '/video' : task.type === 'image' ? '/image' : task.projectId ? `/projects/${task.projectId}/storyboard` : '/projects')
  }

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-5 md:px-8 md:py-6 xl:px-10">
      <PageHeader
        eyebrow="工作区"
        title="任务"
        description="当前为本地预览任务，未提交到后端。登录后可查看真实生成记录。"
        actions={<ControlButton variant="secondary" size="sm" onClick={() => dispatch({ type: 'TICK_TASKS' })}><RefreshCw className="size-3.5" />刷新状态</ControlButton>}
      />
      <LocalPreviewNotice what="任务记录" />
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-full gap-1 overflow-x-auto" data-mobile-scroll>
          {taskFilters.map((item) => (
            <button type="button" key={item.value} onClick={() => setFilter(item.value)} className={filter === item.value ? 'h-8 shrink-0 rounded-lg bg-studio-accent/12 px-3 text-xs font-medium text-studio-accent' : 'h-8 shrink-0 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'}>
              {item.label}<span className="ml-1 opacity-60">{item.statuses ? state.tasks.filter((task) => item.statuses?.includes(task.status)).length : state.tasks.length}</span>
            </button>
          ))}
        </div>
        <div className="w-full md:max-w-xs"><SearchField value={search} onChange={setSearch} placeholder="搜索任务" /></div>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="没有符合条件的任务" description="尝试切换任务状态或清空搜索词。" />
      ) : (
        <div className="studio-surface overflow-hidden">
          <div className="hidden grid-cols-[56px_minmax(0,1.6fr)_minmax(100px,.7fr)_minmax(120px,.8fr)_100px_170px] gap-3 border-b border-border bg-muted/35 px-4 py-2.5 text-[10px] font-medium text-muted-foreground sm:grid">
            <span aria-hidden="true" />
            <span>任务</span>
            <span>模型</span>
            <span>参数</span>
            <span>积分</span>
            <span className="text-right">操作</span>
          </div>
          {visible.map((task) => {
            const result = task.resultAssetIds.map((id) => state.assets.find((asset) => asset.id === id)).find(Boolean)
            const project = state.projects.find((item) => item.id === task.projectId)
            return (
              <article key={task.id} className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 p-3 last:border-b-0 sm:grid-cols-[56px_minmax(0,1.6fr)_minmax(100px,.7fr)_minmax(120px,.8fr)_100px_170px] sm:px-4">
                <button type="button" onClick={() => setSelectedTaskId(task.id)} className="relative size-12 shrink-0 overflow-hidden bg-muted text-left sm:size-14">
                  {result || project ? <MediaThumb src={result?.src ?? project?.cover} poster={result?.poster} kind={result?.kind === 'video' ? 'video' : 'image'} alt={task.title} fallback={task.title} className="size-full" /> : <span className="flex size-full items-center justify-center text-muted-foreground"><TaskTypeIcon task={task} /></span>}
                  {(task.status === 'queued' || task.status === 'processing') && <span className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-studio-ink/25"><span className="studio-waiting block h-full w-1/3 bg-studio-accent" /></span>}
                </button>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <button type="button" onClick={() => setSelectedTaskId(task.id)} className="min-w-0 truncate text-left text-sm font-semibold text-foreground hover:text-studio-accent">{task.title}</button>
                    <StatusBadge className="hidden shrink-0 sm:inline-flex" tone={getTaskTone(task.status)}>{getTaskLabel(task.status)}</StatusBadge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{task.stage} · {formatTaskDate(task.createdAt)}</p>
                  {task.status === 'failed' && task.error && <p className="mt-1 truncate text-[11px] text-studio-warn" title={task.error}>{task.error}</p>}
                </div>
                <div className="hidden min-w-0 sm:block"><p className="truncate text-xs font-medium text-foreground">{task.settings.modelId}</p><p className="mt-1 text-[10px] text-muted-foreground">生成模型</p></div>
                <div className="hidden min-w-0 sm:block"><p className="truncate text-xs font-medium text-foreground">{task.settings.ratio}{task.settings.duration ? ` · ${task.settings.duration}` : ''}</p><p className="mt-1 text-[10px] text-muted-foreground">输出参数</p></div>
                <div className="hidden text-xs sm:block"><p className="font-medium text-foreground">{task.actualCredits ?? task.expectedCredits}</p><p className="mt-1 text-[10px] text-muted-foreground">{task.actualCredits == null ? '预计积分' : '实际积分'}</p></div>
                <div className="col-span-1 flex flex-wrap items-center justify-end gap-1.5 sm:col-span-1">
                  <StatusBadge className="sm:hidden" tone={getTaskTone(task.status)}>{getTaskLabel(task.status)}</StatusBadge>
                  {task.status === 'failed' ? <ControlButton variant="danger" size="sm" onClick={() => dispatch({ type: 'RETRY_TASK', taskId: task.id })}><RefreshCw className="size-3.5" />重试</ControlButton> : <ControlButton variant="ghost" size="sm" onClick={() => setSelectedTaskId(task.id)}>查看</ControlButton>}
                  <ControlButton variant="ghost" size="sm" onClick={() => reuseTask(task)}><Copy className="size-3.5" />复用</ControlButton>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <Modal
        open={Boolean(selectedTask)}
        onClose={() => setSelectedTaskId(null)}
        title="任务详情"
        description={selectedTask?.title}
        footer={selectedTask ? (
          <>
            <ControlButton variant="ghost" onClick={() => setSelectedTaskId(null)}>关闭</ControlButton>
            {selectedTask.status === 'failed' && <ControlButton variant="danger" onClick={() => dispatch({ type: 'RETRY_TASK', taskId: selectedTask.id })}><RefreshCw className="size-3.5" />重试</ControlButton>}
            <ControlButton variant="secondary" onClick={() => reuseTask(selectedTask)}><Copy className="size-3.5" />复用参数</ControlButton>
            {selectedTask.status === 'completed' && <ControlButton variant="primary" onClick={() => router.push('/works')}>查看结果</ControlButton>}
          </>
        ) : undefined}
      >
        {selectedTask && (
          <div className="flex flex-col gap-4">
            <div className="aspect-video overflow-hidden bg-muted">
              {selectedResult || selectedProject ? <MediaThumb src={selectedResult?.src ?? selectedProject?.cover} poster={selectedResult?.poster} kind={selectedResult?.kind === 'video' ? 'video' : 'image'} alt={selectedTask.title} fallback={selectedTask.title} className="size-full" /> : <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"><TaskTypeIcon task={selectedTask} /><span className="text-xs">暂无结果预览</span></div>}
            </div>
            <div className="flex items-center justify-between gap-3"><StatusBadge tone={getTaskTone(selectedTask.status)}>{getTaskLabel(selectedTask.status)}</StatusBadge><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{formatTaskDate(selectedTask.createdAt)}</span></div>
            <div className="border-y border-border">
              <KeyValue label="模型" value={selectedTask.settings.modelId} />
              <KeyValue label="比例 / 清晰度" value={`${selectedTask.settings.ratio} · ${selectedTask.settings.quality}`} />
              {selectedTask.settings.duration && <KeyValue label="时长" value={selectedTask.settings.duration} />}
              {selectedTask.settings.count && <KeyValue label="生成数量" value={`${selectedTask.settings.count} 张`} />}
              <KeyValue label="预计 / 实际积分" value={`${selectedTask.expectedCredits} / ${selectedTask.actualCredits ?? '待结算'}`} />
              <KeyValue label="重试次数" value={selectedTask.retryCount} />
            </div>
            <div><p className="text-xs font-medium text-muted-foreground">创作描述</p><p className="mt-2 text-sm leading-6 text-foreground">{selectedTask.input}</p></div>
            {selectedTask.error && <Notice tone="warning">{selectedTask.error}</Notice>}
          </div>
        )}
      </Modal>
    </div>
  )
}
