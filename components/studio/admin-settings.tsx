'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Cloud, Database, Gem, Mail, RefreshCw, Save, Server, Settings2, ShieldCheck, Wallet } from 'lucide-react'
import {
  getAdminSettings,
  getPaymentConfig,
  getObjectStorage,
  sendTestMail,
  testObjectStorage,
  updateObjectStorage,
  updateAdminSettings,
  updatePaymentProviderConfig,
  type AdminSettingsPatch,
} from '@/lib/studio/admin-api'
import type { AdminPaymentConfigSummary, AdminPaymentProviderConfig, AdminSettings, GenerationConcurrencySettings, GenerationDefaultSettings, MailSettings, ObjectStorageSettings } from '@/lib/studio/admin-types'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminDefinition,
  AdminEmpty,
  AdminError,
  AdminField,
  AdminInput,
  AdminLoading,
  AdminNotice,
  AdminSaveBar,
  AdminSectionCard,
  AdminSelect,
  AdminTabs,
  AdminTextarea,
  formatAdminNumber,
  useConfirm,
} from './admin-kit'
import { useAdminNavigation, useAdminReload, useAdminSession } from './admin-shell'
import { CommercePolicyEditor } from './commerce-policy-editor'
import { AdminSiteSettings } from './admin-site-settings'
import { AdminCheckInSettings } from './admin-check-in-settings'
import { AdminWechatSettings } from './admin-wechat-settings'
import { OnlinePaymentProviderEditor } from './admin-payment-provider'
import { canConfigureOnlinePayment, paymentProviderName } from '@/lib/studio/payment-provider-config'
import { checkInRuleChanges, readCheckInForm } from '@/lib/studio/check-in-rules'
import { allowedGenerationKinds, ENTITLEMENT_GENERATION_KINDS } from '@/lib/studio/entitlement-features'
import { assertStorageSaved, CREATIVE_STORAGE_NOTICE, storageTestMessage, storageUpdateInput } from '@/lib/studio/object-storage-status'
import { assertManualPaymentSaved, canConfigureManualPayment, MANUAL_INSTRUCTIONS_LIMIT, manualPaymentInput, manualPaymentInstructions } from '@/lib/studio/manual-payment-config'

type SectionId = 'site' | 'account' | 'wechat' | 'billing' | 'points' | 'generation' | 'mail' | 'storage' | 'lifecycle'

