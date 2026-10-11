import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { Project, Task } from '@/lib/studio/types'
import { MediaThumb, StatusBadge, Tooltip, type Tone } from './ui'

/**
 * 演示项目的封面映射。
 *
 * **只对演示项目 ID 生效**：真实项目（后端返回的 UUID）没有本地封面，
 * 直接用项目自带的 `cover`，不会因为「名字碰巧相同」而套上别人的图片。
 */
const demoProjectCovers: Record<string, string> = {
  aurora: '/media/project-aurora.png',
  northline: '/media/project-northline.png',
  'quiet-room': '/media/project-quiet-room.png',
  'red-shift': '/media/project-red-shift.png',
}

const projectTones: Record<string, Tone> = {
  进行中: 'accent',
  已完成: 'success',
  已归档: 'muted',
}

/** 最近作品以清单呈现：一行一个项目，便于对比状态与进度，而不是大图网格。 */
export function RecentWorks({ projects, runningTask }: { projects: Project[]; runningTask?: Task }) {
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="recent-title" className="text-sm font-semibold text-foreground">最近作品</h2>
          <p className="mt-1 text-xs text-muted-foreground">最近更新的项目，点击即可继续编辑。</p>
        </div>
        <Link href="/works" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
          全部作品
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {runningTask && (
        <Link href="/tasks" aria-live="polite" className="studio-surface flex min-w-0 items-center gap-2.5 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-studio-accent motion-reduce:animate-none" aria-hidden="true" />
          <span className="truncate text-foreground">{runningTask.title}</span>
          <span className="hidden shrink-0 sm:inline">· {runningTask.stage}</span>
          <span className="ml-auto shrink-0">查看任务</span>
        </Link>
      )}

      {projects.length ? (
        <ul aria-label="最近作品列表" className="studio-surface divide-y divide-border overflow-hidden">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="group flex min-w-0 items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70">
                <MediaThumb
                  src={demoProjectCovers[project.id] ?? project.cover}
                  alt=""
                  fallback={project.title}
                  className="size-12 shrink-0 rounded-md [&_img]:transition-transform [&_img]:duration-300 [&_img]:ease-out group-hover:[&_img]:scale-105"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0">{project.type}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{project.updatedAt} 更新</span>
                  </span>
                </span>
                {project.status === '进行中' && (
                  <Tooltip label={`完成度 ${project.progress}%`}>
                    <span className="hidden shrink-0 text-xs font-medium tabular-nums text-foreground sm:inline">{project.progress}%</span>
                  </Tooltip>
                )}
                <StatusBadge tone={projectTones[project.status] ?? 'neutral'}>{project.status}</StatusBadge>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border px-5 text-center">
          <p className="text-sm font-medium text-foreground">还没有作品</p>
          <p className="mt-1 text-xs text-muted-foreground">从上方输入一个想法，生成的作品会出现在这里。</p>
        </div>
      )}
    </section>
  )
}
