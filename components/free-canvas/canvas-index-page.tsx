'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { deleteCanvasProjects, type CanvasSummary } from '@/lib/studio/api'
import { createFreeCanvas, renameFreeCanvas, useFreeCanvasProjects } from './canvas-persistence'
import { errorMessageOf } from './use-generation-actions'

const DOT_GRID = {
  backgroundImage: 'radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)',
  backgroundSize: '16px 16px',
}

export function CanvasIndexPage() {
  const router = useRouter()
  const { data: projects, error, isLoading, mutate } = useFreeCanvasProjects()
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const createCanvas = async () => {
    setCreating(true)
    setNotice(null)
    try {
      const project = await createFreeCanvas(`未命名画布 ${(projects?.length ?? 0) + 1}`)
      router.push(`/canvas/${project.id}`)
    } catch (reason) {
      setNotice(errorMessageOf(reason))
      setCreating(false)
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-black text-white">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-5 py-8 md:px-8 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-[11px] tracking-[0.2em] text-neutral-500 uppercase">自由画布</p>
            <h1 className="mt-2 text-2xl font-semibold">我的画布</h1>
          </div>
          <button
            type="button"
            onClick={() => void createCanvas()}
            disabled={creating}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden="true" />
            {creating ? '正在创建' : '新建画布'}
          </button>
        </header>

        {notice ? <p role="alert" className="text-sm text-neutral-300">{notice}</p> : null}

        {error ? (
          <p role="alert" className="text-sm text-neutral-400">画布列表读取失败，请确认已登录后刷新页面。</p>
        ) : isLoading ? (
          <p role="status" className="text-sm text-neutral-500">正在读取画布…</p>
        ) : projects?.length ? (
          <ul aria-label="画布列表" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <CanvasCard project={project} onChanged={() => void mutate()} />
              </li>
            ))}
          </ul>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/15 px-6 py-16 text-center">
            <h2 className="text-base font-medium">还没有画布</h2>
            <p className="max-w-sm text-sm leading-relaxed text-neutral-500">新建一张空白画布，从第一个节点开始创作。</p>
            <button type="button" onClick={() => void createCanvas()} disabled={creating} className="mt-2 flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50">
              <Plus className="size-4" aria-hidden="true" />
              新建画布
            </button>
          </section>
        )}
      </div>
    </main>
  )
}

function CanvasCard({ project, onChanged }: { project: CanvasSummary; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(project.title)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const startRename = () => {
    setDraft(project.title)
    setRenaming(true)
  }

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    const title = draft.trim().slice(0, 80)
    if (!title || title === project.title) {
      setRenaming(false)
      return
    }
    setBusy(true)
    try {
      await renameFreeCanvas(project.id, title)
      setRenaming(false)
      onChanged()
    } catch (reason) {
      setMessage(errorMessageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await deleteCanvasProjects([project.id])
      onChanged()
    } catch (reason) {
      setMessage(errorMessageOf(reason))
      setBusy(false)
    }
  }

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/12 bg-neutral-950 transition-colors hover:border-white/35">
      <Link href={`/canvas/${project.id}`} aria-label={`打开画布 ${project.title}`} className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white">
        <div className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-black" style={project.cover?.kind === 'image' ? undefined : DOT_GRID}>
          {project.cover?.kind === 'image' ? (
            <img src={project.cover.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          ) : (
            <span className="text-xs text-neutral-600">{project.nodeCount ? `${project.nodeCount} 个节点` : '空白画布'}</span>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {renaming ? (
          <form onSubmit={submitRename} className="flex items-center gap-1.5">
            <label className="min-w-0 flex-1">
              <span className="sr-only">画布名称</span>
              <input
                autoFocus
                value={draft}
                maxLength={80}
                onChange={(event) => setDraft(event.target.value)}
                className="h-8 w-full rounded-lg border border-white/25 bg-black px-2 text-sm text-white focus:border-white focus:outline-none"
              />
            </label>
            <button type="submit" disabled={busy} aria-label="保存名称" className="flex size-8 items-center justify-center rounded-lg bg-white text-black disabled:opacity-40">
              <Check className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setRenaming(false)} aria-label="取消重命名" className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white">
              <X className="size-4" aria-hidden="true" />
            </button>
          </form>
        ) : (
          <Link href={`/canvas/${project.id}`} className="truncate text-sm font-medium text-white hover:underline">
            {project.title}
          </Link>
        )}
        <p className="text-xs text-neutral-500">
          {project.nodeCount} 个节点 · {formatUpdatedAt(project.updatedAt)} 更新
        </p>
        {message ? <p role="alert" className="text-xs text-neutral-400">{message}</p> : null}

        <div className="mt-auto flex items-center justify-end gap-1 pt-2">
          {confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(false)} className="h-8 rounded-lg px-2.5 text-xs text-neutral-400 hover:bg-white/10 hover:text-white">取消</button>
              <button type="button" onClick={() => void remove()} disabled={busy} className="h-8 rounded-lg bg-white px-2.5 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-40">确认删除</button>
            </>
          ) : (
            <>
              <button type="button" onClick={startRename} aria-label={`重命名 ${project.title}`} className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white">
                <Pencil className="size-3.5" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setConfirming(true)} aria-label={`删除 ${project.title}`} className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white">
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