export function AdminSettingsPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [storage, setStorage] = useState<ObjectStorageSettings | null>(null)
  const [paymentConfig, setPaymentConfig] = useState<AdminPaymentConfigSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [section, setSection] = useState<SectionId>('site')
  const [saving, setSaving] = useState(false)
  const [siteDirty, setSiteDirty] = useState(false)
  const siteDirtyRef = useRef(false)
  siteDirtyRef.current = siteDirty
  const [formRevision, setFormRevision] = useState(0)
  const [loadWarnings, setLoadWarnings] = useState<string[]>([])
  const confirm = useConfirm()
  const { registerGuard } = useAdminNavigation()
  useEffect(() => {
    registerGuard(siteDirty ? (proceed) => confirm.confirm({ title: '离开前放弃品牌更改？', description: '你还有未保存的站点配置。', notice: '此操作只放弃当前草稿，已保存的配置不会改变。', confirmLabel: '放弃并离开', tone: 'default', onConfirm: () => { setSiteDirty(false); proceed() } }) : null)
    return () => registerGuard(null)
  }, [siteDirty, registerGuard, confirm.confirm])

  const canSystem = session.can('system.manage')
  const canBilling = session.can('billing.manage')
  const canCommerce = session.can('commerce.manage')
  const canUpstream = session.can('upstream.manage')
  const requestVersion = useRef(0)

  const load = useCallback(() => {
    const version = ++requestVersion.current
    setLoading(true); setError(''); setLoadWarnings([])
    Promise.allSettled([getAdminSettings(), canSystem ? getObjectStorage() : Promise.resolve(null), canBilling ? getPaymentConfig() : Promise.resolve(null)])
      .then(([next, objectStorage, nextPaymentConfig]) => {
        if (version !== requestVersion.current) return
        if (next.status === 'fulfilled') {
          if (siteDirtyRef.current) setMessage('配置已读取，当前有未保存的品牌更改，已保留你的草稿。')
          else { setSettings(next.value); setFormRevision((value) => value + 1) }
        }
        else setError(next.reason instanceof Error ? next.reason.message : '系统设置加载失败')
        const warnings: string[] = []
        if (objectStorage.status === 'fulfilled') setStorage(objectStorage.value)
        else warnings.push('对象存储配置读取失败，请重试。当前不能据此判断存储是否已配置。')
        if (nextPaymentConfig.status === 'fulfilled') setPaymentConfig(nextPaymentConfig.value)
        else warnings.push('支付配置读取失败，请重试。当前不能据此判断支付是否可用。')
        setLoadWarnings(warnings)
        setLoading(false)
      })
  }, [canSystem, canBilling, reloadKey])

  useEffect(() => { void load(); return () => { requestVersion.current += 1 } }, [load])

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('section')
    if (requested && ['site', 'account', 'wechat', 'billing', 'points', 'generation', 'mail', 'storage', 'lifecycle'].includes(requested)) setSection(requested as SectionId)
  }, [])

  function changeSection(next: SectionId) {
    if (next === section) return
    const select = () => {
      setSection(next); setSiteDirty(false); setMessage('')
      const url = new URL(window.location.href)
      url.searchParams.set('section', next)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    if (siteDirty) confirm.confirm({ title: '离开前放弃品牌更改？', description: '当前站点配置尚未保存，切换分组后这次更改会丢失。', notice: '此操作只放弃当前草稿，已保存的配置不会改变。', confirmLabel: '放弃并切换', tone: 'default', onConfirm: select })
    else select()
  }

  /** 所有保存都先展示变更摘要，再由管理员确认。 */
  const save = useCallback((label: string, patch: AdminSettingsPatch, summary: string[]) => {
    confirm.confirm({
      title: `保存${label}？`,
      description: summary.length ? `将更新：${summary.join('、')}。` : '将提交当前表单内容。',
      confirmLabel: '确认保存',
      tone: 'default',
      onConfirm: async () => {
        setSaving(true); setError(''); setMessage('')
        try {
          const result = await updateAdminSettings(patch)
          requestVersion.current += 1
          setSettings(result.settings)
          setSiteDirty(false)
          setFormRevision((value) => value + 1)
          setLoading(false)
          setMessage(`${label}已保存`)
        } finally { setSaving(false) }
      },
    })
  }, [confirm])

  if (loading && !settings) return <AdminLoading label="正在读取系统设置" rows={5} />
  if (!settings) return <AdminError message={error || '系统设置加载失败'} retry={load} />

  const sections: Array<{ id: SectionId; label: string; visible: boolean }> = [
    { id: 'site', label: '站点与品牌', visible: canSystem },
    { id: 'account', label: '注册与积分', visible: canSystem || canCommerce },
    { id: 'wechat', label: '微信登录', visible: canSystem },
    { id: 'billing', label: '运营与支付', visible: canSystem || canCommerce || canBilling },
    { id: 'points', label: '计费与权益', visible: canCommerce },
    { id: 'generation', label: '生成限制与默认参数', visible: canUpstream },
    { id: 'mail', label: '邮件服务', visible: canSystem },
    { id: 'storage', label: '对象存储', visible: canSystem },
    { id: 'lifecycle', label: '数据保留', visible: canSystem },
  ]
  const visibleSections = sections.filter((item) => item.visible)
  const active = visibleSections.some((item) => item.id === section) ? section : visibleSections[0]?.id

  return (
    <div className="flex flex-col gap-5">
      {confirm.dialog}
      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}
      {loadWarnings.map((warning) => <AdminError key={warning} message={warning} retry={load} />)}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge tone="neutral">{settings.operationMode === 'commercial' ? '商用模式' : '自用模式'}</StatusBadge>
        <StatusBadge tone={settings.registrationEnabled ? 'success' : 'neutral'}>{settings.registrationEnabled ? '开放注册' : '注册已关闭'}</StatusBadge>
        <span className="ml-auto text-muted-foreground">{loading ? '正在同步配置…' : `${visibleSections.length} 个设置分组`}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[176px_minmax(0,1fr)] lg:items-start">
        {active && (
          <nav aria-label="系统设置分组" className="rounded-xl border border-border bg-card p-2 lg:sticky lg:top-[88px]">
            <div className="lg:hidden"><AdminSelect aria-label="选择设置分组" value={active} onChange={(event) => changeSection(event.target.value as SectionId)}>{visibleSections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</AdminSelect></div>
            <div className="hidden lg:block"><AdminTabs label="系统设置分组" orientation="vertical" items={visibleSections.map((item) => [item.id, item.label] as const)} value={active} onChange={changeSection} /></div>
          </nav>
        )}

        <div key={active === 'site' ? 'site' : `${active}:${formRevision}`} role="tabpanel" aria-label={visibleSections.find((item) => item.id === active)?.label} className="flex min-w-0 flex-col gap-5">
          {active === 'site' && <AdminSiteSettings site={settings.site || {}} onSave={(patch, summary) => save('站点设置', patch, summary)} saving={saving} onDirtyChange={setSiteDirty} />}
          {active === 'account' && <AccountSection settings={settings} canSystem={canSystem} canCommerce={canCommerce} onSave={(patch, summary) => save('注册与积分设置', patch, summary)} saving={saving} />}
          {active === 'wechat' && <AdminWechatSettings settings={settings.wechatOfficial} registrationEnabled={settings.registrationEnabled} saving={saving} onSave={(patch, summary) => save('微信登录设置', patch, summary)} />}
          {active === 'billing' && <BillingSection settings={settings} paymentConfig={paymentConfig} canSystem={canSystem} canCommerce={canCommerce} canBilling={canBilling} saving={saving} onModeSave={(patch, summary) => save('commercePolicy' in patch ? '购买政策' : '运营模式设置', patch, summary)} onPaymentConfigChange={setPaymentConfig} onMessage={setMessage} onError={setError} />}
          {active === 'points' && <PointsSection settings={settings} canUpstream={canUpstream} onSave={(patch, summary) => save('计费与权益设置', patch, summary)} saving={saving} />}
          {active === 'generation' && <GenerationSection settings={settings} onSave={(patch, summary) => save('生成设置', patch, summary)} saving={saving} />}
          {active === 'mail' && <MailSection settings={settings} onSave={(patch, summary) => save('邮件设置', patch, summary)} saving={saving} />}
          {active === 'storage' && <StorageSection storage={storage} onReload={load} onMessage={setMessage} onError={setError} />}
          {active === 'lifecycle' && <LifecycleSection settings={settings} onSave={(patch, summary) => save('数据保留设置', patch, summary)} saving={saving} />}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ 运营与支付 ------------------------------ */

function BillingSection({
  settings,
  paymentConfig,
  canSystem,
  canCommerce,
  canBilling,
  saving,
  onModeSave,
  onPaymentConfigChange,
  onMessage,
  onError,
}: {
  settings: AdminSettings
  paymentConfig: AdminPaymentConfigSummary | null
  canSystem: boolean
  canCommerce: boolean
  canBilling: boolean
  saving: boolean
  onModeSave: (patch: AdminSettingsPatch, summary: string[]) => void
  onPaymentConfigChange: (value: AdminPaymentConfigSummary) => void
  onMessage: (value: string) => void
  onError: (value: string) => void
}) {
  const mode = settings.operationMode === 'commercial' ? 'commercial' : 'self_use'
  const manual = paymentConfig?.providers.find((provider) => provider.id === 'manual')

  function submitMode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSystem || saving) return
    const data = new FormData(event.currentTarget)
    const nextMode = data.get('operationMode') === 'commercial' ? 'commercial' : 'self_use'
    onModeSave({ operationMode: nextMode }, nextMode === mode ? [] : ['站点运营模式'])
  }

  return (
    <div className="flex flex-col gap-4">
      {canSystem && <form onSubmit={submitMode}>
        <AdminSectionCard title="站点运营模式" description="自用模式关闭用户充值、套餐购买和在线支付；商用模式才会开放公开计费入口。模式限制由系统同时执行。">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-end">
            <AdminField label="当前模式">
              <AdminSelect name="operationMode" defaultValue={mode} disabled={saving}>
                <option value="self_use">自用模式</option>
                <option value="commercial">商用模式</option>
              </AdminSelect>
            </AdminField>
            {mode === 'self_use'
              ? <AdminNotice tone="warning">当前用户只能使用已有积分，前台不会显示充值入口；管理员仍可手动调整积分。</AdminNotice>
              : <AdminNotice tone="neutral">商用模式下，购买入口还需要已发布的客户政策和可用收款配置。人工收款由管理员核实到账；在线渠道以服务端验证的支付通知为准。</AdminNotice>}
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">保存时会先确认变更。</p>
            <ControlButton type="submit" variant="primary" disabled={saving} className="w-full shrink-0 sm:w-auto"><Save className="size-3.5" />{saving ? '保存中' : '保存运营模式'}</ControlButton>
          </div>
        </AdminSectionCard>
      </form>}

      {canCommerce && <CommercePolicyEditor settings={settings} onSave={onModeSave} saving={saving} />}

      {canBilling && <PaymentProviderEditor provider={manual} onSaved={onPaymentConfigChange} onMessage={onMessage} onError={onError} />}
      {canBilling && paymentConfig?.providers.filter(canConfigureOnlinePayment).map(provider => <OnlinePaymentProviderEditor key={provider.id} provider={provider} onSaved={onPaymentConfigChange} onMessage={onMessage} onError={onError} />)}

      {canBilling && paymentConfig && <AdminSectionCard title="支付渠道概览" description="状态表示当前配置是否完整。未接入的渠道不提供启用或编辑操作；已保存配置保持不变。">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {paymentConfig.providers.map((provider) => (
            <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
              <div className="min-w-0"><p className="truncate font-medium text-foreground">{paymentProviderName(provider)}</p><p className="mt-1 text-[11px] text-muted-foreground">{canConfigureManualPayment(provider) ? '由管理员核实到账后确认订单' : canConfigureOnlinePayment(provider) ? '由服务端验证支付通知后确认订单' : '暂不支持在线收款或自动回调；已有配置保留'}</p></div>
              <StatusBadge tone={provider.ready ? 'success' : provider.enabled && (canConfigureManualPayment(provider) || canConfigureOnlinePayment(provider)) ? 'warning' : 'neutral'}>{!canConfigureManualPayment(provider) && !canConfigureOnlinePayment(provider) ? '未接入' : provider.ready ? '配置就绪' : provider.enabled ? '待配置' : '已关闭'}</StatusBadge>
            </div>
          ))}
        </div>
      </AdminSectionCard>}
    </div>
  )
}

