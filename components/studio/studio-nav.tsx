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
  /** ������Щ·��ǰ׺ʱ����������ҳ�����ͬһ��һ����ڡ� */
  matches: readonly string[]
}

export const studioPrimaryNav: readonly StudioNavItem[] = [
  { label: '��ʼ����', href: '/studio', icon: LayoutGrid, matches: ['/studio', '/agent', '/image', '/video'] },
  { label: '�ҵ���Ŀ', href: '/projects', icon: FolderOpen, matches: ['/projects', '/drama', '/canvas'] },
  { label: '�����ʲ�', href: '/assets', icon: Library, matches: ['/assets'] },
]

export const studioSecondaryNav: readonly StudioNavItem[] = [
  { label: '���ɼ�¼', href: '/works', icon: History, matches: ['/works', '/gallery'] },
  { label: '����', href: '/tasks', icon: ListChecks, matches: ['/tasks'] },
  { label: '���ܿ�', href: '/skills', icon: Puzzle, matches: ['/skills'] },
  { label: '������', href: '/tools', icon: WandSparkles, matches: ['/tools'] },
]

export const studioAdminNav: StudioNavItem = { label: '����Ա��̨', href: '/admin', icon: ShieldCheck, matches: ['/admin'] }
export const studioSettingsNav: StudioNavItem = { label: '����', href: '/settings', icon: Settings, matches: ['/settings'] }

export function isNavItemActive(pathname: string, item: StudioNavItem) {
  return item.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

const rootTitles: Record<string, string> = {
  studio: '��ʼ����',
  agent: '���� Agent',
  image: 'ͼƬ����',
  video: '��Ƶ����',
  drama: '�̾�����',
  canvas: '���ɻ���',
  tasks: '����',
  works: '���ɼ�¼',
  gallery: '�㳡',
  projects: '�ҵ���Ŀ',
  assets: '�����ʲ�',
  skills: '���ܿ�',
  account: '�˻�',
  settings: '����',
  plans: '�ײ�',
  tools: '������',
}

const sectionTitles: Record<string, string> = {
  script: '�籾',
  storyboard: '�־�',
  shots: '��ͷ',
  characters: '��ɫ�볡��',
  cut: '��Ƭ',
  overview: '����',
  assets: '�ز�',
  canvas: '����',
  settings: '����',
}

/** ����ֻ��ʾ��ǰҳ�����ƣ���Ŀ��ҳ�渽����Ŀ��������ֻʣһ�������ķ������� */
export function studioPageTitle(pathname: string, projectTitle?: string) {
  const [root, id, section] = pathname.split('/').filter(Boolean)
  if (!root) return '��ʼ����'
  if (id && (root === 'projects' || root === 'drama')) {
    const name = projectTitle ?? (root === 'drama' ? '�̾���Ŀ' : '��Ŀ')
    if (!section) return name
    return `${name} �� ${sectionTitles[section] ?? section}`
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

