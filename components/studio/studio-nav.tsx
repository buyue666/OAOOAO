import Link from 'next/link'
import {
  FolderOpen,
  History,
  LayoutGrid,
  Library,
  ListChecks,
  Puzzle,
  WandSparkles,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from './ui'

export interface StudioNavItem {
  label: string
  href: string
  icon: LucideIcon
  /** 当路径匹配这些前缀时，导航项保持激活。 */
  matches: readonly string[]
}

export const studioPrimaryNav: readonly StudioNavItem[] = [
  { label: '开始创作', href: '/studio', icon: LayoutGrid, matches: ['/studio', '/agent', '/image', '/video'] },
  { label: '我的项目', href: '/projects', icon: FolderOpen, matches: ['/projects', '/drama', '/canvas'] },
  { label: '创作资产', href: '/assets', icon: Library, matches: ['/assets'] },
]

export const studioSecondaryNav: readonly StudioNavItem[] = [
  { label: '生成记录', href: '/works', icon: History, matches: ['/works', '/gallery'] },
  { label: '任务', href: '/tasks', icon: ListChecks, matches: ['/tasks'] },
  { label: '技能库', href: '/skills', icon: Puzzle, matches: ['/skills'] },
  { label: '创作工具', href: '/tools', icon: WandSparkles, matches: ['/tools'] },
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
  return rootTitles[root] ?? 'OAO'
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
  const Icon = item.icon
  const active = isNavItemActive(pathname, item)
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'studio-nav-item flex h-10 items-center rounded-lg text-sm font-medium',
        collapsed ? 'mx-auto w-10 justify-center' : 'gap-3 px-3',
        active ? 'text-studio-accent' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )

  return collapsed ? <Tooltip label={item.label} side="right" className="flex w-full justify-center">{link}</Tooltip> : link
}

