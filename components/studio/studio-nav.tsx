'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ChevronDown,
  FolderOpen,
  History,
  LayoutGrid,
  Library,
  Puzzle,
  WandSparkles,
  Settings,
  Shirt,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Tooltip } from './ui'

export interface StudioNavItem {
  label: string
  href: string
  icon: LucideIcon
  /** 当路径匹配这些前缀时，导航项保持激活。 */
  matches: readonly string[]
}

export interface StudioToolNavItem extends StudioNavItem {
  key: 'remix' | 'tryon'
}

export const studioPrimaryNav: readonly StudioNavItem[] = [
  { label: '开始创作', href: '/studio', icon: LayoutGrid, matches: ['/studio', '/agent', '/image', '/video'] },
  { label: '我的项目', href: '/projects', icon: FolderOpen, matches: ['/projects', '/drama', '/canvas'] },
  { label: '创作资产', href: '/assets', icon: Library, matches: ['/assets'] },
]

export const studioSecondaryNav: readonly StudioNavItem[] = [
  { label: '生成记录', href: '/works', icon: History, matches: ['/works', '/gallery'] },
  { label: '技能库', href: '/skills', icon: Puzzle, matches: ['/skills'] },
]

export const studioToolsNav: StudioNavItem = { label: '创作工具', href: '/tools', icon: WandSparkles, matches: ['/tools'] }

export const studioToolItems: readonly StudioToolNavItem[] = [
  { key: 'remix', label: '图片复刻', href: '/tools/remix', icon: WandSparkles, matches: ['/tools/remix'] },
  { key: 'tryon', label: 'AI 换装', href: '/tools/tryon', icon: Shirt, matches: ['/tools/tryon'] },
]

export const studioAdminNav: StudioNavItem = { label: '管理员后台', href: '/admin', icon: ShieldCheck, matches: ['/admin'] }
export const studioSettingsNav: StudioNavItem = { label: '设置', href: '/settings', icon: Settings, matches: ['/settings'] }

export function isNavItemActive(pathname: string, item: StudioNavItem) {
  return item.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

const rootTitles: Record<string, string> = {
  studio: '开始创作',
  agent: '创作助手',
  image: '图片生成',
  video: '视频生成',
  drama: '短剧制作',
  canvas: '自由画布',
  tasks: '任务',
  works: '生成记录',
  gallery: '作品广场',
  projects: '我的项目',
  assets: '创作资产',
  skills: '技能库',
  account: '账户',
  settings: '设置',
  plans: '套餐',
  tools: '创作工具',
}

const sectionTitles: Record<string, string> = {
  script: '剧本',
  storyboard: '分镜',
  shots: '镜头',
  characters: '角色与场景',
  cut: '成片',
  overview: '概览',
  assets: '素材',
  canvas: '画布',
  settings: '设置',
}

/** 页面标题只显示当前页面名称；项目详情页附带项目名称。 */
export function studioPageTitle(pathname: string, projectTitle?: string) {
  const [root, id, section] = pathname.split('/').filter(Boolean)
  if (!root) return '开始创作'
  if (id && (root === 'projects' || root === 'drama')) {
    const name = projectTitle ?? (root === 'drama' ? '短剧项目' : '项目')
    if (!section) return name
    return `${name} · ${sectionTitles[section] ?? section}`
  }
  if (root === 'tools' && id) return id === 'tryon' ? 'AI 换装' : '图片复刻'
  return rootTitles[root] ?? 'OAO'
}

/** Translate page chrome without treating a user-authored project title as UI copy. */
export function localizedStudioPageTitle(pathname: string, projectTitle: string | undefined, tx: (source: string) => string) {
  const [root, id, section] = pathname.split('/').filter(Boolean)
  if (id && (root === 'projects' || root === 'drama')) {
    const name = projectTitle ?? tx(root === 'drama' ? '短剧项目' : '项目')
    return section ? `${name} · ${tx(sectionTitles[section] ?? section)}` : name
  }
  return tx(studioPageTitle(pathname))
}

export function StudioNavLink({
  item,
  pathname,
  collapsed = false,
  onNavigate,
}: {
  item: StudioNavItem
  pathname: string
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const tx = useUiText()
  const Icon = item.icon
  const label = tx(item.label)
  const active = isNavItemActive(pathname, item)
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'studio-nav-item flex h-10 items-center rounded-lg text-sm font-medium',
        collapsed ? 'mx-auto w-10 justify-center' : 'gap-3 px-3',
        active ? 'text-studio-accent' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )

  return collapsed ? <Tooltip label={label} side="right" className="flex w-full justify-center">{link}</Tooltip> : link
}

export function StudioToolsNav({
  pathname,
  collapsed = false,
  onNavigate,
  idSuffix = 'desktop',
}: {
  pathname: string
  collapsed?: boolean
  onNavigate?: () => void
  idSuffix?: string
}) {
  const tx = useUiText()
  const router = useRouter()
  const active = isNavItemActive(pathname, studioToolsNav)
  const [open, setOpen] = useState(active)
  const submenuId = `studio-tools-subnav-${idSuffix}`

  useEffect(() => {
    if (active) setOpen(true)
  }, [active])

  const Icon = studioToolsNav.icon
  const parent = (
    <button
      type="button"
      aria-expanded={collapsed ? undefined : open}
      aria-controls={collapsed ? undefined : submenuId}
      aria-label={collapsed ? tx(studioToolsNav.label) : undefined}
      data-active={active ? 'true' : 'false'}
      onClick={() => {
        if (collapsed) {
          router.push(studioToolItems[0].href)
          return
        }
        setOpen((value) => !value)
      }}
      className={cn(
        'studio-nav-item flex h-10 items-center rounded-lg text-sm font-medium',
        collapsed ? 'mx-auto w-10 justify-center' : 'w-full gap-3 px-3',
        active ? 'text-studio-accent' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      {!collapsed && <><span className="min-w-0 flex-1 truncate text-left">{tx(studioToolsNav.label)}</span><ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" /></>}
    </button>
  )

  return (
    <div className="flex flex-col gap-1">
      {collapsed ? <Tooltip label={tx(studioToolsNav.label)} side="right" className="flex w-full justify-center">{parent}</Tooltip> : parent}
      {!collapsed && open && (
        <div id={submenuId} className="ml-3 flex flex-col gap-1 border-l border-sidebar-border pl-3" aria-label={tx("创作工具子菜单")}>
          {studioToolItems.map((item) => {
            const ItemIcon = item.icon
            const itemActive = isNavItemActive(pathname, item)
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={onNavigate}
                aria-current={itemActive ? 'page' : undefined}
                data-active={itemActive ? 'true' : 'false'}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors',
                  itemActive ? 'bg-studio-accent/10 text-studio-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <ItemIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{tx(item.label)}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

