'use client'

import { MediaDownloadButton } from './media-download-button'

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
  LoaderCircle,
  MoreHorizontal,
  Pencil,
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
  FilterChips,
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
  renameGenerationLog,
  renameLibraryAsset,
  readImageSize,
  uploadPersistentAsset,
  type GenerationHistoryItem,
  type LibraryAssetView,
  type StudioWork,
} from '@/lib/studio/account-api'
import { useServerHistory, useServerWorks } from '@/lib/studio/use-account-data'
import { useMediaLibrary } from '@/lib/studio/use-media-library'
import { bumpAccountData } from '@/lib/studio/account-data-sync'
import { addMediaToProject, removeMediaFromProject } from '@/lib/studio/project-media'
import { cn } from '@/lib/utils'
import { writeReuseParams } from '@/lib/studio/reuse-params'
import type { AssetCategory, AssetKind, Asset, Task, TaskStatus } from '@/lib/studio/types'
import { assetCategoryLabels, assetCategoryOf } from '@/lib/studio/reference-assets'

const assetFilters: Array<{ value: string; label: string; kind?: AssetKind | AssetCategory }> = [
  { value: '全部', label: '全部' },
  { value: 'image', label: '图片', kind: 'image' },
  { value: 'video', label: '视频', kind: 'video' },
  { value: 'audio', label: '音频', kind: 'audio' },
  { value: 'character', label: '角色', kind: 'character' },
  { value: 'scene', label: '场景', kind: 'scene' },
  { value: 'prop', label: '道具', kind: 'prop' },
  { value: 'style', label: '风格', kind: 'style' },
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
    category: assetCategoryOf(record),
    title: record.title,
    src,
    poster: record.kind === 'video' ? record.coverUrl : undefined,
    fallback: record.coverUrl ?? src,
    dimensions: data.width && data.height ? `${data.width}×${data.height}` : undefined,
    tags: record.tags?.length ? record.tags : [record.source === 'agent' ? 'Agent 生成' : '素材'],
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
    category: work.category ?? 'general',
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
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameSource, setRenameSource] = useState<'library' | 'generation'>('library')
  const [renameTitle, setRenameTitle] = useState('')
  const [renameCategory, setRenameCategory] = useState<AssetCategory>('general')
  const [renaming, setRenaming] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadCategory, setUploadCategory] = useState<AssetCategory>('general')
  const [projectBusy, setProjectBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  /**
   * 素材来源 = 后端素材库（真实上传与落库）+ 后端生成作品。
   *
   * 早先这里只有「后端生成结果」+ 本地演示素材：上传只提示
   * 「已记录 N 个待上传文件，演示版不会发送到外部存储。」，什么都不落库。
   */
  const serverWorks = useServerWorks({ pageSize: 50 })
  const serverLibrary = useMediaLibrary()
  const serverAssets = useMemo(() => serverWorks.works.map(workToAsset), [serverWorks.works])
  const libraryAssets = useMemo(() => serverLibrary.assets.map(libraryAssetToAsset), [serverLibrary.assets])
  // 服务端结果优先：后端已经有的结果不再显示重复的本地副本。
  const mergedAssets = useMemo(() => {
    if (state.backendStatus !== 'connected') return state.assets
    const seen = new Set<string>()
    const dedupe = (asset: Asset) => { const key = asset.src || `id:${asset.id}`; return seen.has(key) ? false : (seen.add(key), true) }
    return [...libraryAssets, ...serverAssets].filter(dedupe)
  }, [libraryAssets, serverAssets, state.backendStatus, state.assets])
  const visible = useMemo(() => mergedAssets.filter((asset) => {
    const definition = assetFilters.find((item) => item.value === filter)
    const categoryMatch = definition?.kind === 'character' || definition?.kind === 'scene' || definition?.kind === 'prop' || definition?.kind === 'style'
      ? (asset.category ?? asset.kind) === definition.kind
      : !definition?.kind || asset.kind === definition.kind
    return categoryMatch
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
  function uploadKind(file: File): 'image' | 'video' | 'audio' | null {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('audio/')) return 'audio'
    if (/\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|ogg|m4a)$/i.test(file.name)) {
      if (/\.(mp4|webm|mov|m4v)$/i.test(file.name)) return 'video'
      if (/\.(mp3|wav|ogg|m4a)$/i.test(file.name)) return 'audio'
      return 'image'
    }
    return null
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return
    if (uploading) return
    if (state.backendStatus !== 'connected') {
      setNotice('未登录：无法上传素材。请先登录后再上传。')
      return
    }
    const supported = files.filter((file) => uploadKind(file))
    const rejected = files.filter((file) => !uploadKind(file)).map((file) => file.name)
    if (rejected.length) setNotice(`已忽略 ${rejected.length} 个不支持的文件：${rejected.join('、')}。支持 PNG、JPG、WEBP、GIF、MP4、WEBM、MOV、MP3、WAV、OGG。`)
    if (!supported.length) return
    setUploading(true)
    setNotice(`正在上传 ${supported.length} 个文件…`)
    const uploaded: string[] = []
    const failed: string[] = []
    for (const file of supported) {
      try {
        const kind = uploadKind(file)
        if (!kind) throw new Error('文件类型不受支持')
        const stored = await uploadPersistentAsset(file, kind)
        const size = kind === 'image' ? await readImageSize(file).catch(() => null) : null
        await createLibraryAsset({
          kind,
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || '未命名素材',
          tags: uploadCategory === 'general' ? ['上传'] : ['上传', assetCategoryLabels[uploadCategory]],
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
            assetRole: uploadCategory,
          },
        })
        uploaded.push(file.name)
      } catch (reason) {
        failed.push(`${file.name}（${reason instanceof Error ? reason.message : '未知错误'}）`)
      }
    }
    // 上传完成后统一刷新账户数据（素材库是其中之一）。
    bumpAccountData()
    await serverLibrary.reload()
    const rejectedDetails = rejected.map((name) => `${name}（文件类型不受支持）`)
    const issues = [...failed, ...rejectedDetails]
    setNotice(
      issues.length
        ? `已上传 ${uploaded.length} 个，失败 ${issues.length} 个：${issues.join('；')}`
        : `已上传并保存 ${uploaded.length} 个素材，素材库已刷新。`,
    )
    setUploading(false)
  }

  function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    void uploadFiles(files)
  }

  function onDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragActive(false)
    void uploadFiles(Array.from(event.dataTransfer.files ?? []))
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

  async function renameAsset() {
    if (!renameId || !renameTitle.trim()) return
    setRenaming(true)
    try {
      if (renameSource === 'generation') {
        const rawId = renameId.startsWith('generated-') ? renameId.slice('generated-'.length) : renameId
        const separator = rawId.lastIndexOf('-')
        await renameGenerationLog(separator > 0 ? rawId.slice(0, separator) : rawId, renameTitle, renameCategory)
        await serverWorks.reload()
      } else {
        await renameLibraryAsset(renameId, renameTitle, renameCategory)
        await serverLibrary.reload()
      }
      bumpAccountData()
      setRenameId(null)
      setNotice('素材名称和分类已更新。')
    } catch (reason) {
      setNotice(`重命名失败：${reason instanceof Error ? reason.message : '未知错误'}`)
    } finally {
      setRenaming(false)
    }
  }

  function openRename(asset: Asset) {
    setRenameId(asset.id)
    setRenameSource(serverLibrary.assets.some((item) => item.id === asset.id) ? 'library' : 'generation')
    setRenameTitle(asset.title)
    setRenameCategory(asset.category ?? 'general')
  }

  const deleteAssetView = mergedAssets.find((asset) => asset.id === deleteId)

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 py-5 sm:px-5 md:px-8 md:py-6 xl:px-10">
      <PageHeader
        eyebrow="资源库"
        title="素材"
        description="管理图片、视频与音频素材；文本技能请前往技能库。"
        actions={(
          <>
            <Link href="/skills" className="inline-flex h-9 items-center px-3 text-sm text-muted-foreground underline">技能库</Link>
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,audio/mp4" className="sr-only" onChange={onFiles} disabled={uploading} />
            <ControlButton variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload className="size-4" />{uploading ? '上传中…' : '上传素材'}</ControlButton>
            {selected.length > 0 && <ControlButton variant="primary" disabled={projectBusy} onClick={() => void addToProject()}><FolderPlus className="size-4" />{projectBusy ? '处理中…' : `加入项目（${selected.length}）`}</ControlButton>}
            {selected.length > 0 && <ControlButton variant="ghost" disabled={projectBusy} onClick={() => void removeReference(selected[0])}>移除引用</ControlButton>}
          </>
        )}
      />
      <section
        aria-label="上传素材"
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
        onDrop={onDrop}
        className={cn('rounded-xl border-2 border-dashed p-5 text-center transition-colors', dragActive ? 'border-studio-accent bg-studio-accent/10' : 'border-border bg-muted/20 hover:border-studio-accent/50')}
      >
        <Upload className="mx-auto size-6 text-studio-accent" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-foreground">拖拽文件到这里，或点击选择</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">支持 PNG、JPG、WEBP、GIF、MP4、WEBM、MOV、MP3、WAV、OGG，可一次选择多个文件。</p>
        <ControlButton type="button" variant="secondary" size="sm" className="mt-3" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload className="size-3.5" />{uploading ? '上传中…' : '选择文件'}</ControlButton>
      </section>
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-full sm:max-w-sm"><SearchField value={search} onChange={setSearch} placeholder="搜索素材、标签或引用位置" /></div>
          <FilterChips value={filter} onChange={setFilter} options={assetFilters} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted/20 px-2.5 py-1.5">
            <span className="text-xs font-medium text-foreground">上传时默认分类</span>
            <span className="text-[10px] leading-4 text-muted-foreground">用于下一次上传；已有素材请点卡片标题旁的铅笔，在“素材分类”中修改。</span>
          </div>
          <FilterChips value={uploadCategory} onChange={(value) => setUploadCategory(value as AssetCategory)} options={Object.entries(assetCategoryLabels).map(([value, label]) => ({ value, label }))} />
          <SegmentedControl value={view} onChange={setView} options={[{ value: 'grid', label: '缩略图', icon: <Grid2X2 className="size-3.5" /> }, { value: 'list', label: '列表', icon: <List className="size-3.5" /> }]} />
        </div>
      </div>
      {notice && <Notice tone="accent"><Check className="mt-0.5 size-3.5 shrink-0" />{notice}</Notice>}
      {/*
        素材库读取失败必须如实说明。
        `useLibraryAssets` 一直提供 state/message，但这里此前没有读取它们，
        于是素材库接口失败时页面只剩"生成结果"，
        用户会以为"素材都没了"——把失败伪装成了空数据。
      */}
      {(serverLibrary.state === 'error' || serverLibrary.message) && (
        <Notice tone="warning">
          <span className="min-w-0 flex-1">素材库读取失败：{serverLibrary.message || '请稍后重试'}。下方仅显示已获取到的内容。</span>
          <button type="button" onClick={() => void serverLibrary.reload()} className="shrink-0 text-[11px] underline">重试</button>
        </Notice>
      )}
      {serverWorks.message && <Notice tone="warning">生成结果读取失败：{serverWorks.message}。下方仅显示已获取到的内容。</Notice>}
      {serverWorks.truncated && <Notice tone="neutral">生成结果较多，当前仅载入最近一批。</Notice>}
      <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
        当前筛选显示 {visible.length} 项。已载入素材库媒体 {libraryAssets.length} 项{serverLibrary.totalKnown ? ` / 共 ${serverLibrary.total} 项` : '（总数尚未确认）'}，生成结果 {serverAssets.length} 项；重复地址合并显示。
        {(serverLibrary.hasMore || serverWorks.truncated) && '搜索与筛选仅针对已载入内容。'}
      </p>
      {/* 首次读取素材库时给出加载反馈（此前完全没有提示，页面看起来像"已经空了"）。 */}
      {serverLibrary.state === 'loading' && serverLibrary.assets.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />正在读取素材库…
        </p>
      )}
      {visible.length === 0 && (serverLibrary.state === 'loading' || serverWorks.state === 'loading') ? null : visible.length === 0 ? (
        <EmptyState
          title={serverLibrary.state === 'error' ? '素材库暂时无法读取' : '没有找到素材'}
          description={serverLibrary.state === 'error' ? '当前无法读取素材库，请稍后重试。' : serverLibrary.hasMore ? '已载入内容中没有匹配素材，可继续加载更多或更换筛选条件。' : '上传一个文件或更换当前筛选条件；文本技能在技能库管理。'}
          action={<ControlButton variant="primary" onClick={() => fileRef.current?.click()}><Upload className="size-3.5" />上传素材</ControlButton>}
        />
      ) : view === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selected.includes(asset.id)} onToggle={() => toggle(asset.id)} onDelete={() => setDeleteId(asset.id)} onRename={() => openRename(asset)} />)}
        </div>
      ) : (
        <div className="flex flex-col studio-surface">
          {visible.map((asset) => (
            <div key={asset.id} className="flex min-w-0 items-center gap-3 border-b border-border p-3 last:border-b-0">
              <input type="checkbox" checked={selected.includes(asset.id)} onChange={() => toggle(asset.id)} className="size-4 shrink-0 accent-studio-accent" aria-label={`选择 ${asset.title}`} />
              <span className="flex size-10 shrink-0 items-center justify-center bg-muted text-muted-foreground">{assetIcon(asset.kind)}</span>
              <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1"><p className="truncate text-sm font-medium text-foreground">{asset.title}</p><button type="button" onClick={() => openRename(asset)} aria-label={`编辑 ${asset.title}`} title="编辑素材" className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" aria-hidden="true" /></button></div><p className="mt-1 truncate text-xs text-muted-foreground">{asset.tags.join(' · ')}</p></div>
              <span className="hidden text-xs text-muted-foreground sm:block">{asset.size}</span>
              <StatusBadge tone={asset.status === '处理中' ? 'accent' : 'neutral'}>{asset.status}</StatusBadge>
              <AssetMenu title={asset.title} onDelete={() => setDeleteId(asset.id)} onRename={() => openRename(asset)} />
            </div>
          ))}
        </div>
      )}
      {serverLibrary.hasMore && <div className="flex justify-center"><ControlButton variant="secondary" onClick={() => void serverLibrary.loadMore()} disabled={serverLibrary.loadingMore || serverLibrary.state === 'loading'}>{serverLibrary.loadingMore ? '正在加载…' : '加载更多素材'}</ControlButton></div>}
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
          这里删除的是**素材库记录**；素材文件若仍被其他项目引用，系统会保留文件，不会影响那些项目。
          只想解除本项目的使用请用「移除引用」。
        </Notice>
      </Modal>
      <Modal
        open={Boolean(renameId)}
        onClose={() => { if (!renaming) setRenameId(null) }}
        title={renameSource === 'generation' ? '编辑生成资产' : '编辑素材'}
        description={renameSource === 'generation' ? '修改生成结果的显示名称和素材分类，结果媒体与任务参数保持不变。' : '修改素材名称和分类，媒体文件本身保持不变。'}
        footer={(
          <>
            <ControlButton variant="ghost" disabled={renaming} onClick={() => setRenameId(null)}>取消</ControlButton>
            <ControlButton variant="primary" disabled={renaming || !renameTitle.trim()} onClick={() => void renameAsset()}>{renaming ? '保存中…' : '保存修改'}</ControlButton>
          </>
        )}
      >
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          名称
          <input autoFocus value={renameTitle} maxLength={250} onChange={(event) => setRenameTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void renameAsset() } }} className="studio-field w-full border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15" />
        </label>
        <label className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
          素材分类
          <select value={renameCategory} onChange={(event) => setRenameCategory(event.target.value as AssetCategory)} className="studio-field w-full border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15">
            {Object.entries(assetCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="text-[11px] leading-4 text-muted-foreground">分类会保存到素材库，用于筛选和后续选择参考素材。</span>
        </label>
      </Modal>
    </div>
  )
}

