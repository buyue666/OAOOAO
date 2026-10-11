import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { Project, Task } from '@/lib/studio/types'
import { MediaThumb, StatusBadge, type Tone } from './ui'

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

/** 最近作品以封面网格呈现：内容优先，每个项目一张可点击的卡片。 */
export function RecentWorks({ projects, runningTask }: { projects: Project[]; runningTask?: Task }) {
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="recent-title" className="text-sm font-semibold text-foreground">最近作品</h2>
          <p className="mt-1 text-xs text-muted-foreground">最近更新的项目，点击即可继续编辑。</p>
        </div>
        <Link href="/works" className="inline-flex shrink-0 items-center gap-1 rounded-md text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
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
        <ul aria-label="最近作品列表" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {projects.map((project) => (
            <li key={project.id} className="min-w-0">
              <Link href={`/projects/${project.id}`} className="studio-surface group flex h-full flex-col overflow-hidden transition-colors duration-150 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
                <MediaThumb
                  src={demoProjectCovers[project.id] ?? project.cover}
                  alt=""
                  fallback={project.title}
                  className="aspect-[4/3] w-full shrink-0 [&_img]:transition-transform [&_img]:duration-300 [&_img]:ease-out group-hover:[&_img]:scale-[1.03] motion-reduce:[&_img]:transition-none"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
                  <span className="flex items-center justify-between gap-2">
                    <StatusBadge tone={projectTones[project.status] ?? 'neutral'}>{project.status}</StatusBadge>
                    {project.status === '进行中' && <span className="text-xs font-medium tabular-nums text-foreground">{project.progress}%</span>}
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{project.type} · {project.updatedAt} 更新</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-5 py-8 text-center">
          <p className="text-sm font-medium text-foreground">还没有作品</p>
          <p className="text-xs text-muted-foreground">在上方输入创作描述并开始，生成的作品会出现在这里。</p>
        </div>
      )}
    </section>
  )
}
