'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, Bot, Clapperboard, Image as ImageIcon, Layers3, Sparkles, Video, type LucideIcon } from 'lucide-react'
import { SegmentedControl } from './ui'
import { CreativeProjectStarter } from './creative-project-starter'
import { RecentWorks } from './home-recent-works'
import { useSiteBrand } from '@/components/site-brand'
import { SiteFooter } from '@/components/site-footer'

type EntryMode = 'quick' | 'project'

const directions = [
  { title: '让产品成为主角', brief: '制作一支 15 秒的产品短片。用三个镜头分别表现产品的整体造型、材质细节和使用场景，保持产品外观一致。', icon: Layers3 },
  { title: '讲一个有转折的故事', brief: '制作一段短故事。先交代人物与场景，再呈现冲突，最后用一个意外但合理的画面收尾。先确定角色和镜头节奏。', icon: Clapperboard },
  { title: '延续一个角色的世界', brief: '围绕同一个原创角色创作一组连续画面，保持面部、服装和画风一致，让角色出现在三个不同场景里。', icon: ImageIcon },
]

export function HomePage() {
  const tx = useUiText()
  const brand = useSiteBrand()
  const [mode, setMode] = useState<EntryMode>('quick')
  const [brief, setBrief] = useState('')

  return (
    <div className="studio-home studio-page-container flex max-w-[1280px] flex-col gap-8">
      <header className="studio-home-heading flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="studio-eyebrow">{brand.title} {tx(" · 创作空间")}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">{tx("今天，做点什么？")}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{tx("从一张图开始，或把一个想法发展成完整作品。")}</p>
        </div>
        <Link href="/works" className="inline-flex items-center gap-2 rounded-md py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
          {tx("继续上次的生成")}<ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </header>

      <Link href="/agent" className="studio-home-assistant group flex flex-col gap-5 rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <span className="flex items-start gap-4"><span className="studio-home-entry-icon flex size-12 shrink-0 items-center justify-center rounded-xl"><Bot className="size-6" aria-hidden="true" /></span><span><span className="flex items-center gap-2 text-xs font-medium text-studio-accent"><Sparkles className="size-3.5" aria-hidden="true" />{tx("创作助手")}</span><span className="mt-1 block text-xl font-semibold tracking-tight">{tx("有个想法，先一起聊聊")}</span><span className="mt-2 block max-w-xl text-sm leading-6 text-muted-foreground">{tx("带上目标、已有文字或参考图。先完善方向，再查看并确认生成计划。")}</span></span></span>
        <span className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground sm:self-center">{tx("打开创作助手")}<ArrowRight className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" aria-hidden="true" /></span>
      </Link>

      <section className="studio-surface overflow-hidden" aria-label={tx("开始创作")}>
        <div className="flex border-b border-border p-2">
          <SegmentedControl id="home-entry" label="创作方式" value={mode} onChange={(value) => { if (value === 'quick' || value === 'project') setMode(value) }} className="studio-home-entry-switch" options={[
            { value: 'quick', label: '快速生成', icon: <ImageIcon className="size-4" aria-hidden="true" /> },
            { value: 'project', label: '做一件完整作品', icon: <Clapperboard className="size-4" aria-hidden="true" /> },
          ]} />
        </div>

        <div id="home-entry-panel-quick" role="tabpanel" aria-labelledby="home-entry-quick" tabIndex={0} hidden={mode !== 'quick'}>
          <div className="p-5 sm:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold tracking-tight">{tx("先把脑海里的画面做出来")}</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{tx("打开生成工具，输入描述或添加参考。满意的结果可以继续修改、转成视频或加入项目。")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickEntry href="/image" title={tx("创作图片")} description={tx("角色、产品、场景与视觉探索")} details="文字生图 · 参考图编辑 · 版本对比" icon={ImageIcon} />
              <QuickEntry href="/video" title={tx("创作视频")} description={tx("让画面动起来，尝试镜头与节奏")} details="文字生视频 · 图片参考 · 首尾帧" icon={Video} />
            </div>
          </div>
        </div>
        <div id="home-entry-panel-project" role="tabpanel" aria-labelledby="home-entry-project" tabIndex={0} hidden={mode !== 'project'}><CreativeProjectStarter brief={brief} onBriefChange={setBrief} /></div>
      </section>

      <section aria-labelledby="directions-title">
        <h2 id="directions-title" className="text-sm font-semibold">{tx("从一个方向开始")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {directions.map((direction) => {
            const Icon = direction.icon
            return (
              <button key={direction.title} type="button" onClick={() => { setBrief(direction.brief); setMode('project') }} className="studio-home-direction group flex items-start gap-3 rounded-xl border border-border px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{tx(direction.title)}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{tx("把创意提纲带入新项目")}</span></span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </section>

      <RecentWorks />
      <SiteFooter placement="studio" />
    </div>
  )
}

function QuickEntry({ href, title, description, details, icon: Icon }: { href: string; title: string; description: string; details: string; icon: LucideIcon }) {
  const tx = useUiText()
  return (
    <Link href={href} className="studio-home-entry group flex min-h-48 overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
      <span className="flex min-w-0 flex-1 flex-col p-5">
        <span className="flex items-center justify-between gap-3"><span className="studio-home-entry-icon flex size-9 items-center justify-center rounded-lg"><Icon className="size-[18px]" aria-hidden="true" /></span><ArrowRight className="size-4 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-1" aria-hidden="true" /></span>
        <span className="mt-4 text-base font-semibold">{title}</span>
        <span className="mt-1 text-sm leading-6 text-muted-foreground">{description}</span>
        <span className="mt-3 text-[11px] leading-5 text-muted-foreground">{tx(details)}</span>
      </span>
      <span className="relative w-[29%] shrink-0 overflow-hidden border-l border-border bg-muted"><img src={href === '/image' ? '/media/generated/landing-image-v1.png' : '/media/generated/landing-video-v1.png'} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105" /></span>
    </Link>
  )
}