function PaymentProviderEditor({
  provider,
  onSaved,
  onMessage,
  onError,
}: {
  provider?: AdminPaymentProviderConfig
  onSaved: (value: AdminPaymentConfigSummary) => void
  onMessage: (value: string) => void
  onError: (value: string) => void
}) {
  const [enabled, setEnabled] = useState(provider?.enabled === true)
  const [instructions, setInstructions] = useState(() => manualPaymentInstructions(provider))
  const savedInstructions = manualPaymentInstructions(provider)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    setEnabled(provider?.enabled === true)
    setInstructions(savedInstructions)
  }, [provider?.id, provider?.enabled, savedInstructions])

  if (!canConfigureManualPayment(provider)) return <AdminSectionCard title="人工收款" description="当前无法编辑收款配置。"><AdminNotice tone="warning">系统未返回可用的人工收款配置。请检查读取权限并重新读取设置；现有配置不会改变。</AdminNotice></AdminSectionCard>
  const currentProvider = provider

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true); onError(''); onMessage('')
    try {
      const input = manualPaymentInput(currentProvider, enabled, instructions)
      const next = await updatePaymentProviderConfig(input.providerId, input.enabled, input.values)
      assertManualPaymentSaved(next, input)
      onSaved(next)
      onMessage(input.enabled ? '人工收款配置已保存。订单到账仍需管理员核实并确认。' : '人工收款配置已保存，收款入口已关闭。')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '人工收款配置保存失败')
    } finally { savingRef.current = false; setSaving(false) }
  }

  return (
    <form onSubmit={submit} aria-busy={saving}>
      <AdminSectionCard title="人工收款" description="购买者按说明在站外付款；管理员核实实际到账后，在订单管理中确认收款，系统才发放积分或套餐权益。系统不会自动转账。">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex flex-wrap items-center gap-2 text-xs"><StatusBadge tone={provider.ready ? 'success' : provider.enabled ? 'warning' : 'neutral'}>{provider.ready ? '已保存配置就绪' : provider.enabled ? '已保存配置待完善' : '当前已关闭'}</StatusBadge><StatusBadge tone="neutral">无需自动回调</StatusBadge></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={saving} />启用人工收款</label>
        </div>
        <fieldset disabled={saving} className="mt-4">
          <AdminField label="给购买者的收款说明" hint="说明会显示在结算页面，请填写付款方式、核实要求及联系方法，不要填写密钥或管理员凭据。">
            <AdminTextarea name="instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} required={enabled} maxLength={MANUAL_INSTRUCTIONS_LIMIT} placeholder="例如：付款前联系客服确认收款信息，付款时备注订单号。到账经管理员核实后开通权益。" rows={6} />
          </AdminField>
        </fieldset>
        <AdminSaveBar hint="保存仅更新人工收款配置，不会确认任何订单收款。"><ControlButton type="submit" variant="primary" disabled={saving}><Wallet className="size-3.5" />{saving ? '保存中' : '保存人工收款配置'}</ControlButton></AdminSaveBar>
      </AdminSectionCard>
    </form>
  )
}

