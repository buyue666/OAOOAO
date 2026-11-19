'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Cloud, Database, Gem, Mail, RefreshCw, Save, Server, Settings2, ShieldCheck, Trash2, Wallet } from 'lucide-react'
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
import type { AdminPaymentConfigSummary, AdminPaymentProviderConfig, AdminSettings, EntitlementPlan, GenerationConcurrencySettings, GenerationDefaultSettings, MailSettings, ObjectStorageSettings } from '@/lib/studio/admin-types'
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
import { PlanModelControl } from './plan-model-control'
import { CONCURRENCY_FIELDS, PlanConcurrencyFields } from './plan-concurrency-fields'
import { AdminSiteSettings } from './admin-site-settings'
import { AdminCheckInSettings } from './admin-check-in-settings'
import { AdminWatermarkSettings } from './admin-watermark-settings'
import { AdminAdultContentSettings } from './admin-adult-content-settings'
import { AdminWechatSettings } from './admin-wechat-settings'
import { OnlinePaymentProviderEditor } from './admin-payment-provider'
import { canConfigureOnlinePayment, paymentProviderName } from '@/lib/studio/payment-provider-config'
import { checkInRuleChanges, readCheckInForm } from '@/lib/studio/check-in-rules'
import { allowedGenerationKinds, ENTITLEMENT_GENERATION_KINDS } from '@/lib/studio/entitlement-features'
import { assertStorageSaved, CREATIVE_STORAGE_NOTICE, storageTestMessage, storageUpdateInput } from '@/lib/studio/object-storage-status'

type SectionId = 'site' | 'account' | 'watermark' | 'adult-content' | 'wechat' | 'billing' | 'points' | 'generation' | 'mail' | 'storage' | 'lifecycle'

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
    if (requested && ['site', 'account', 'watermark', 'adult-content', 'wechat', 'billing', 'points', 'generation', 'mail', 'storage', 'lifecycle'].includes(requested)) setSection(requested as SectionId)
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
    { id: 'watermark', label: 'AI 生成水印', visible: canSystem },
    { id: 'adult-content', label: '成人内容', visible: canSystem },
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
          {active === 'watermark' && <AdminWatermarkSettings policy={settings.watermarkPolicy} saving={saving} onSave={(patch, summary) => save('AI 生成水印设置', patch, summary)} />}
          {active === 'adult-content' && <AdminAdultContentSettings visible={settings.accountMenu?.adultContentSettingsVisible !== false} saving={saving} onSave={(patch, summary) => save('成人内容设置', patch, summary)} />}
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
              : <AdminNotice tone="neutral">商用模式下，购买入口还需要已发布的客户政策和可用收款配置。New API 余额支付和在线支付均以服务端核验的支付回执为准。</AdminNotice>}
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">保存时会先确认变更。</p>
            <ControlButton type="submit" variant="primary" disabled={saving} className="w-full shrink-0 sm:w-auto"><Save className="size-3.5" />{saving ? '保存中' : '保存运营模式'}</ControlButton>
          </div>
        </AdminSectionCard>
      </form>}

      {canCommerce && <CommercePolicyEditor settings={settings} onSave={onModeSave} saving={saving} />}

      {canBilling && paymentConfig?.providers.filter(canConfigureOnlinePayment).map(provider => <OnlinePaymentProviderEditor key={provider.id} provider={provider} onSaved={onPaymentConfigChange} onMessage={onMessage} onError={onError} />)}

      {canBilling && paymentConfig && <AdminSectionCard title="支付渠道概览" description="状态表示当前配置是否完整。未接入的渠道不提供启用或编辑操作；已保存配置保持不变。">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {paymentConfig.providers.map((provider) => (
            <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
              <div className="min-w-0"><p className="truncate font-medium text-foreground">{paymentProviderName(provider)}</p><p className="mt-1 text-[11px] text-muted-foreground">{canConfigureOnlinePayment(provider) ? '由服务端验证支付通知后确认订单' : '暂不支持在线收款或自动回调；已有配置保留'}</p></div>
              <StatusBadge tone={provider.ready ? 'success' : provider.enabled && (canConfigureOnlinePayment(provider)) ? 'warning' : 'neutral'}>{!canConfigureOnlinePayment(provider) ? '未接入' : provider.ready ? '配置就绪' : provider.enabled ? '待配置' : '已关闭'}</StatusBadge>
            </div>
          ))}
        </div>
      </AdminSectionCard>}
    </div>
  )
}

