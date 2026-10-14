'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { updatePaymentProviderConfig } from '@/lib/studio/admin-api'
import type { AdminPaymentConfigSummary, AdminPaymentProviderConfig } from '@/lib/studio/admin-types'
import { assertPaymentProviderSaved, canConfigureOnlinePayment, paymentFieldLabel, paymentFieldVisible, paymentOptionLabel, paymentProviderInput, paymentProviderName, paymentValues } from '@/lib/studio/payment-provider-config'
import { AdminField, AdminInput, AdminNotice, AdminSaveBar, AdminSectionCard, AdminSelect, AdminTextarea } from './admin-kit'
import { ControlButton, StatusBadge } from './ui'

export function OnlinePaymentProviderEditor({ provider, onSaved, onMessage, onError }: { provider: AdminPaymentProviderConfig; onSaved: (value: AdminPaymentConfigSummary) => void; onMessage: (value: string) => void; onError: (value: string) => void }) {
  const [enabled, setEnabled] = useState(provider.enabled)
  const [values, setValues] = useState(() => paymentValues(provider))
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const mounted = useRef(true)
  // Saving another provider returns a new summary object. Do not discard this provider's draft for an unchanged snapshot.
  const savedRevision = JSON.stringify({ id: provider.id, enabled: provider.enabled, fields: provider.fields.map(field => [field.key, field.value, field.configured]) })
  const savedProvider = useRef(provider); savedProvider.current = provider
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setEnabled(savedProvider.current.enabled); setValues(paymentValues(savedProvider.current)) }, [savedRevision])
  if (!canConfigureOnlinePayment(provider)) return <AdminNotice tone="warning">该支付渠道暂未接入，现有配置不会被此页面修改。</AdminNotice>
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setSaving(true); onError(''); onMessage('')
    try {
      const input = paymentProviderInput(provider, enabled, values)
      const next = await updatePaymentProviderConfig(input.providerId, input.enabled, input.values)
      if (!mounted.current) return
      assertPaymentProviderSaved(next, input)
      onSaved(next)
      setValues(paymentValues(next.providers.find(item => item.id === provider.id)!))
      onMessage(`${paymentProviderName(provider)}配置已保存。${input.enabled ? '请在商户后台确认回调配置，并完成实际付款、到账和回调测试。' : '该渠道保持关闭。'}`)
    } catch (reason) { if (mounted.current) onError(reason instanceof Error ? reason.message : '支付配置保存失败。') }
    finally { lock.current = false; if (mounted.current) setSaving(false) }
  }
  return <form onSubmit={submit} aria-busy={saving}>
    <AdminSectionCard title={paymentProviderName(provider)} description="配置支付网关、签名协议和默认付款方式。配置完整只代表必要字段齐全，不代表已经核实实际收款。">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"><div className="flex flex-wrap gap-2"><StatusBadge tone={provider.ready ? 'success' : 'neutral'}>{provider.ready ? '配置完整' : provider.enabled ? '已开启 · 待完善' : '已关闭'}</StatusBadge></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={saving} />启用{paymentProviderName(provider)}</label></div>
      <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {provider.fields.filter(field => paymentFieldVisible(field, values)).map(field => {
          const secret = field.secret || field.kind === 'secret'
          const multiline = field.kind === 'textarea' || field.key === 'merchantPrivateKey' || field.key === 'platformPublicKey'
          const common = { name: `payment.${provider.id}.${field.key}`, value: values[field.key] ?? '', onChange: (event: { target: { value: string } }) => setValues(current => ({ ...current, [field.key]: event.target.value })) }
          const hint = secret ? field.configured ? '已保存，留空保留原凭证。输入新值会替换，保存后不会回显。' : '尚未保存此凭证。' : field.note
          return <AdminField key={field.key} label={paymentFieldLabel(field)} hint={hint} className={multiline || field.kind === 'url' ? 'sm:col-span-2' : undefined}>
            {field.kind === 'select' ? <AdminSelect {...common}>{field.options?.map(option => <option key={option.value} value={option.value}>{paymentOptionLabel(option.value, option.label)}</option>)}</AdminSelect>
              : multiline ? <AdminTextarea {...common} rows={5} maxLength={16000} autoComplete="off" spellCheck={false} placeholder={secret && field.configured ? '留空保留已保存凭证' : field.placeholder} className="font-mono text-xs" />
                : <AdminInput {...common} type={secret ? 'password' : field.kind === 'url' ? 'url' : 'text'} maxLength={2048} autoComplete={secret ? 'new-password' : 'off'} placeholder={secret && field.configured ? '留空保留已保存凭证' : field.placeholder} />}
          </AdminField>
        })}
        {provider.webhookUrl && <AdminField label="异步通知地址" hint="复制到支付商户后台。积分与权益只会在服务端确认有效支付通知后发放，页面跳转不代表付款成功。" className="sm:col-span-2"><AdminInput readOnly value={provider.webhookUrl} /></AdminField>}
      </fieldset>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">V2 使用 RSA 签名，需商户私钥与平台公钥；V1 使用 MD5 商户密钥。请按你使用的支付平台协议选择，切换协议不会自动转换凭证。</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">易支付退款需先在本站订单中预留退款积分，再到支付平台人工退款并核实，最后回本站确认；只有确认未转账时才能取消预留。本站不会自动向支付平台发起退款。</p>
      <AdminSaveBar hint="只保存当前渠道，不会修改其他支付方式或确认任何订单。"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-3.5" />{saving ? '保存中' : `保存${paymentProviderName(provider)}配置`}</ControlButton></AdminSaveBar>
    </AdminSectionCard>
  </form>
}
