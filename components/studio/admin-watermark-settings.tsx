'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { AdminSettingsPatch } from '@/lib/studio/admin-api'
import { AdminNotice, AdminSaveBar, AdminSectionCard } from './admin-kit'
import { ControlButton } from './ui'

export function AdminWatermarkSettings({ policy, saving, onSave }: { policy?: { enabled: boolean; confirmationRequired: boolean }; saving: boolean; onSave: (patch: AdminSettingsPatch, summary: string[]) => void }) {
  const initial = { enabled: policy?.enabled !== false, confirmationRequired: policy?.confirmationRequired !== false }
  const [enabled, setEnabled] = useState(initial.enabled), [confirmationRequired, setConfirmationRequired] = useState(initial.confirmationRequired)
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); onSave({ watermarkPolicy: { enabled, confirmationRequired } }, [enabled ? '启用 AI 生成水印' : '关闭 AI 生成水印', confirmationRequired ? '关闭水印需要用户确认' : '关闭水印无需用户确认']) }}>
    <AdminSectionCard title="AI 生成水印设置" description="控制 OAO 为图片、视频导出副本添加的可见标识。保存后对新发起的下载生效。">
      <fieldset disabled={saving} className="space-y-4">
        <label className="flex cursor-pointer items-start justify-between gap-4 border-b border-border pb-4 text-sm"><span><span className="block font-medium">启用 AI 生成水印</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">开启后沿用各账号的水印偏好；关闭后直接导出原文件，账户菜单中的水印设置入口会隐藏。</span></span><input type="checkbox" role="switch" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="mt-1 size-5 shrink-0 accent-teal-600" /></label>
        <label className="flex cursor-pointer items-start justify-between gap-4 text-sm"><span><span className="block font-medium">关闭水印时需要用户确认</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">开启后，用户需阅读说明并勾选确认，才能关闭账户水印。此设置与下载链接免登录访问相互独立。</span></span><input type="checkbox" role="switch" checked={confirmationRequired} onChange={event => setConfirmationRequired(event.target.checked)} className="mt-1 size-5 shrink-0 accent-teal-600" /></label>
      </fieldset>
    </AdminSectionCard>
    <AdminNotice>原文件、已下载文件和上游自带的标识不会被修改。已有图片、视频链接可免登录访问，资产列表、上传、删除及管理设置仍按账户权限控制。</AdminNotice>
    <AdminSaveBar hint="保存后立即生效。"><ControlButton type="submit" variant="primary" disabled={saving || enabled === initial.enabled && confirmationRequired === initial.confirmationRequired}><ShieldCheck className="size-3.5" />{saving ? '保存中' : '保存水印设置'}</ControlButton></AdminSaveBar>
  </form>
}
