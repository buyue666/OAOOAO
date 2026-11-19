'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'
import type { AdminSettingsPatch } from '@/lib/studio/admin-api'
import { AdminNotice, AdminSaveBar, AdminSectionCard } from './admin-kit'
import { ControlButton } from './ui'

export function AdminAdultContentSettings({ visible = true, saving, onSave }: { visible?: boolean; saving: boolean; onSave: (patch: AdminSettingsPatch, summary: string[]) => void }) {
  const [showEntry, setShowEntry] = useState(visible)
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); onSave({ accountMenu: { adultContentSettingsVisible: showEntry } }, [showEntry ? '显示成人内容设置入口' : '隐藏成人内容设置入口']) }}>
    <AdminSectionCard title="成人内容设置入口" description="控制账户菜单中是否展示“成人内容设置”，适用于个人空间与团队空间。">
      <fieldset disabled={saving}>
        <label className="flex cursor-pointer items-start justify-between gap-4 text-sm"><span><span className="block font-medium">显示成人内容设置</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">勾选后显示账户入口；取消勾选后隐藏。点击保存后生效。</span></span><input type="checkbox" checked={showEntry} onChange={event => setShowEntry(event.target.checked)} className="mt-1 size-5 shrink-0 accent-teal-600" /></label>
      </fieldset>
    </AdminSectionCard>
    <AdminNotice>此开关只控制入口显示。账号已保存的内容偏好、年龄声明与模型使用限制继续生效；不会自动替用户开启成人内容。</AdminNotice>
    <AdminSaveBar hint="保存后同步更新账户菜单。"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-4" aria-hidden="true" />{saving ? '保存中…' : '保存成人内容设置'}</ControlButton></AdminSaveBar>
  </form>
}