function AssetCard({ asset, selected, onToggle, onDelete, onRename }: {
  asset: ReturnType<typeof useStudio>['state']['assets'][number]
  selected: boolean
  onToggle: () => void
  onDelete: () => void
  onRename?: () => void
}) {
  return (
    <article className={selected ? 'studio-surface overflow-hidden border-2 border-studio-accent shadow-sm' : 'studio-surface studio-surface-interactive overflow-hidden'}>
      <div className="relative">
        <label className="absolute left-2 top-2 z-10"><input type="checkbox" checked={selected} onChange={onToggle} className="size-4 accent-studio-accent" aria-label={`选择 ${asset.title}`} /></label>
        <MediaThumb src={asset.src} poster={asset.poster} kind={asset.kind === 'video' ? 'video' : 'image'} alt={asset.title} fallback={asset.fallback} className="aspect-[4/3]" overlay={asset.kind === 'video' ? <span className="absolute bottom-2 left-2 rounded bg-studio-ink/65 px-1.5 py-0.5 text-[10px] text-studio-ink-foreground"><Play className="mr-1 inline size-3" />{asset.duration}</span> : undefined} />
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex min-w-0 items-center gap-1"><p className="truncate text-sm font-medium text-foreground">{asset.title}</p>{onRename && <button type="button" onClick={onRename} aria-label={`重命名 ${asset.title}`} title="重命名" className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" aria-hidden="true" /></button>}</div><p className="mt-1 text-[11px] text-muted-foreground">{asset.dimensions ?? asset.duration ?? asset.size}</p></div><AssetMenu title={asset.title} onDelete={onDelete} onRename={onRename} /></div>
        <div className="mt-3 flex flex-wrap gap-1">{[asset.category && asset.category !== 'general' ? assetCategoryLabels[asset.category] : '', ...asset.tags].filter(Boolean).slice(0, 3).map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>)}</div>
        <div className="mt-3 flex items-center justify-between gap-2"><StatusBadge tone={asset.status === '处理中' ? 'accent' : 'neutral'}>{asset.status}</StatusBadge><span className="truncate text-[10px] text-muted-foreground">{asset.referencedBy.length ? `${asset.referencedBy.length} 处引用` : '未引用'}</span></div>
      </div>
    </article>
  )
}