/* ------------------------------ 注册与积分 ------------------------------ */

function AccountSection({ settings, canSystem, canCommerce, onSave, saving }: { settings: AdminSettings; canSystem: boolean; canCommerce: boolean; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const checkIn = settings.checkIn ?? { enabled: false, rewardPoints: 10 }
  const registrationLimit = settings.registrationRateLimit ?? { enabled: false, maxAttempts: 5, windowSeconds: 3600 }
  const [limitEnabled, setLimitEnabled] = useState(registrationLimit.enabled)
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
      const maxAttempts = Number(data.get('registrationMaxAttempts') ?? registrationLimit.maxAttempts)
      const windowMinutes = Number(data.get('registrationWindowMinutes') ?? registrationLimit.windowSeconds / 60)
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000 || !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) { setFormError('请填写有效的注册次数（1–1000）和时间窗口（1–1440 分钟）。'); return }
      patch.registrationRateLimit = { enabled: limitEnabled, maxAttempts, windowSeconds: windowMinutes * 60 }
      if (JSON.stringify(patch.registrationRateLimit) !== JSON.stringify(registrationLimit)) summary.push('注册频率限制')
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
      {canSystem && <AdminSectionCard title="注册频率限制" description="由管理员决定是否限制同一 IP 的注册提交次数。关闭后，已有的注册频率计数也不会拦截用户。">
        <label className="flex min-h-11 items-center justify-between gap-4 text-sm"><span className="font-medium">启用注册频率限制</span><input type="checkbox" name="registrationLimitEnabled" checked={limitEnabled} onChange={event => setLimitEnabled(event.target.checked)} disabled={saving} /></label>
        <p className="mt-2 text-xs text-muted-foreground" role="status">{limitEnabled ? '已开启 · 同一 IP 在指定时间内共用次数，提交失败也计入。' : '已关闭 · 用户注册不受 IP 提交次数限制。'}</p>
        <fieldset disabled={saving || !limitEnabled} className="mt-4 grid gap-4 sm:grid-cols-2 disabled:opacity-60">
          <AdminField label="允许提交次数"><AdminInput name="registrationMaxAttempts" type="number" min="1" max="1000" step="1" defaultValue={registrationLimit.maxAttempts} /></AdminField>
          <AdminField label="时间窗口（分钟）"><AdminInput name="registrationWindowMinutes" type="number" min="1" max="1440" step="1" defaultValue={registrationLimit.windowSeconds / 60} /></AdminField>
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
  const toDraft = (plan: EntitlementPlan) => ({ ...plan, draftKey: `saved:${plan.id}`, originalId: plan.id as string | null, allowedModelIds: plan.allowedModelIds?.slice(), limits: { ...plan.limits }, features: [...(plan.features ?? [])], allowedGenerationKinds: allowedGenerationKinds(plan) })
  const [plans, setPlans] = useState(() => settings.entitlements.plans.map(toDraft))
  const [removedDrafts, setRemovedDrafts] = useState<Record<string, ReturnType<typeof toDraft>>>({})
  const [entitlementsEnabled, setEntitlementsEnabled] = useState(settings.entitlements.enabled)
  const [defaultPlanId, setDefaultPlanId] = useState(settings.entitlements.defaultPlanId)
  const [defaultStorageQuotaBytes,setDefaultStorageQuotaBytes] = useState(settings.entitlements.defaultStorageQuotaBytes ?? 10*1024**3)
  const [limits, setLimits] = useState(settings.generationCostControl)
  const confirm = useConfirm()
  const removed = settings.entitlements.plans.filter(plan => Object.hasOwn(removedDrafts, plan.id))

  function markForRemoval(plan: ReturnType<typeof toDraft>) {
    const name = plan.name || plan.id
    confirm.confirm({
      title: plan.originalId ? `删除权益方案「${name}」？` : `移除未保存的方案「${name}」？`,
      description: plan.originalId ? '方案先标记为待删除，保存计费与权益后才生效。' : '该方案还没有保存，移除后不会写入后台。',
      notice: plan.originalId ? '已关联商品、正在使用或有未完成订单的方案不能删除。保存前可撤销。' : '其他方案的更改会继续保留。',
      confirmLabel: plan.originalId ? '标记待删除' : '移除方案',
      tone: 'danger',
      onConfirm: () => {
        if (plan.originalId) setRemovedDrafts(current => ({ ...current, [plan.originalId!]: plan }))
        setPlans(current => current.filter(item => item.draftKey !== plan.draftKey))
      },
    })
  }

  function undoRemoval(planId: string) {
    const restored = removedDrafts[planId]
    if (!restored) return
    setPlans(current => [...current, restored])
    setRemovedDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== planId)))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entitlements = { enabled: entitlementsEnabled, defaultPlanId, defaultStorageQuotaBytes, plans: plans.map(({ draftKey: _draftKey, originalId: _originalId, ...plan }) => plan) }
    const summary: string[] = []
    const entitlementPlanRenames = plans.flatMap(plan => plan.originalId && plan.originalId !== plan.id ? [{ from: plan.originalId, to: plan.id }] : [])
    for (const rename of entitlementPlanRenames) summary.push(`方案标识 ${rename.from} → ${rename.to}（同步关联商品及会员权益）`)
    for (const item of removed) summary.push(`删除权益方案「${item.name || item.id}」`)
    const concurrencyChanged = plans.filter(plan => CONCURRENCY_FIELDS.some(([kind]) => plan.generationConcurrency?.[kind] !== settings.entitlements.plans.find(item => item.id === plan.originalId)?.generationConcurrency?.[kind]))
    for (const plan of concurrencyChanged) summary.push(`「${plan.name || plan.id}」生成并发`)
    if (JSON.stringify(entitlements) !== JSON.stringify(settings.entitlements)) summary.push('套餐权益')
    if (canUpstream && JSON.stringify(limits) !== JSON.stringify(settings.generationCostControl)) summary.push('生成成本控制')
    onSave({
      entitlements,
      ...(entitlementPlanRenames.length ? { entitlementPlanRenames } : {}),
      ...(removed.length ? { entitlementPlanRemovals: removed.map(plan => plan.id) } : {}),
      ...(canUpstream ? { generationCostControl: limits } : {}),
    }, summary)
  }

  return (
    <>
    <form onSubmit={submit} className="flex flex-col gap-4">
      {canUpstream && <AdminSectionCard title="成本控制上限" description="限制单次任务与每日积分消耗，0 表示不限制。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-3">
          <AdminField label="单任务积分上限"><AdminInput type="number" min="0" value={limits.maxPointsPerTask ?? 0} onChange={(event) => setLimits({ ...limits, maxPointsPerTask: Number(event.target.value) || 0 })} /></AdminField>
          <AdminField label="单用户每日上限"><AdminInput type="number" min="0" value={limits.dailyUserPointSpend ?? 0} onChange={(event) => setLimits({ ...limits, dailyUserPointSpend: Number(event.target.value) || 0 })} /></AdminField>
          <AdminField label="全站每日上限"><AdminInput type="number" min="0" value={limits.dailyTotalPointSpend ?? 0} onChange={(event) => setLimits({ ...limits, dailyTotalPointSpend: Number(event.target.value) || 0 })} /></AdminField>
        </fieldset>
      </AdminSectionCard>}

      <AdminSectionCard title="权益方案" description="未开通或已到期用户使用默认方案。调用上限为 0 表示不限。">
        <fieldset disabled={saving} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <AdminField label="默认存储容量（GB）" hint="未配置会员容量时使用；0 表示不限。"><AdminInput type="number" min="0" step="0.01" value={defaultStorageQuotaBytes/1024**3} onChange={event=>setDefaultStorageQuotaBytes(Math.round(Number(event.target.value)*1024**3))}/></AdminField>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entitlementsEnabled} onChange={(event) => setEntitlementsEnabled(event.target.checked)} />启用套餐权益限制</label>
            <AdminField label="默认方案" className="w-40">
              <AdminSelect value={defaultPlanId} onChange={(event) => setDefaultPlanId(event.target.value)}>
                {!entitlementsEnabled && <option value="">未设置</option>}
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name || plan.id}</option>)}
              </AdminSelect>
            </AdminField>
          </div>
          {removed.length > 0 && <section aria-label="待删除的权益方案" className="space-y-2">
            <AdminNotice tone="warning">已标记 {removed.length} 个方案待删除。点击「保存计费与权益」后生效。</AdminNotice>
            <ul className="space-y-1.5">{removed.map(plan => <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"><span className="min-w-0 break-all">{removedDrafts[plan.id].name || plan.name || plan.id}</span><ControlButton type="button" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => undoRemoval(plan.id)} aria-label={`撤销删除 ${removedDrafts[plan.id].name || plan.name || plan.id}`}>撤销删除</ControlButton></li>)}</ul>
          </section>}
          <div className="flex flex-col gap-3">
            {plans.map((plan, index) => (
              <div key={plan.draftKey} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminField label="方案标识" hint="保存时同步更新关联商品、会员和签到规则；不改变积分余额与有效期。" className="min-w-64 flex-1"><AdminInput aria-label={`方案标识 ${index + 1}`} required maxLength={120} value={plan.id} onChange={event => { const id = event.target.value.trim(); if (defaultPlanId === plan.id) setDefaultPlanId(id); setPlans(current => current.map((item, position) => position === index ? { ...item, id } : item)) }} /></AdminField>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={plan.enabled} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item))} />启用</label>
                  <ControlButton type="button" variant="danger" className="min-h-11 sm:min-h-8" disabled={plan.id === defaultPlanId} title={plan.id === defaultPlanId ? '请先选择其他默认方案' : undefined} aria-label={`删除权益方案 ${plan.name || plan.id}${plan.id === defaultPlanId ? '（请先更换默认方案）' : ''}`} onClick={() => markForRemoval(plan)}><Trash2 className="size-4" aria-hidden="true" />删除</ControlButton>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <AdminField label="方案名称"><AdminInput value={plan.name} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} /></AdminField>
                  <AdminField label="存储容量（GB）" hint="上传与生成结果共用；0 表示不限。降额不删除已有文件，超额后不能新增。"><AdminInput type="number" min="0" step="0.01" value={(plan.storageQuotaBytes??defaultStorageQuotaBytes)/1024**3} onChange={event=>setPlans(current=>current.map((item,position)=>position===index?{...item,storageQuotaBytes:Math.round(Number(event.target.value)*1024**3)}:item))}/></AdminField>
                  <AdminField label="每日签到奖励" hint="用于管理员分配的会员方案。购买商品的签到奖励取商品设置。"><AdminInput type="number" min="0" value={plan.dailyPoints ?? 0} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, dailyPoints: Number(event.target.value) || 0 } : item))} /></AdminField>
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
                <PlanConcurrencyFields defaults={settings.generationConcurrency} value={plan.generationConcurrency} disabled={saving} onChange={generationConcurrency => setPlans(current => current.map(item => item.draftKey === plan.draftKey ? { ...item, generationConcurrency } : item))} />
                <div className="mt-4"><PlanModelControl models={settings.logicalModels} value={plan.allowedModelIds} disabled={saving} onChange={allowedModelIds => setPlans(current => current.map((item, position) => position === index ? { ...item, allowedModelIds } : item))} /></div>
                {plan.features.length > 0 && <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">历史功能标签（兼容保留）</summary><p className="mt-2 leading-5">以下旧标签仅作记录，不控制功能访问。保存方案时会保留。</p><ul className="mt-2 flex flex-wrap gap-2">{plan.features.map((feature, at) => <li key={`${at}:${feature}`} className="max-w-full break-all rounded bg-muted px-2 py-1">{feature}</li>)}</ul></details>}
              </div>
            ))}
            {!plans.length && <AdminEmpty title="暂无权益方案" description="系统尚未返回任何套餐方案定义。" />}
            <ControlButton type="button" variant="secondary" onClick={()=>{const id=crypto.randomUUID();setPlans(current=>[...current,{id,draftKey:`new:${id}`,originalId:null,name:'新会员方案',allowedModelIds:undefined,enabled:true,dailyPoints:0,storageQuotaBytes:defaultStorageQuotaBytes,limits:{dailyPointSpend:0,dailyApiCalls:0,dailyImages:0,dailyVideos:0,dailyAudio:0,dailyText:0},features:[],allowedGenerationKinds:ENTITLEMENT_GENERATION_KINDS.map(item=>item.value)}]);if(!defaultPlanId)setDefaultPlanId(id)}}>新增会员方案</ControlButton>
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

      <AdminSaveBar hint={removed.length ? `${removed.length} 个权益方案待删除，保存后生效。` : '保存前会列出变更项，确认后才写入。'}><ControlButton type="submit" variant="primary" disabled={saving}><Wallet className="size-3.5" />{saving ? '保存中' : '保存计费与权益'}</ControlButton></AdminSaveBar>
    </form>
    {confirm.dialog}
    </>
  )
}