/* ------------------------------ 注册与积分 ------------------------------ */

function AccountSection({ settings, canSystem, canCommerce, onSave, saving }: { settings: AdminSettings; canSystem: boolean; canCommerce: boolean; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const checkIn = settings.checkIn ?? { enabled: false, rewardPoints: 10 }
  const [formError, setFormError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setFormError('')
    const data = new FormData(event.currentTarget)
    const patch: AdminSettingsPatch = {}
    const summary: string[] = []
    if (canSystem) {
      const registration = data.has('registrationEnabled')
      patch.registrationEnabled = registration
      if (registration !== settings.registrationEnabled) summary.push('开放注册')
    }
    if (canCommerce) {
      const enabled = data.has('freeDailyPointsEnabled')
      const amount = Number(data.get('freeDailyPoints')) || 0
      patch.freeDailyPointsEnabled = enabled
      patch.freeDailyPoints = amount
      if (enabled !== settings.freeDailyPointsEnabled) summary.push('每日自动额度开关')
      if (amount !== settings.freeDailyPoints) summary.push('每日自动额度数量')
      try { patch.checkIn = readCheckInForm(data, settings.entitlements.plans) }
      catch (reason) { setFormError(reason instanceof Error ? reason.message : '请检查签到奖励规则。'); return }
      summary.push(...checkInRuleChanges(checkIn, patch.checkIn, settings.entitlements.plans))
    }
    onSave(patch, summary)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {canSystem && <AdminSectionCard title="注册开关" description="控制新用户注册入口。关闭后仅管理员可以创建账号。">
        <fieldset disabled={saving} className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 border-b border-border pb-3 text-sm"><span><span className="font-medium">开放注册</span><span className="mt-1 block text-xs text-muted-foreground">关闭后站点注册入口对所有访客隐藏。</span></span><input type="checkbox" name="registrationEnabled" defaultChecked={settings.registrationEnabled} /></label>
          <div className="flex items-center justify-between gap-4 text-sm"><span><span className="font-medium">邮箱验证（注册必需）</span><span className="mt-1 block text-xs text-muted-foreground">普通账号注册必须通过邮箱验证码；开放注册前，请先配置并验证邮件服务。</span></span><span className="shrink-0 rounded-full border border-studio-accent/30 bg-studio-accent/10 px-2.5 py-1 text-xs font-medium text-studio-accent">固定开启</span></div>
        </fieldset>
      </AdminSectionCard>}
      {canCommerce && <AdminSectionCard title="每日签到" description="用户主动点击后领取积分，不会自动发放。按北京时间（Asia/Shanghai）每天 00:00 换日，同一账号每天只能领取一次。">
        <AdminCheckInSettings settings={checkIn} plans={settings.entitlements.plans} saving={saving} />
        <p className="mt-4 text-xs leading-5 text-muted-foreground">规则仅影响之后的签到，已有奖励的金额和到期时间不变。同一天升级套餐不能再次领取。关闭签到后停止新的领取；已到账奖励仍按领取时的有效期使用。</p>
      </AdminSectionCard>}
      {canCommerce && <AdminSectionCard title="每日自动额度" description="系统在读取钱包时自动刷新当天额度，无需签到。按 UTC 00:00（北京时间 08:00）换日，未用额度到期清零；与手动签到奖励分别记录。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="freeDailyPointsEnabled" defaultChecked={settings.freeDailyPointsEnabled} />启用每日自动额度</label>
          <AdminField label="每日积分额度"><AdminInput name="freeDailyPoints" type="number" min="0" step="1" defaultValue={settings.freeDailyPoints} /></AdminField>
        </fieldset>
      </AdminSectionCard>}
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <AdminSaveBar hint="保存前会列出变更项，确认后才写入。"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-3.5" />{saving ? '保存中' : '保存注册与积分'}</ControlButton></AdminSaveBar>
    </form>
  )
}

/* ------------------------------ 计费与权益 ------------------------------ */

function PointsSection({ settings, onSave, saving, canUpstream }: { settings: AdminSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean; canUpstream: boolean }) {
  const [plans, setPlans] = useState(settings.entitlements.plans.map((plan) => ({ ...plan, limits: { ...plan.limits }, features: [...(plan.features ?? [])], allowedGenerationKinds: allowedGenerationKinds(plan) })))
  const [entitlementsEnabled, setEntitlementsEnabled] = useState(settings.entitlements.enabled)
  const [defaultPlanId, setDefaultPlanId] = useState(settings.entitlements.defaultPlanId)
  const [limits, setLimits] = useState(settings.generationCostControl)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entitlements = { enabled: entitlementsEnabled, defaultPlanId, plans }
    const summary: string[] = []
    if (JSON.stringify(entitlements) !== JSON.stringify(settings.entitlements)) summary.push('套餐权益')
    if (canUpstream && JSON.stringify(limits) !== JSON.stringify(settings.generationCostControl)) summary.push('生成成本控制')
    onSave({
      entitlements,
      ...(canUpstream ? { generationCostControl: limits } : {}),
    }, summary)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {canUpstream && <AdminSectionCard title="成本控制上限" description="限制单次任务与每日积分消耗，0 表示不限制。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-3">
          <AdminField label="单任务积分上限"><AdminInput type="number" min="0" value={limits.maxPointsPerTask ?? 0} onChange={(event) => setLimits({ ...limits, maxPointsPerTask: Number(event.target.value) || 0 })} /></AdminField>
          <AdminField label="单用户每日上限"><AdminInput type="number" min="0" value={limits.dailyUserPointSpend ?? 0} onChange={(event) => setLimits({ ...limits, dailyUserPointSpend: Number(event.target.value) || 0 })} /></AdminField>
          <AdminField label="全站每日上限"><AdminInput type="number" min="0" value={limits.dailyTotalPointSpend ?? 0} onChange={(event) => setLimits({ ...limits, dailyTotalPointSpend: Number(event.target.value) || 0 })} /></AdminField>
        </fieldset>
      </AdminSectionCard>}

      <AdminSectionCard title="权益方案" description="用户所属套餐决定每日积分与各类调用上限。未开通或已到期用户使用默认方案；调用上限为 0 表示不限，每日赠送为 0 表示不赠送。">
        <fieldset disabled={saving} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entitlementsEnabled} onChange={(event) => setEntitlementsEnabled(event.target.checked)} />启用套餐权益限制</label>
            <AdminField label="默认方案" className="w-40">
              <AdminSelect value={defaultPlanId} onChange={(event) => setDefaultPlanId(event.target.value)}>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name || plan.id}</option>)}
              </AdminSelect>
            </AdminField>
          </div>
          <div className="flex flex-col gap-3">
            {plans.map((plan, index) => (
              <div key={plan.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="muted">方案标识：{plan.id}</StatusBadge>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={plan.enabled} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item))} />启用</label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <AdminField label="方案名称"><AdminInput value={plan.name} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} /></AdminField>
                  <AdminField label="每日赠送积分"><AdminInput type="number" min="0" value={plan.dailyPoints ?? 0} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, dailyPoints: Number(event.target.value) || 0 } : item))} /></AdminField>
                  <AdminField label="每日积分消耗上限"><AdminInput type="number" min="0" value={plan.limits.dailyPointSpend ?? 0} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyPointSpend: Number(event.target.value) || 0 } } : item))} /></AdminField>
                  <AdminField label="每日图片上限"><AdminInput type="number" min="0" value={plan.limits.dailyImages ?? 0} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyImages: Number(event.target.value) || 0 } } : item))} /></AdminField>
                  <AdminField label="每日视频上限"><AdminInput type="number" min="0" value={plan.limits.dailyVideos ?? 0} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyVideos: Number(event.target.value) || 0 } } : item))} /></AdminField>
                  <AdminField label="每日文本上限"><AdminInput type="number" min="0" value={plan.limits.dailyText ?? 0} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyText: Number(event.target.value) || 0 } } : item))} /></AdminField>
                </div>
                <fieldset className="mt-4 rounded-lg border border-border p-3">
                  <legend className="px-1 text-xs font-medium">允许的创作功能</legend>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{ENTITLEMENT_GENERATION_KINDS.map(kind => <label key={kind.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={plan.allowedGenerationKinds.includes(kind.value)} onChange={event => setPlans(current => current.map((item, position) => position === index ? { ...item, allowedGenerationKinds: event.target.checked ? [...item.allowedGenerationKinds, kind.value] : item.allowedGenerationKinds.filter(value => value !== kind.value) } : item))} />{kind.label}</label>)}</div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">启用套餐权益限制后生效。只限制新任务，不影响查看已有项目和资产；创作助手调用生成工具时同样受对应限制。不选择任何项表示禁止新建以上任务。历史方案未设置时默认全部允许。</p>
                </fieldset>
                {plan.features.length > 0 && <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">历史功能标签（兼容保留）</summary><p className="mt-2 leading-5">以下旧标签仅作记录，不控制功能访问。保存方案时会保留。</p><ul className="mt-2 flex flex-wrap gap-2">{plan.features.map((feature, at) => <li key={`${at}:${feature}`} className="max-w-full break-all rounded bg-muted px-2 py-1">{feature}</li>)}</ul></details>}
              </div>
            ))}
            {!plans.length && <AdminEmpty title="暂无权益方案" description="系统尚未返回任何套餐方案定义。" />}
          </div>
        </fieldset>
      </AdminSectionCard>

      <AdminSectionCard title="模型积分价格" description="当前模型单价由模型与渠道页维护，避免两处配置冲突。">
        {Object.keys(settings.modelPointCosts || {}).length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-xs">
              <thead className="text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">模型</th><th className="py-2 font-medium">单次积分</th></tr></thead>
              <tbody>{Object.entries(settings.modelPointCosts).map(([model, cost]) => <tr key={model} className="border-t border-border"><td className="py-2 pr-3 font-mono text-[11px]">{model}</td><td className="py-2">{formatAdminNumber(cost)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="text-xs text-muted-foreground">未配置模型单价，将使用生成倍率计算。</p>}
        <div className="mt-3"><AdminDefinition label="图片质量倍率" value={Object.entries(settings.generationPointMultipliers.imageQuality || {}).map(([key, value]) => `${key}×${value}`).join(' · ') || '-'} /></div>
        <div><AdminDefinition label="视频清晰度倍率" value={Object.entries(settings.generationPointMultipliers.videoQuality || {}).map(([key, value]) => `${key}×${value}`).join(' · ') || '-'} /></div>
        <div><AdminDefinition label="视频时长倍率" value={Object.entries(settings.generationPointMultipliers.videoSeconds || {}).map(([key, value]) => `${key}×${value}`).join(' · ') || '-'} /></div>
      </AdminSectionCard>

      <AdminSaveBar hint="保存前会列出变更项，确认后才写入。"><ControlButton type="submit" variant="primary" disabled={saving}><Wallet className="size-3.5" />{saving ? '保存中' : '保存计费与权益'}</ControlButton></AdminSaveBar>
    </form>
  )
}

/* ---------------------------- 生成限制与默认参数 ---------------------------- */

function GenerationSection({ settings, onSave, saving }: { settings: AdminSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const [concurrency, setConcurrency] = useState<GenerationConcurrencySettings>(settings.generationConcurrency)
  const [defaults, setDefaults] = useState<GenerationDefaultSettings>(settings.generationDefaults)

  const concurrencyKeys: Array<[keyof GenerationConcurrencySettings, string]> = [['agent', '导演 Agent'], ['image', '图片'], ['video', '视频'], ['audio', '音频'], ['text', '文本'], ['render', '渲染']]

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const summary: string[] = []
    for (const [key, label] of concurrencyKeys) if (concurrency[key] !== settings.generationConcurrency[key]) summary.push(`${label}并发`)
    if (JSON.stringify(defaults) !== JSON.stringify(settings.generationDefaults)) summary.push('生成默认参数')
    onSave({ generationConcurrency: concurrency, generationDefaults: defaults }, summary)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <AdminSectionCard title="生成并发限制" description="限制每类任务同时执行的数量，避免上游限流与本地资源耗尽。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-3">
          {concurrencyKeys.map(([key, label]) => (
            <AdminField key={key} label={`${label}并发`}>
              <AdminInput type="number" min="1" max="200" value={concurrency[key]} onChange={(event) => setConcurrency({ ...concurrency, [key]: Number(event.target.value) || 1 })} />
            </AdminField>
          ))}
        </fieldset>
      </AdminSectionCard>

      <AdminSectionCard title="生成默认参数" description="用户在生成页未调整参数时使用的默认值。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-3">
          <AdminField label="画布图片数量"><AdminInput type="number" min="1" max="20" value={defaults.canvasImageCount} onChange={(event) => setDefaults({ ...defaults, canvasImageCount: Number(event.target.value) || 1 })} /></AdminField>
          <AdminField label="图片数量"><AdminInput type="number" min="1" max="20" value={defaults.imageCount} onChange={(event) => setDefaults({ ...defaults, imageCount: Number(event.target.value) || 1 })} /></AdminField>
          <AdminField label="图片比例"><AdminInput value={defaults.imageSize} onChange={(event) => setDefaults({ ...defaults, imageSize: event.target.value })} placeholder="例如 1:1" /></AdminField>
          <AdminField label="图片质量"><AdminSelect value={defaults.imageQuality} onChange={(event) => setDefaults({ ...defaults, imageQuality: event.target.value })}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></AdminSelect></AdminField>
          <AdminField label="视频清晰度"><AdminSelect value={defaults.videoQuality} onChange={(event) => setDefaults({ ...defaults, videoQuality: event.target.value })}><option value="480">480P</option><option value="720">720P</option><option value="1080">1080P</option></AdminSelect></AdminField>
          <AdminField label="视频时长（秒）"><AdminInput type="number" min="1" max="600" value={defaults.videoSeconds} onChange={(event) => setDefaults({ ...defaults, videoSeconds: Number(event.target.value) || 5 })} /></AdminField>
          <AdminField label="音频音色"><AdminInput value={defaults.audioVoice} onChange={(event) => setDefaults({ ...defaults, audioVoice: event.target.value })} /></AdminField>
          <AdminField label="音频格式"><AdminInput value={defaults.audioFormat} onChange={(event) => setDefaults({ ...defaults, audioFormat: event.target.value })} /></AdminField>
        </fieldset>
      </AdminSectionCard>

      <AdminSectionCard title="渠道与逻辑模型" description="渠道、逻辑模型、默认模型与模型单价统一在“模型与渠道”页面维护。">
        <div className="grid gap-3 sm:grid-cols-3">
          <AdminDefinition label="渠道数量" value={formatAdminNumber(settings.systemChannels.length)} />
          <AdminDefinition label="逻辑模型数量" value={formatAdminNumber(settings.logicalModels.length)} />
          <AdminDefinition label="默认文本模型" value={settings.defaultModels.textModel} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">如需修改，请前往 <a href="/admin/channels" className="underline">模型与渠道</a>。</p>
      </AdminSectionCard>

      <AdminSaveBar hint="保存前会列出变更项，确认后才写入。"><ControlButton type="submit" variant="primary" disabled={saving}><Server className="size-3.5" />{saving ? '保存中' : '保存生成设置'}</ControlButton></AdminSaveBar>
    </form>
  )
}

/* -------------------------------- 邮件 -------------------------------- */

function MailSection({ settings, onSave, saving }: { settings: AdminSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const mail = settings.mail || {}
  const [testing, setTesting] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testError, setTestError] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [draft, setDraft] = useState<MailSettings>({ ...mail, provider: 'smtp', password: '' })

  function mailInput(): Omit<MailSettings, 'hasPassword'> {
    const { hasPassword: _hasPassword, ...patch } = draft
    if (!patch.password) delete patch.password
    return { ...patch, provider: 'smtp' }
  }

  async function testSend() {
    setTesting(true); setTestError(''); setTestMessage('')
    try {
      await sendTestMail(testTo, mailInput())
      setTestMessage('测试邮件已发送，请检查收件箱。')
    } catch (reason) {
      setTestError(reason instanceof Error ? reason.message : '测试邮件发送失败')
    } finally { setTesting(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    onSave({ mail: mailInput() }, ['邮件服务配置'])
  }

  return (
    <div className="flex flex-col gap-4">
      <AdminSectionCard title="邮件服务" description="用于邮箱验证码、通知和测试邮件。密码字段不会回显，留空表示沿用已保存的密码。">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge tone={mail.host ? 'success' : 'muted'}>{mail.host ? `已配置：${mail.host}` : '未配置 SMTP'}</StatusBadge>
          <StatusBadge tone={mail.hasPassword ? 'success' : 'muted'}>{mail.hasPassword ? 'SMTP 密码已保存' : 'SMTP 密码未保存'}</StatusBadge>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
            <AdminField label="邮件协议" hint="当前支持 SMTP。请填写邮箱服务提供的主机、端口和凭证。"><AdminInput value="SMTP" readOnly /></AdminField>
            <AdminField label="SMTP 主机"><AdminInput value={draft.host || ''} onChange={(event) => setDraft({ ...draft, host: event.target.value })} /></AdminField>
            <AdminField label="端口"><AdminInput type="number" min="1" max="65535" value={draft.port ?? 465} onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) || 465 })} /></AdminField>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.secure ?? true} onChange={(event) => setDraft({ ...draft, secure: event.target.checked })} />使用 SSL/TLS</label>
            <AdminField label="SMTP 用户名"><AdminInput value={draft.username || ''} onChange={(event) => setDraft({ ...draft, username: event.target.value })} autoComplete="off" /></AdminField>
            <AdminField label="SMTP 密码" hint={mail.hasPassword ? '已保存密码，留空表示不修改。' : '尚未保存密码。'}>
              <AdminInput type="password" value={draft.password || ''} onChange={(event) => setDraft({ ...draft, password: event.target.value })} autoComplete="new-password" placeholder={mail.hasPassword ? '留空表示不修改' : ''} />
            </AdminField>
            <AdminField label="发件邮箱"><AdminInput value={draft.fromEmail || ''} onChange={(event) => setDraft({ ...draft, fromEmail: event.target.value })} /></AdminField>
            <AdminField label="发件人名称"><AdminInput value={draft.fromName || ''} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} /></AdminField>
          </fieldset>
          <AdminSaveBar hint="保存前会列出变更项，确认后才写入。"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-3.5" />{saving ? '保存中' : '保存邮件设置'}</ControlButton></AdminSaveBar>
        </form>
      </AdminSectionCard>

      <AdminSectionCard title="发送测试邮件" description="使用当前表单中的配置发送一封测试邮件，不会保存配置。">
        <div className="flex flex-wrap items-end gap-2">
          <AdminField label="收件地址" className="w-full sm:w-72"><AdminInput type="email" value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="admin@example.com" /></AdminField>
          <ControlButton variant="secondary" onClick={() => void testSend()} disabled={testing || !testTo.trim()}><Mail className="size-3.5" />{testing ? '发送中' : '发送测试邮件'}</ControlButton>
        </div>
        {testError && <div className="mt-3"><AdminNotice tone="danger">{testError}</AdminNotice></div>}
        {testMessage && <div className="mt-3"><AdminNotice tone="success">{testMessage}</AdminNotice></div>}
      </AdminSectionCard>
    </div>
  )
}