function AssetMenu({ title, onDelete, onRename }: { title: string; onDelete: () => void; onRename?: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <IconAction label={`${title} 的更多操作`} onClick={() => setOpen((current) => !current)}>
        <MoreHorizontal />
      </IconAction>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-32 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {onRename && <button type="button" onClick={() => { setOpen(false); onRename() }} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" />重命名</button>}
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

function taskDateKey(value: number | string | undefined) {
  const date = new Date(value ?? '')
  if (!Number.isFinite(date.getTime())) return 'unknown'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function taskDateLabel(value: number | string | undefined) {
  const date = new Date(value ?? '')
  if (!Number.isFinite(date.getTime())) return '日期未知'
  const today = taskDateKey(Date.now())
  const yesterday = new Date(Date.now() - 86400000)
  const key = taskDateKey(value)
  if (key === today) return '今天'
  if (key === taskDateKey(yesterday.getTime())) return '昨天'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${parts.year ?? ''}年${parts.month ?? ''}月${parts.day ?? ''}日`
}

function taskWithinTimeRange(value: number | string | undefined, range: string) {
  if (range === 'all') return true
  const timestamp = new Date(value ?? '').getTime()
  if (!Number.isFinite(timestamp)) return false
  if (range === 'today') return taskDateKey(timestamp) === taskDateKey(Date.now())
  const age = range === '7d' ? 7 : range === '30d' ? 30 : 0
  return age === 0 || timestamp >= Date.now() - age * 86400000
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
  const [modelFilter, setModelFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('all')
  // 历史任务从服务端分页读取；本地只保留最近任务的轮询状态用于实时进度。
  const history = useServerHistory({ pageSize: 24 })

  // 后端可用时任务列表来自真实接口，只保留本页的筛选与搜索。
  if (liveReady) {
    const query = search.trim().toLowerCase()
    const matches = (title: string, prompt: string, model: string | undefined, createdAt: number | string | undefined) => {
      if (modelFilter !== 'all' && model !== modelFilter) return false
      if (!taskWithinTimeRange(createdAt, timeFilter)) return false
      return !query || `${title} ${prompt} ${model ?? ''}`.toLowerCase().includes(query)
    }
    const filtered = generation.tasks.filter((task) => {
      if (liveFilter === 'active' && !['pending', 'running', 'paused'].includes(task.status)) return false
      if (liveFilter === 'success' && task.status !== 'success') return false
      if (liveFilter === 'error' && !['error', 'cancelled'].includes(task.status)) return false
      return matches(task.title, task.prompt, task.model, task.createdAt)
    })
    const historyFiltered = history.items.filter((item) => {
      if (liveFilter === 'active') return false
      if (liveFilter === 'success' && item.status !== 'success') return false
      if (liveFilter === 'error' && !['error', 'cancelled', 'failed'].includes(item.status)) return false
      return matches(item.title, item.prompt, item.model, item.createdAt)
    })
    const models = Array.from(new Set([...generation.tasks.map((task) => task.model), ...history.items.map((item) => item.model)].filter((model): model is string => Boolean(model)))).sort()
    const groupedHistory = new Map<string, { label: string; items: GenerationHistoryItem[]; sort: number }>()
    historyFiltered.forEach((item) => { const key = taskDateKey(item.createdAt); const group = groupedHistory.get(key) ?? { label: taskDateLabel(item.createdAt), items: [], sort: item.createdAt ? new Date(item.createdAt).getTime() : 0 }; group.items.push(item); groupedHistory.set(key, group) })
    const historyGroups = Array.from(groupedHistory.values()).sort((a, b) => b.sort - a.sort)
    const groupedLive = new Map<string, { label: string; items: typeof filtered; sort: number }>()
    filtered.forEach((task) => { const key = taskDateKey(task.createdAt); const group = groupedLive.get(key) ?? { label: taskDateLabel(task.createdAt), items: [], sort: task.createdAt || 0 }; group.items.push(task); groupedLive.set(key, group) })
    const liveGroups = Array.from(groupedLive.values()).sort((a, b) => b.sort - a.sort)
    const refreshAll = () => {
      void generation.refresh()
      void history.reload()
    }
    return (
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-5 md:px-8 md:py-6 xl:px-10">
        <PageHeader
          eyebrow="工作区"
          title="任务"
          description="进行中的任务会实时更新，历史记录支持分页查看；刷新或换浏览器后仍可恢复。"
          actions={
            <ControlButton variant="secondary" size="sm" onClick={refreshAll} disabled={generation.loading || history.state === 'loading'}>
              <RefreshCw className={cn('size-3.5', (generation.loading || history.state === 'loading') && 'animate-spin')} />刷新状态
            </ControlButton>
          }
        />
        <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
          <FilterChips
            value={liveFilter}
            onChange={setLiveFilter}
            options={([
              ['all', '全部', generation.tasks.length + history.total],
              ['active', '进行中', generation.tasks.filter((task) => ['pending', 'running', 'paused'].includes(task.status)).length],
              ['success', '已完成', generation.tasks.filter((task) => task.status === 'success').length],
              ['error', '失败或取消', generation.tasks.filter((task) => ['error', 'cancelled'].includes(task.status)).length],
            ] as const).map(([value, label, count]) => ({ value, label, count }))}
          />
          <div className="grid w-full gap-2 md:max-w-2xl md:grid-cols-[minmax(0,1fr)_170px_140px]"><SearchField value={search} onChange={setSearch} placeholder="搜索任务、提示词或模型" /><select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground"><option value="all">全部模型</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select><select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground"><option value="all">全部时间</option><option value="today">今天</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select></div>
        </div>

        <GenerationErrorNotice />
        <QueryUnavailableNotice />
        <GenerationNotice />
        {history.message && <Notice tone="warning"><span className="min-w-0 flex-1">历史记录暂时无法读取：{history.message}</span><button type="button" onClick={() => void history.reload()} className="shrink-0 text-[11px] underline">重试</button></Notice>}

        {filtered.length === 0 && historyFiltered.length === 0 ? (
          <EmptyState title={generation.loading || history.state === 'loading' ? '正在读取任务' : '没有符合条件的任务'} description={generation.loading || history.state === 'loading' ? '正在同步任务状态。' : '在图片或视频工作台提交生成后，任务会出现在这里。'} />
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-foreground">进行中的任务</h2>
                {liveGroups.map((group) => <div key={group.label} className="flex flex-col gap-3"><div className="flex items-center gap-3 pt-2"><h3 className="text-xs font-semibold text-foreground">{group.label}</h3><div className="h-px flex-1 bg-border" /><span className="text-[11px] text-muted-foreground">{group.items.length}</span></div>{group.items.map((task) => <GenerationTaskCard key={task.id} task={task} />)}</div>)}
              </section>
            )}
            {historyFiltered.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-foreground">历史记录（共 {history.total} 条）</h2>
                {historyGroups.map((group) => <div key={group.label} className="flex flex-col gap-3"><div className="flex items-center gap-3 pt-2"><h3 className="text-xs font-semibold text-foreground">{group.label}</h3><div className="h-px flex-1 bg-border" /><span className="text-[11px] text-muted-foreground">{group.items.length}</span></div>{group.items.map((item) => <HistoryTaskCard key={item.id} item={item} />)}</div>)}
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

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-5 md:px-8 md:py-6 xl:px-10">
      <PageHeader eyebrow="工作区" title="任务" description="任务记录暂时无法读取，请稍后重试。" />
      <LocalPreviewNotice what="任务记录" />
    </div>
  )
}

/** 服务端历史任务卡片：展示状态、模型、耗时、结果与失败原因。 */
function HistoryTaskCard({ item }: { item: GenerationHistoryItem }) {
  const router = useRouter()
  const { state } = useStudio()
  const [reuseError, setReuseError] = useState('')
  const meta = item.status === 'success' ? { label: '已完成', tone: 'success' as const } : item.status === 'error' || item.status === 'failed' ? { label: '失败', tone: 'warning' as const } : item.status === 'cancelled' ? { label: '已取消', tone: 'muted' as const } : { label: item.status || '未知', tone: 'accent' as const }
  const kindLabel = item.kind === 'video' ? '视频' : item.kind === 'audio' ? '音频' : item.kind === 'text' ? '文本' : '图片'
  const firstAsset = item.assets[0]

  /** 复用参数：把历史记录带回对应工作台。 */
  function reuse(event: React.MouseEvent<HTMLAnchorElement>) {
    try {
      if (state.backendStatus !== 'connected') throw new Error('请登录后复用参数。')
      if (item.kind !== 'image' && item.kind !== 'video') throw new Error('目前只支持复用图片或视频参数。')
      writeReuseParams(window.sessionStorage, state.user.id, { kind: item.kind, prompt: item.prompt, model: item.model, taskId: item.taskId ?? item.id })
      setReuseError('')
    } catch (reason) {
      event.preventDefault()
      setReuseError(reason instanceof Error ? reason.message : '参数暂时无法带入工作台，请重试。')
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
          {item.assets.map((asset, index) => (
            <MediaThumb key={`${asset.url}-${index}`} src={asset.url} poster={asset.poster} alt={`${item.title} 结果 ${index + 1}`} fallback="结果未能加载" kind={item.kind === 'video' ? 'video' : 'image'} className="aspect-square w-full max-w-[220px] rounded-md [&_img]:object-contain [&_video]:object-contain" />
          ))}
        </div>
      )}
      {item.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-5 text-destructive" role="alert">失败原因：{item.error}</p>}
      {reuseError && <p role="alert" className="text-xs text-destructive">{reuseError}</p>}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        {firstAsset?.url && <MediaDownloadButton media={{ url: firstAsset.url, kind: item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'image', mimeType: firstAsset.mimeType, poster: firstAsset.poster, width: firstAsset.width, height: firstAsset.height }} title={item.title} prompt={item.prompt} taskId={item.taskId ?? item.id} label="下载结果" className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50" />}
        {(item.kind === 'image' || item.kind === 'video') && (item.prompt || item.model) && <Link href={item.kind === 'video' ? '/video' : '/image'} onClick={reuse} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Copy className="size-3.5" />复用参数</Link>}
        <ControlButton variant="ghost" size="sm" onClick={() => router.push('/works')}>在我的作品中查看</ControlButton>
        {state.backendStatus !== 'connected' && <span className="text-[11px] text-muted-foreground">登录后可继续操作</span>}
      </div>
    </article>
  )
}

/** 任务数据暂不可用时的兜底页面。 */
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
        description="任务记录暂时无法读取，请稍后重试。"
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
