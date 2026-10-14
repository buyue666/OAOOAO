'use client'

import { useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import type { AdminSettingsPatch } from '@/lib/studio/admin-api'
import type { WechatOfficialSettings } from '@/lib/studio/admin-types'
import { WECHAT_SECRET_FIELDS, wechatSettingsInput } from '@/lib/studio/wechat-settings'
import { AdminField, AdminInput, AdminNotice, AdminSaveBar, AdminSectionCard } from './admin-kit'
import { ControlButton, StatusBadge } from './ui'

export function AdminWechatSettings({ settings, registrationEnabled, saving, onSave }: { settings?: WechatOfficialSettings; registrationEnabled: boolean; saving: boolean; onSave: (patch: AdminSettingsPatch, summary: string[]) => void }) {
  const [error, setError] = useState('')
  if (!settings) return <AdminNotice tone="warning">当前后端未提供微信登录配置，请在升级后重新读取设置。</AdminNotice>
  const saved = settings
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setError('')
    try {
      const input = wechatSettingsInput(saved, new FormData(event.currentTarget))
      const summary = ['微信公众号登录配置']
      if (input.appId !== saved.appId) summary.push('公众号 AppID')
      if (input.enabled !== saved.enabled) summary.push(input.enabled ? '开启扫码登录' : '关闭扫码登录')
      if (input.autoRegister !== saved.autoRegister) summary.push('微信新用户自动注册')
      for (const field of WECHAT_SECRET_FIELDS) if (input[field.key] || input[field.clear]) summary.push(`${input[field.clear] ? '清除' : '更新'} ${field.label}`)
      onSave({ wechatOfficial: input }, summary)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '请检查微信登录配置。') }
  }
  return <form onSubmit={submit} className="space-y-5">
    <AdminSectionCard title="微信扫码登录" description="使用微信公众号的临时二维码确认身份。仅支持安全模式（AES 加密消息）；请使用你有权管理、具备相应接口权限的公众号。">
      <div className="mb-5 flex flex-wrap gap-2"><StatusBadge tone={saved.enabled ? 'success' : 'neutral'}>{saved.enabled ? '已开启' : '已关闭'}</StatusBadge><StatusBadge tone={saved.configured ? 'success' : 'warning'}>{saved.configured ? '配置完整' : '配置待完善'}</StatusBadge></div>
      <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="wechatEnabled" defaultChecked={saved.enabled} />开启微信扫码登录</label>
        <AdminField label="公众号标识（AppID）" hint="更换 AppID 需重新填写全部凭证；已有微信身份时不可直接换公众号。" className="sm:col-span-2"><AdminInput name="wechatAppId" defaultValue={saved.appId} placeholder="wx…" maxLength={18} autoComplete="off" /></AdminField>
        {WECHAT_SECRET_FIELDS.map(field => <div key={field.key} className="min-w-0 space-y-2 sm:col-span-2">
          <AdminField label={field.label} hint={saved[field.saved] ? '已保存。留空保留原值，填写新值后替换；密钥不会回显。' : '尚未保存。关闭登录时可先保存未完成的配置。'}><AdminInput type="password" name={field.key} autoComplete="new-password" maxLength={field.key === 'encodingAESKey' ? 43 : 512} placeholder={saved[field.saved] ? '留空保留已保存凭证' : '填写微信提供的凭证'} /></AdminField>
          {saved[field.saved] && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" name={field.clear} />明确清除已保存的 {field.label}（需先关闭扫码登录）</label>}
        </div>)}
        <AdminField label="服务器回调地址" hint="在公众号后台的服务器配置中填写此地址，消息加解密方式选择“安全模式”。" className="sm:col-span-2"><AdminInput readOnly value={saved.callbackUrl || ''} placeholder="后端尚未返回回调地址" /></AdminField>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="wechatAutoRegister" defaultChecked={saved.autoRegister} className="mt-1" /><span>允许新微信身份自动创建账号<span className="mt-1 block text-xs leading-5 text-muted-foreground">同时需要“注册与积分”中的开放注册。开启邮箱验证注册时，用户需先注册并验证邮箱，再登录账户绑定微信。不会根据微信昵称或邮箱自动合并已有账号。</span></span></label>
      </fieldset>
      {!registrationEnabled && <p className="mt-4 text-xs leading-5 text-amber-600 dark:text-amber-300">当前站点关闭注册：已有绑定仍可登录，新微信身份不能创建账号。</p>}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">配置完整只表示必要字段齐全。保存后仍需在微信后台完成服务器验证，并实际扫码验证登录流程。</p>
    </AdminSectionCard>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <AdminSaveBar hint="保存前会展示变更摘要，凭证内容不会出现在摘要中。"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-3.5" />{saving ? '保存中' : '保存微信登录配置'}</ControlButton></AdminSaveBar>
  </form>
}
