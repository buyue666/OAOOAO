'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, Bot, Clapperboard, Image as ImageIcon, Layers3, Video, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CreativeProjectStarter } from './creative-project-starter'
import { RecentWorks } from './home-recent-works'

type EntryMode = 'quick' | 'project'

const directions = [
  { title: '让产品成为主角', brief: '制作一支 15 秒的产品短片。用三个镜头分别表现产品的整体造型、材质细节和使用场景，保持产品外观一致。', icon: Layers3 },
  { title: '讲一个有转折的故事', brief: '制作一段短故事。先交代人物与场景，再呈现冲突，最后用一个意外但合理的画面收尾。先确定角色和镜头节奏。', icon: Clapperboard },
  { title: '延续一个角色的世界', brief: '围绕同一个原创角色创作一组连续画面，保持面部、服装和画风一致，让角色出现在三个不同场景里。', icon: ImageIcon },
]

export function HomePage() {
  const [mode, setMode] = useState<EntryMode>('quick')
  const [brief, setBrief] = useState('')

  return (
    <div className="studio-home mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 pb-16 pt-7 sm:px-6 lg:px-8 lg:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">OAO · 创作空间</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">今天，做点什么？</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">从一张图开始，或把一个想法发展成完整作品。</p>
        </div>
        <Link href="/works" className="inline-flex items-center gap-2 rounded-md py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
          继续上次的生成<ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </header>

      <section className="studio-surface overflow-hidden" aria-label="开始创作">
        <div role="group" aria-label="创作方式" className="flex flex-wrap gap-1 border-b border-border p-2">
          {([{ id: 'quick', title: '快速生成', icon: ImageIcon }, { id: 'project', title: '做一件完整作品', icon: Clapperboard }] as const).map((entry) => {
            const Icon = entry.icon
            return <button key={entry.id} type="button" aria-pressed={mode === entry.id} onClick={() => setMode(entry.id)} className={cn('inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70', mode === entry.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}><Icon className="size-4" aria-hidden="true" />{entry.title}</button>
          })}
        </div>

        <div hidden={mode !== 'quick'}>
          <div className="p-5 sm:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold tracking-tight">先把脑海里的画面做出来</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">打开生成工具，输入描述或添加参考。满意的结果可以继续修改、转成视频或加入项目。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickEntry href="/image" title="创作图片" description="角色、产品、场景与视觉探索" details="文字生图 · 参考图编辑 · 版本对比" icon={ImageIcon} />
              <QuickEntry href="/video" title="创作视频" description="让画面动起来，尝试镜头与节奏" details="文字生视频 · 图片参考 · 首尾帧" icon={Video} />
            </div>
            <Link href="/agent" className="mt-5 inline-flex items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"><Bot className="size-4" aria-hidden="true" />想先聊聊创意？打开创作助手<ArrowRight className="size-3.5" aria-hidden="true" /></Link>
          </div>
        </div>
        <div hidden={mode !== 'project'}><CreativeProjectStarter brief={brief} onBriefChange={setBrief} /></div>
      </section>

      <section aria-labelledby="directions-title">
        <h2 id="directions-title" className="text-sm font-semibold">从一个方向开始</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {directions.map((direction) => {
            const Icon = direction.icon
            return (
              <button key={direction.title} type="button" onClick={() => { setBrief(direction.brief); setMode('project') }} className="group flex items-start gap-3 rounded-lg border border-border px-4 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{direction.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">把创意提纲带入新项目</span></span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </section>

      <RecentWorks />
    </div>
  )
}

function QuickEntry({ href, title, description, details, icon: Icon }: { href: string; title: string; description: string; details: string; icon: LucideIcon }) {
  return (
    <Link href={href} className="group flex min-h-44 flex-col rounded-lg border border-border bg-muted/20 p-5 transition-colors hover:border-foreground/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
      <span className="flex items-center justify-between"><Icon className="size-5 text-foreground" aria-hidden="true" /><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
      <span className="mt-5 text-base font-semibold">{title}</span>
      <span className="mt-1 text-sm text-muted-foreground">{description}</span>
      <span className="mt-4 text-xs leading-5 text-muted-foreground">{details}</span>
    </Link>
  )
}
