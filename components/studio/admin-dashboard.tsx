'use client'

import { AdminAccessBoundary, adminSectionFromValue } from './admin-shell'
import { AdminOverviewPanel } from './admin-overview'
import { AdminUsersPanel } from './admin-users'
import { AdminGenerationPanel } from './admin-generation'
import { AdminChannelsPanel } from './admin-channels'
import { AdminProductsPanel, AdminOrdersPanel } from './admin-commerce'
import { AdminContentPanel } from './admin-content'
import { AdminSettingsPanel } from './admin-settings'
import { AdminAuditPanel } from './admin-audit'
import type { AdminSection } from '@/lib/studio/admin-types'

/**
 * OAOOAO 控制中心入口。所有页面共享同一套会话、权限与刷新上下文，
 * 每个模块只渲染自己需要的接口数据，不使用本地演示数据。
 */
export function AdminDashboard({ section: rawSection = 'overview' }: { section?: string }) {
  const section: AdminSection = adminSectionFromValue(rawSection)
  return (
    <AdminAccessBoundary section={section}>
      {section === 'overview' && <AdminOverviewPanel />}
      {section === 'users' && <AdminUsersPanel />}
      {section === 'generation' && <AdminGenerationPanel />}
      {section === 'channels' && <AdminChannelsPanel />}
      {section === 'products' && <AdminProductsPanel />}
      {section === 'orders' && <AdminOrdersPanel />}
      {section === 'content' && <AdminContentPanel />}
      {section === 'settings' && <AdminSettingsPanel />}
      {section === 'audit' && <AdminAuditPanel />}
    </AdminAccessBoundary>
  )
}
