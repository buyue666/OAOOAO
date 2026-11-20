'use client'

import { useUiText } from '@/lib/studio/i18n'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ChevronDown,
  FolderOpen,
  History,
  Image as ImageIcon,
  LayoutGrid,
  Library,
  Puzzle,
  WandSparkles,
  Settings,
  ShieldCheck,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Tooltip } from './ui'
import { workspaceHref, workspaceIdentity, workspaceSection } from '@/lib/studio/workspace-navigation'
import { useWorkspace } from '@/lib/studio/workspace-context'
import { creativePlugins, type CreativePluginId } from '@/lib/studio/creative-plugins'
import { pluginIcons } from './plugins/plugin-icon'
import { workspaceFeature } from '@/lib/studio/workspace-features'

export interface StudioNavItem {
  label: string
  href: string
  icon: LucideIcon
  /** 当路径匹配这些前缀时，导航项保持激活。 */
  matches: readonly string[]
}

export interface StudioToolNavItem extends StudioNavItem {
  key: CreativePluginId
}

export const studioPrimaryNav: readonly StudioNavItem[] = [
  { label: '开始创作', href: '/studio', icon: LayoutGrid, matches: ['/studio', '/agent'] },
  { label: '图片工作台', href: '/image', icon: ImageIcon, matches: ['/image', '/studio/image'] },
  { label: '视频工作台', href: '/video', icon: Video, matches: ['/video', '/studio/video'] },
  { label: '我的项目', href: '/projects', icon: FolderOpen, matches: ['/projects', '/drama', '/canvas'] },
  { label: '创作资产', href: '/assets', icon: Library, matches: ['/assets'] },
]

export const studioSecondaryNav: readonly StudioNavItem[] = [
  { label: '生成记录', href: '/works', icon: History, matches: ['/works', '/gallery'] },
  { label: '技能库', href: '/skills', icon: Puzzle, matches: ['/skills'] },
]

export const studioToolsNav: StudioNavItem = { label: '创作工具', href: '/tools', icon: WandSparkles, matches: ['/tools'] }

export const studioToolItems: readonly StudioToolNavItem[] = creativePlugins.map(plugin => ({
  key: plugin.id, label: plugin.name, href: plugin.href, icon: pluginIcons[plugin.icon], matches: [plugin.href],
}))

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
  teams: '团队空间',
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
  const scope = workspaceSection(pathname)
  if (scope === '/studio/image') return '图片生成'
  if (scope === '/studio/video') return '视频生成'
  if (scope === '/studio/features') return '创作工具'
  if (scope === '/studio/canvas') return '自由画布'
  pathname = scope
  const [root, id, section] = pathname.split('/').filter(Boolean)
  if (!root) return '开始创作'
  if (id && (root === 'projects' || root === 'drama')) {
    const name = projectTitle ?? (root === 'drama' ? '短剧项目' : '项目')
    if (!section) return name
    return `${name} · ${sectionTitles[section] ?? section}`
  }
  if (root === 'tools' && id) return creativePlugins.find(plugin => plugin.href === `/tools/${id}`)?.name ?? '创作工具'
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
  const workspace = useWorkspace()
  const Icon = item.icon
  const label = tx(item.label)
  const href = workspace.identity ? workspace.href(item.href) : workspaceHref(pathname, item.href)
  const team = workspace.identity || workspaceIdentity(pathname)
  const section = workspaceSection(pathname)
  if (team && item.href === '/skills') return null
  const active = team
    ? item.href === '/studio'
      ? section === '/studio'
      : item.href === '/image'
        ? section === '/studio/image'
        : item.href === '/video'
          ? section === '/studio/video'
          : item.href === '/projects'
            ? section === '/teams'
            : false
    : isNavItemActive(pathname, item)
  const link = (
    <Link
      href={href}
      prefetch={false}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      data-active={active ? 'true' : 'false'}
      data-tour={item.href === '/assets' ? 'assets' : undefined}
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

export function StudioToolsNav({ pathname, collapsed = false, onNavigate }: { pathname: string; collapsed?: boolean; onNavigate?: () => void; idSuffix?: string }) {
  const tx = useUiText()
  const href = workspaceHref(pathname, '/tools')
  const active = isNavItemActive(pathname, studioToolsNav) || ['/studio/features', '/studio/canvas', '/studio/perler-beads'].includes(workspaceSection(pathname))
  const Icon = studioToolsNav.icon
  const link = <Link href={href} prefetch={false} onClick={onNavigate} aria-current={pathname === href ? 'page' : undefined} aria-label={collapsed ? tx('创作工具') : undefined} data-active={active ? 'true' : 'false'} data-tour="tools" className={cn('studio-nav-item flex h-10 items-center rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', collapsed ? 'mx-auto w-10 justify-center' : 'w-full gap-3 px-3', active ? 'text-studio-accent' : 'text-muted-foreground hover:text-foreground')}><Icon className="size-[18px] shrink-0" aria-hidden="true" />{!collapsed && <span className="truncate">{tx('创作工具')}</span>}</Link>
  return collapsed ? <Tooltip label={tx('创作工具')} side="right" className="flex w-full justify-center">{link}</Tooltip> : link
}