/* ------------------------------ 对象存储 ------------------------------ */

function StorageSection({ storage, onReload, onMessage, onError }: { storage: ObjectStorageSettings | null; onReload: () => void; onMessage: (value: string) => void; onError: (value: string) => void }) {
  const [draft, setDraft] = useState<ObjectStorageSettings>(storage ?? { enabled: false, endpoint: '', region: 'us-east-1', bucket: '', prefix: '', forcePathStyle: false, hasAccessKeyId: false, hasSecretAccessKey: false })
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const storageAction = useRef(false)

  useEffect(() => { if (storage) setDraft(storage) }, [storage])

  if (!storage) return <AdminEmpty title="存储配置不可用" description="当前管理员没有系统设置职责，无法读取或修改对象存储。" />

  async function save() {
    if (storageAction.current) return
    storageAction.current = true
    setBusy(true); onError(''); onMessage('')
    try {
      const input = storageUpdateInput(draft, accessKeyId, secretAccessKey)
      const result = await updateObjectStorage(input)
      assertStorageSaved(result, input)
      setAccessKeyId(''); setSecretAccessKey('')
      onMessage('对象存储配置已保存，保持未启用。' + CREATIVE_STORAGE_NOTICE)
      onReload()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '对象存储配置保存失败')
    } finally { storageAction.current = false; setBusy(false) }
  }

  async function check() {
    if (storageAction.current) return
    storageAction.current = true
    setChecking(true); onError(''); onMessage('')
    try {
      onMessage(storageTestMessage(await testObjectStorage()))
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '外部存储连接检测失败')
    } finally { storageAction.current = false; setChecking(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <AdminNotice tone="warning">{CREATIVE_STORAGE_NOTICE} 可以保存连接参数供后续使用，当前不能启用对象存储写入。密钥留空表示保留已保存值。</AdminNotice>
      {storage.enabled && <AdminNotice tone="danger">已保存的配置仍标记为启用，当前版本会因此拒绝上传与媒体生成。页面不会自动更改它；如需恢复服务器存储，请取消下方勾选并明确保存。</AdminNotice>}
      <AdminSectionCard title="对象存储（OSS / S3）" description="连接检测使用已保存配置，只核对服务端返回的桶访问与写入验证状态，不会保存当前表单。" action={<div className="flex gap-2"><StatusBadge tone={storage.enabled ? 'warning' : 'muted'}>{storage.enabled ? '已配置启用 · 当前不支持' : '未启用'}</StatusBadge></div>}>
        <div className="mb-4 flex flex-wrap gap-2">
          <StatusBadge tone={storage.hasAccessKeyId ? 'success' : 'muted'}>访问密钥标识 {storage.hasAccessKeyId ? '已配置' : '未配置'}</StatusBadge>
          <StatusBadge tone={storage.hasSecretAccessKey ? 'success' : 'muted'}>访问密钥 {storage.hasSecretAccessKey ? '已配置' : '未配置'}</StatusBadge>
          <span className="text-xs text-muted-foreground">最近更新：{storage.updatedAt ? new Date(storage.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
        </div>
        <fieldset disabled={busy || checking} className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.enabled} disabled={!storage.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用外部存储（暂不支持，可取消已有启用状态）</label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.forcePathStyle} onChange={(event) => setDraft({ ...draft, forcePathStyle: event.target.checked })} />使用路径式访问（Path Style）</label>
          <AdminField label="服务地址（Endpoint）"><AdminInput value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://s3.example.com" /></AdminField>
          <AdminField label="地域（Region）"><AdminInput value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></AdminField>
          <AdminField label="存储桶（Bucket）"><AdminInput value={draft.bucket} onChange={(event) => setDraft({ ...draft, bucket: event.target.value })} /></AdminField>
          <AdminField label="对象前缀"><AdminInput value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value })} /></AdminField>
          <AdminField label="访问密钥标识（Access Key ID）" hint={storage.hasAccessKeyId ? '已保存，留空表示不修改。' : '尚未保存。'}><AdminInput type="password" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} autoComplete="new-password" placeholder={storage.hasAccessKeyId ? '留空表示不修改' : ''} /></AdminField>
          <AdminField label="访问密钥（Secret Access Key）" hint={storage.hasSecretAccessKey ? '已保存，留空表示不修改。' : '尚未保存。'}><AdminInput type="password" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} autoComplete="new-password" placeholder={storage.hasSecretAccessKey ? '留空表示不修改' : ''} /></AdminField>
        </fieldset>
      </AdminSectionCard>
      {!storage.enabled && <p className="text-xs text-muted-foreground">当前仅能检测已保存且标记启用的既有配置。无需为了检测而启用存储；连接参数可先保存。</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <ControlButton variant="secondary" onClick={() => void check()} disabled={busy || checking || !storage.enabled}><Cloud className="size-3.5" />{checking ? '检测中' : '检测已保存的桶'}</ControlButton>
        <ControlButton variant="primary" onClick={() => void save()} disabled={busy || checking}><Save className="size-3.5" />{busy ? '保存中' : '保存存储配置'}</ControlButton>
      </div>
    </div>
  )
}

