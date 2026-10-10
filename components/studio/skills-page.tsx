'use client'

import Link from 'next/link'
import { ArrowRight, PanelsTopLeft, Puzzle } from 'lucide-react'
import { useStudio } from '@/lib/studio/store'
import { EmptyState, PageHeader, SectionHeading } from './ui'

/**
 * 技能市场入口。
 *
 * 技能的浏览、启用、创建与编辑依赖自由画布里的 Agent 连接，因此这里不重复挂载
 * 画布的运行时，而是列出可进入的画布，让用户直接在 Agent 面板的「技能」标签中管理。
 */
export function SkillsPage() {
  const { state } = useStudio()
  const canvases = state.projects.slice(0, 6)

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="工具"
        title="技能市场"
        description="技能为自由画布里的 OAO Agent 提供可复用的工作流。浏览、启用、创建与编辑技能，都在画布的 Agent 面板「技能」标签中完成。"
        actions={
          <Link
            href="/canvas"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            进入自由画布
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      <section aria-label="从画布打开技能" className="lg-pane flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-studio-accent/10 text-studio-accent">
            <Puzzle className="size-4" aria-hidden="true" />
          </span>
          <SectionHeading title="从画布打开技能" description="选择一个画布，在 Agent 面板的「技能」标签中启用或创建技能。" />
        </div>

        {canvases.length ? (
          <ul aria-label="可用画布" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {canvases.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/canvas/${project.id}`}
                  className="flex h-12 items-center gap-3 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:border-studio-accent/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <PanelsTopLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="还没有自由画布"
            description="创建一个画布后，即可在 Agent 面板中使用和管理技能。"
            action={
              <Link href="/canvas" className="inline-flex h-9 items-center rounded-lg border border-border px-3.5 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted">
                新建画布
              </Link>
            }
          />
        )}
      </section>
    </div>
  )
}
