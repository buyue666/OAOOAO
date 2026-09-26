'use client'

import Link from 'next/link'
import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Bot, Clapperboard, FolderKanban, GalleryHorizontalEnd, Image as ImageIcon, LayoutDashboard, ListChecks, Palette, PanelsTopLeft, Settings, Sparkles, Video, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const studioNavGroups = [
  { label: '创作', items: [
    { label: '导演 Agent', href: '/agent', icon: Bot },
    { label: '图片生成', href: '/image', icon: ImageIcon },
    { label: '视频生成', href: '/video', icon: Video },
    { label: '短剧制作', href: '/projects?view=drama', icon: Clapperboard },
  ] },
  { label: '工具', items: [
    { label: '自由画布', href: '/canvas', icon: PanelsTopLeft },
    { label: '任务中心', href: '/tasks', icon: ListChecks },
  ] },
  { label: '管理', items: [
    { label: '项目', href: '/projects', icon: FolderKanban },
    { label: '素材库', href: '/assets', icon: GalleryHorizontalEnd },
    { label: '我的作品', href: '/works', icon: Palette },
    { label: '广场', href: '/gallery', icon: LayoutDashboard },
  ] },
]

function MobileNavContent({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="studio-mobile-nav motion-fade fixed inset-0 z-50 bg-studio-ink/60 lg:hidden" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title" className="motion-drawer-left flex h-full w-full max-w-72 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link href="/studio" onClick={onClose} className="flex items-center gap-2 text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
            <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-[11px] font-bold text-background">OA</span>
            <span id="mobile-nav-title" className="text-sm font-bold tracking-[-0.02em]">OAOOAO</span>
          </Link>
          <button type="button" onClick={onClose} aria-label="关闭导航" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:text-sidebar-foreground"><X className="size-4" aria-hidden="true" /></button>
        </div>

        <nav aria-label="移动端主导航" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          <Link href="/studio" onClick={onClose} data-active={pathname === '/studio'} className={cn('studio-nav-item flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium', pathname === '/studio' ? 'text-studio-accent' : 'text-muted-foreground')}><Sparkles className="size-4" />工作台</Link>
          {studioNavGroups.map((group) => (
            <section key={group.label}>
              <h2 className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">{group.label}</h2>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = item.href === '/projects?view=drama'
                    ? pathname === '/projects' && searchParams.get('view') === 'drama'
                    : item.href === '/projects'
                      ? pathname === '/projects' && searchParams.get('view') !== 'drama'
                      : item.href === '/canvas'
                    ? pathname === '/canvas' || pathname.startsWith('/canvas/')
                    : pathname === item.href || pathname.startsWith(`${item.href}/`)
                  return <Link key={item.href} href={item.href} onClick={onClose} data-active={active} className={cn('studio-nav-item flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium', active ? 'text-studio-accent' : 'text-muted-foreground')}><Icon className="size-4" />{item.label}</Link>
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3"><Link href="/settings" onClick={onClose} className="studio-nav-item flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground"><Settings className="size-4" />设置</Link></div>
      </aside>
    </div>
  )
}

export function MobileNav(props: { open: boolean; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <MobileNavContent {...props} />
    </Suspense>
  )
}
