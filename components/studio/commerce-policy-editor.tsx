'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AdminSettings, SiteSettings } from '@/lib/studio/admin-types'
import {
  DEFAULT_COMMERCE_POLICY,
  getPurchaseReadiness,
  normalizeCommercePolicy,
  type CommercePolicy,
} from '@/lib/studio/commerce-policy'
import type { AdminSettingsPatch } from '@/lib/studio/admin-api'
import { ControlButton, StatusBadge } from './ui'
import { AdminField, AdminInput, AdminNotice, AdminSaveBar, AdminSectionCard, AdminTextarea } from './admin-kit'
import { useAdminSession } from './admin-shell'

type Props = {
  settings: AdminSettings
  onSave: (patch: AdminSettingsPatch, summary: string[]) => void
  saving: boolean
}

const fields: Array<{ key: keyof Pick<CommercePolicy, 'refundPolicy' | 'pointsExpiryPolicy' | 'renewalPolicy' | 'invoicePolicy'>; label: string; placeholder: string }> = [
  { key: 'refundPolicy', label: '退款规则', placeholder: '例如：未使用的积分可在购买后 7 日内申请退款；已消耗部分按实际消耗结算。' },
  { key: 'pointsExpiryPolicy', label: '积分有效期规则', placeholder: '例如：购买所得积分长期有效；活动赠送积分按活动页面标明的期限执行。' },
  { key: 'renewalPolicy', label: '续费规则', placeholder: '例如：套餐到期不会自动续费，用户需要主动再次购买。' },
  { key: 'invoicePolicy', label: '发票规则', placeholder: '例如：支付成功后可联系财务申请电子发票，开票信息以订单主体为准。' },
]

export function CommercePolicyEditor({ settings, onSave, saving }: Props) {
  const canManage = useAdminSession().can('commerce.manage')
  const savedPolicy = normalizeCommercePolicy(settings.commercePolicy ?? DEFAULT_COMMERCE_POLICY)
  const [draft, setDraft] = useState<CommercePolicy>(savedPolicy)

  useEffect(() => setDraft(savedPolicy), [settings.commercePolicy])

  const draftReady = useMemo(() => getPurchaseReadiness(settings.site as SiteSettings, draft, false), [draft, settings.site])
  const savedReady = useMemo(() => getPurchaseReadiness(settings.site as SiteSettings, savedPolicy, false), [savedPolicy, settings.site])
  const publishedReady = useMemo(() => getPurchaseReadiness(settings.site as SiteSettings, savedPolicy, true), [savedPolicy, settings.site])
  const changed = JSON.stringify(draft) !== JSON.stringify(savedPolicy)

  function update<K extends keyof CommercePolicy>(key: K, value: CommercePolicy[K]) {
    setDraft((current) => key === 'status'
      ? { ...current, status: value as CommercePolicy['status'] }
      : { ...current, [key]: value, status: 'draft' })
  }

  return (
    <AdminSectionCard title="购买政策" description="商用模式只有在购买政策、客服渠道和公开协议完整发布后才会允许下单。先保存草稿，再发布已保存版本。">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={savedPolicy.status === 'published' && publishedReady.ready ? 'success' : 'warning'}>{savedPolicy.status === 'published' && publishedReady.ready ? `已发布 ${savedPolicy.version}` : savedPolicy.version ? `草稿 ${savedPolicy.version}` : '尚未配置'}</StatusBadge>
        {draftReady.ready ? <StatusBadge tone="success">草稿字段完整</StatusBadge> : <StatusBadge tone="muted">草稿还缺 {draftReady.missing.length} 项</StatusBadge>}
      </div>
      {!canManage && <AdminNotice tone="neutral">当前管理员没有购买政策管理权限，可查看已保存内容；修改、发布或撤回需要商业管理职责。</AdminNotice>}
      <fieldset disabled={saving || !canManage} className="grid gap-4 sm:grid-cols-2">
        <AdminField label="购买政策版本" hint="每次发布内容变化时递增，例如 purchase-v1。"><AdminInput value={draft.version} onChange={(event) => update('version', event.target.value)} placeholder="purchase-v1" /></AdminField>
        <AdminField label="客服邮箱" hint="邮箱或 HTTPS 客服地址至少填写一项。"><AdminInput type="email" value={draft.supportEmail} onChange={(event) => update('supportEmail', event.target.value)} placeholder="support@example.com" /></AdminField>
        <AdminField label="客服地址" hint="可填写帮助中心或工单系统 HTTPS 地址。" className="sm:col-span-2"><AdminInput type="url" value={draft.supportUrl} onChange={(event) => update('supportUrl', event.target.value)} placeholder="https://example.com/support" /></AdminField>
        {fields.map((field) => <AdminField key={field.key} label={field.label} className="sm:col-span-2"><AdminTextarea rows={3} value={draft[field.key]} onChange={(event) => update(field.key, event.target.value)} placeholder={field.placeholder} /></AdminField>)}
      </fieldset>
      {!draftReady.ready && <AdminNotice tone="neutral">完成下面的购买政策字段，并在“站点与品牌”里填写服务条款、隐私政策版本和正文后，才能发布：{draftReady.missing.join('、')}。</AdminNotice>}
      {savedPolicy.status === 'published' && !publishedReady.ready && <AdminNotice tone="warning">当前已发布版本缺少必要配置，购买入口会被后端保护。请补齐站点协议并重新保存、发布。</AdminNotice>}
      <AdminSaveBar hint="政策内容修改后会自动回到草稿状态；发布只提交已经保存的版本。">
        <ControlButton type="button" variant="secondary" disabled={saving || !canManage || !changed} onClick={() => { if (canManage && !saving && changed) onSave({ commercePolicy: { ...draft, status: 'draft' } }, ['购买政策草稿']) }}>保存草稿</ControlButton>
        {savedPolicy.status === 'published' ? <ControlButton type="button" variant="secondary" disabled={saving || !canManage} onClick={() => { if (canManage && !saving) onSave({ commercePolicy: { ...savedPolicy, status: 'draft' } }, ['撤回购买政策']) }}>撤回发布</ControlButton> : <ControlButton type="button" variant="primary" disabled={saving || !canManage || changed || !savedReady.ready} onClick={() => { if (canManage && !saving && !changed && savedReady.ready) onSave({ commercePolicy: { ...savedPolicy, status: 'published' } }, ['发布购买政策']) }}>发布已保存版本</ControlButton>}
      </AdminSaveBar>
    </AdminSectionCard>
  )
}