/* ---------------------------- 生成限制与默认参数 ---------------------------- */

function GenerationSection({ settings, onSave, saving }: { settings: AdminSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const [concurrency, setConcurrency] = useState<GenerationConcurrencySettings>(settings.generationConcurrency)
  const [defaults, setDefaults] = useState<GenerationDefaultSettings>(settings.generationDefaults)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const summary: string[] = []
    for (const [key, label] of CONCURRENCY_FIELDS) if (concurrency[key] !== settings.generationConcurrency[key]) summary.push(`${label}并发`)
    if (JSON.stringify(defaults) !== JSON.stringify(settings.generationDefaults)) summary.push('生成默认参数')
    onSave({ generationConcurrency: concurrency, generationDefaults: defaults }, summary)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <AdminSectionCard title="默认生成并发" description="用于没有单独设置并发的个人权益方案。个人方案在「计费与权益」中覆盖；团队使用自己的团队与成员上限。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-3">
          {CONCURRENCY_FIELDS.map(([key, label]) => (
            <AdminField key={key} label={`${label}并发`}>
              <AdminInput type="number" min="1" max="100" step="1" value={concurrency[key]} onChange={(event) => setConcurrency({ ...concurrency, [key]: Number(event.target.value) || 1 })} />
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

      <AdminSectionCard title="渠道与模型列表" description="渠道、模型列表、默认模型与模型单价统一在“模型与渠道”页面维护。">
        <div className="grid gap-3 sm:grid-cols-3">
          <AdminDefinition label="渠道数量" value={formatAdminNumber(settings.systemChannels.length)} />
          <AdminDefinition label="模型列表数量" value={formatAdminNumber(settings.logicalModels.length)} />
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
      onMessage(draft.enabled?'对象存储已启用，新上传和生成素材将保存到已配置的存储桶。':'对象存储配置已保存，新素材继续使用服务器存储。')
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

  if (storage.provider === 'vercel-blob') return (
    <div className="flex flex-col gap-4">
      <AdminNotice>Vercel Blob 私有存储由项目集成托管，无需填写 S3 访问密钥。素材通过分享链接读取，上传和资产管理仍需登录。</AdminNotice>
      <AdminSectionCard title="对象存储 · Vercel Blob" description="连接由项目设置管理。检测会上传、读取并删除一个独立测试文件，不影响现有素材。" action={<StatusBadge tone={storage.enabled ? 'success' : 'muted'}>{storage.enabled ? '已启用' : '未启用'}</StatusBadge>}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">新素材保存至已连接的私有存储。切换存储前请先迁移已有素材，避免文件失联。</p>
          <div className="flex justify-end"><ControlButton variant="secondary" onClick={() => void check()} disabled={busy || checking}>{checking ? '检测中' : '检测上传、读取与删除'}</ControlButton></div>
        </div>
      </AdminSectionCard>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <AdminNotice>{CREATIVE_STORAGE_NOTICE} 私有桶通过短时签名链接下载。密钥留空保留原值，仅加密保存在此部署中。</AdminNotice>
      <AdminSectionCard title="对象存储 · Cloudflare R2 / S3" description="保存后可执行读写删除检测。检测会上传并清理一个小测试文件，不修改当前表单。" action={<StatusBadge tone={storage.enabled?'success':'muted'}>{storage.enabled?'已启用':'未启用'}</StatusBadge>}>
        <div className="mb-4 flex flex-wrap gap-2">
          <StatusBadge tone={storage.hasAccessKeyId ? 'success' : 'muted'}>访问密钥标识 {storage.hasAccessKeyId ? '已配置' : '未配置'}</StatusBadge>
          <StatusBadge tone={storage.hasSecretAccessKey ? 'success' : 'muted'}>访问密钥 {storage.hasSecretAccessKey ? '已配置' : '未配置'}</StatusBadge>
          <span className="text-xs text-muted-foreground">最近更新：{storage.updatedAt ? new Date(storage.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
        </div>
        <fieldset disabled={busy || checking} className="grid gap-4 sm:grid-cols-2">
          <AdminField label="存储服务"><AdminSelect value={draft.provider||'s3'} onChange={event=>setDraft({...draft,provider:event.target.value as 's3'|'r2',...(event.target.value==='r2'?{region:'auto',forcePathStyle:true}:{})})}><option value="r2">Cloudflare R2</option><option value="s3">S3 兼容存储</option></AdminSelect></AdminField>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用对象存储，保存新素材</label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.forcePathStyle} onChange={(event) => setDraft({ ...draft, forcePathStyle: event.target.checked })} />使用路径式访问（Path Style）</label>
          <AdminField label="服务地址（Endpoint）" hint={draft.provider==='r2'?'使用 R2 控制台中的 S3 API 地址，地域填 auto。':''}><AdminInput value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder={draft.provider==='r2'?'https://<账户ID>.r2.cloudflarestorage.com':'https://s3.example.com'} /></AdminField>
          <AdminField label="地域（Region）"><AdminInput value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></AdminField>
          <AdminField label="存储桶（Bucket）"><AdminInput value={draft.bucket} onChange={(event) => setDraft({ ...draft, bucket: event.target.value })} /></AdminField>
          <AdminField label="对象前缀"><AdminInput value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value })} /></AdminField>
          <AdminField label="访问密钥标识（Access Key ID）" hint={storage.hasAccessKeyId ? '已保存，留空表示不修改。' : '尚未保存。'}><AdminInput type="password" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} autoComplete="new-password" placeholder={storage.hasAccessKeyId ? '留空表示不修改' : ''} /></AdminField>
          <AdminField label="访问密钥（Secret Access Key）" hint={storage.hasSecretAccessKey ? '已保存，留空表示不修改。' : '尚未保存。'}><AdminInput type="password" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} autoComplete="new-password" placeholder={storage.hasSecretAccessKey ? '留空表示不修改' : ''} /></AdminField>
        </fieldset>
      </AdminSectionCard>
      <p className="text-xs text-muted-foreground">可先保存并检测连接参数，再启用。已有对象未清理前不能更换存储桶，避免素材失联。</p>
      <div className="flex flex-wrap justify-end gap-2">
        <ControlButton variant="secondary" onClick={() => void check()} disabled={busy || checking || !storage.bucket}><Cloud className="size-3.5" />{checking ? '检测中' : '检测上传、读取与删除'}</ControlButton>
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