/* ------------------------------ 数据保留 ------------------------------ */

function LifecycleSection({ settings, onSave, saving }: { settings: AdminSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const [lifecycle, setLifecycle] = useState(settings.dataLifecycle)
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSave({ dataLifecycle: lifecycle }, ['数据保留策略']) }}
      className="flex flex-col gap-4"
    >
      <AdminSectionCard title="数据保留与清理" description="控制过期会话、验证码、生成任务和临时素材的自动清理。">
        <fieldset disabled={saving} className="flex flex-col gap-3">
          <LifecycleToggle checked={lifecycle.cleanupExpiredSessions} onChange={(value) => setLifecycle({ ...lifecycle, cleanupExpiredSessions: value })} label="清理过期登录会话" description="定期删除已过期的用户登录会话记录。" />
          <LifecycleToggle checked={lifecycle.cleanupExpiredEmailCodes} onChange={(value) => setLifecycle({ ...lifecycle, cleanupExpiredEmailCodes: value })} label="清理过期邮箱验证码" description="删除已失效的邮箱验证码，减少数据冗余。" />
          <LifecycleToggle checked={lifecycle.cleanupExpiredGenerationTasks} onChange={(value) => setLifecycle({ ...lifecycle, cleanupExpiredGenerationTasks: value })} label="清理过期生成任务" description="删除超过保留期的生成任务与调度记录。" />
          <LifecycleToggle checked={lifecycle.cleanupExpiredTemporaryMedia} onChange={(value) => setLifecycle({ ...lifecycle, cleanupExpiredTemporaryMedia: value })} label="清理临时素材" description="删除未被引用的临时上传与中间产物。" />
          <AdminField label="单批处理条数" className="sm:w-56"><AdminInput type="number" min="1" max="10000" value={lifecycle.maintenanceBatchSize} onChange={(event) => setLifecycle({ ...lifecycle, maintenanceBatchSize: Number(event.target.value) || 1 })} /></AdminField>
        </fieldset>
      </AdminSectionCard>
      <AdminSectionCard title="备份与恢复" description="网页端备份下载与恢复入口暂未开放，避免误覆盖线上数据。">
        <div className="flex items-start gap-2 text-xs text-muted-foreground"><Database className="mt-0.5 size-3.5 shrink-0" /><span>数据备份由部署层负责。如需导出或恢复数据，请使用服务器上的受控备份流程。</span></div>
      </AdminSectionCard>
      <AdminSaveBar hint="保存前会列出变更项，确认后才写入。"><ControlButton type="submit" variant="primary" disabled={saving}><Settings2 className="size-3.5" />{saving ? '保存中' : '保存数据保留设置'}</ControlButton></AdminSaveBar>
    </form>
  )
}

function LifecycleToggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-border pb-3 text-sm last:border-b-0">
      <span><span className="font-medium">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export { Gem, RefreshCw, ShieldCheck }
