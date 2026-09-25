'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Cloud, Database, Gem, Mail, RefreshCw, Save, Server, Settings2, ShieldCheck, Wallet } from 'lucide-react'
import {
  getAdminSettings,
  getObjectStorage,
  sendTestMail,
  testObjectStorage,
  updateObjectStorage,
  updateAdminSettings,
  type AdminSettingsPatch,
} from '@/lib/studio/admin-api'
import type { AdminSettings, GenerationConcurrencySettings, GenerationDefaultSettings, MailSettings, ObjectStorageSettings, SiteSettings } from '@/lib/studio/admin-types'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminDefinition,
  AdminEmpty,
  AdminError,
  AdminField,
  AdminInput,
  AdminLoading,
  AdminNotice,
  AdminSectionCard,
  AdminSelect,
  AdminTextarea,
  formatAdminNumber,
  useConfirm,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

type SectionId = 'site' | 'account' | 'points' | 'generation' | 'mail' | 'storage' | 'lifecycle'

export function AdminSettingsPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [storage, setStorage] = useState<ObjectStorageSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [section, setSection] = useState<SectionId>('site')
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()

  const canSystem = session.can('system.manage')
  const canBilling = session.can('billing.manage')
  const canUpstream = session.can('upstream.manage')

  const load = useCallback(() => {
    setLoading(true); setError('')
    Promise.all([getAdminSettings(), canSystem ? getObjectStorage().catch(() => null) : Promise.resolve(null)])
      .then(([next, objectStorage]) => { setSettings(next); setStorage(objectStorage) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '系统设置加载失败'))
      .finally(() => setLoading(false))
  }, [canSystem, reloadKey])

  useEffect(() => { void load() }, [load])

  /** 所有保存都先展示变更摘要，再由管理员确认。 */
  const save = useCallback((label: string, patch: AdminSettingsPatch, summary: string[]) => {
    confirm.confirm({
      title: `保存${label}？`,
      description: summary.length ? `将提交 ${summary.length} 项变更。` : '将提交当前表单内容。',
      confirmLabel: '确认保存',
      tone: 'default',
      onConfirm: async () => {
        setSaving(true); setError(''); setMessage('')
        try {
          const result = await updateAdminSettings(patch)
          setSettings(result.settings)
          setMessage(`${label}已保存`)
        } finally { setSaving(false) }
      },
    })
  }, [confirm])

  if (loading && !settings) return <AdminLoading label="正在读取系统设置" rows={5} />
  if (!settings) return <AdminError message={error || '系统设置加载失败'} retry={load} />

  const sections: Array<{ id: SectionId; label: string; visible: boolean }> = [
    { id: 'site', label: '站点与品牌', visible: canSystem },
    { id: 'account', label: '注册与积分', visible: canSystem || canBilling },
    { id: 'points', label: '计费与权益', visible: canBilling },
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

      <div className="flex flex-wrap gap-1.5">
        {visibleSections.map((item) => (
          <button key={item.id} type="button" onClick={() => setSection(item.id)} aria-pressed={active === item.id} className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${active === item.id ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}>{item.label}</button>
        ))}
      </div>

      {active === 'site' && <SiteSection settings={settings} onSave={(patch, summary) => save('站点设置', patch, summary)} saving={saving} />}
      {active === 'account' && <AccountSection settings={settings} canSystem={canSystem} canBilling={canBilling} onSave={(patch, summary) => save('注册与积分设置', patch, summary)} saving={saving} />}
      {active === 'points' && <PointsSection settings={settings} onSave={(patch, summary) => save('计费与权益设置', patch, summary)} saving={saving} />}
      {active === 'generation' && <GenerationSection settings={settings} onSave={(patch, summary) => save('生成设置', patch, summary)} saving={saving} />}
      {active === 'mail' && <MailSection settings={settings} onSave={(patch, summary) => save('邮件设置', patch, summary)} saving={saving} />}
      {active === 'storage' && <StorageSection storage={storage} onReload={load} onMessage={setMessage} onError={setError} />}
      {active === 'lifecycle' && <LifecycleSection settings={settings} onSave={(patch, summary) => save('数据保留设置', patch, summary)} saving={saving} />}
    </div>
  )
}

/* ------------------------------- 站点设置 ------------------------------- */

function SiteSection({ settings, onSave, saving }: { settings: AdminSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const site = settings.site || {}
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const value = (key: string) => String(data.get(key) ?? '').trim()
    const next: SiteSettings = {
      ...site,
      title: value('title'),
      logoUrl: value('logoUrl'),
      iconUrl: value('iconUrl'),
      seoTitle: value('seoTitle'),
      seoDescription: value('seoDescription'),
      seoKeywords: value('seoKeywords'),
      footerCopyright: value('footerCopyright'),
      termsUrl: value('termsUrl'),
      termsVersion: value('termsVersion'),
      privacyUrl: value('privacyUrl'),
      privacyVersion: value('privacyVersion'),
    }
    const summary: string[] = []
    for (const [key, label] of [['title', '站点名称'], ['logoUrl', 'Logo'], ['iconUrl', '站点图标'], ['seoTitle', '搜索标题'], ['seoDescription', '搜索描述'], ['footerCopyright', '页脚版权'], ['termsUrl', '服务条款地址'], ['privacyUrl', '隐私政策地址']] as const) {
      if (String((site as Record<string, unknown>)[key] ?? '') !== String((next as Record<string, unknown>)[key] ?? '')) summary.push(label)
    }
    onSave({ site: next }, summary)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <AdminSectionCard title="站点与品牌" description="站点名称、Logo 与域名展示。所有字段保存后立即对前台生效。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
          <AdminField label="站点名称"><AdminInput name="title" defaultValue={site.title} maxLength={40} /></AdminField>
          <AdminField label="站点图标 URL"><AdminInput name="iconUrl" defaultValue={site.iconUrl} /></AdminField>
          <AdminField label="Logo URL" className="sm:col-span-2"><AdminInput name="logoUrl" defaultValue={site.logoUrl} /></AdminField>
          <AdminField label="搜索标题"><AdminInput name="seoTitle" defaultValue={site.seoTitle} /></AdminField>
          <AdminField label="搜索关键词"><AdminInput name="seoKeywords" defaultValue={site.seoKeywords} /></AdminField>
          <AdminField label="搜索描述" className="sm:col-span-2"><AdminTextarea name="seoDescription" rows={2} defaultValue={site.seoDescription} /></AdminField>
          <AdminField label="页脚版权"><AdminInput name="footerCopyright" defaultValue={site.footerCopyright} /></AdminField>
          <AdminField label="首页视频地址"><AdminInput name="heroVideoUrl" defaultValue={site.heroVideoUrl} readOnly /></AdminField>
          <AdminField label="服务条款地址"><AdminInput name="termsUrl" defaultValue={site.termsUrl} /></AdminField>
          <AdminField label="服务条款版本"><AdminInput name="termsVersion" defaultValue={site.termsVersion} /></AdminField>
          <AdminField label="隐私政策地址"><AdminInput name="privacyUrl" defaultValue={site.privacyUrl} /></AdminField>
          <AdminField label="隐私政策版本"><AdminInput name="privacyVersion" defaultValue={site.privacyVersion} /></AdminField>
        </fieldset>
      </AdminSectionCard>
      <div className="flex justify-end"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-3.5" />{saving ? '保存中' : '保存站点设置'}</ControlButton></div>
    </form>
  )
}

/* ------------------------------ 注册与积分 ------------------------------ */

function AccountSection({ settings, canSystem, canBilling, onSave, saving }: { settings: AdminSettings; canSystem: boolean; canBilling: boolean; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const patch: AdminSettingsPatch = {}
    const summary: string[] = []
    if (canSystem) {
      const registration = data.has('registrationEnabled')
      const emailRegistration = data.has('emailRegistrationEnabled')
      patch.registrationEnabled = registration
      patch.emailRegistrationEnabled = emailRegistration
      if (registration !== settings.registrationEnabled) summary.push('开放注册')
      if (emailRegistration !== settings.emailRegistrationEnabled) summary.push('邮箱注册')
    }
    if (canBilling) {
      const enabled = data.has('freeDailyPointsEnabled')
      const amount = Number(data.get('freeDailyPoints')) || 0
      patch.freeDailyPointsEnabled = enabled
      patch.freeDailyPoints = amount
      if (enabled !== settings.freeDailyPointsEnabled) summary.push('每日免费积分开关')
      if (amount !== settings.freeDailyPoints) summary.push('每日免费积分数量')
    }
    onSave(patch, summary)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <AdminSectionCard title="注册开关" description="控制新用户注册入口。关闭后仅管理员可以创建账号。">
        <fieldset disabled={saving || !canSystem} className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 border-b border-border pb-3 text-sm"><span><span className="font-medium">开放注册</span><span className="mt-1 block text-xs text-muted-foreground">关闭后站点注册入口对所有访客隐藏。</span></span><input type="checkbox" name="registrationEnabled" defaultChecked={settings.registrationEnabled} /></label>
          <label className="flex items-center justify-between gap-4 text-sm"><span><span className="font-medium">邮箱注册</span><span className="mt-1 block text-xs text-muted-foreground">要求邮箱验证码完成注册，需要先配置邮件服务。</span></span><input type="checkbox" name="emailRegistrationEnabled" defaultChecked={settings.emailRegistrationEnabled} /></label>
          {!canSystem && <AdminNotice tone="warning">当前管理员没有系统设置职责，注册开关不可编辑。</AdminNotice>}
        </fieldset>
      </AdminSectionCard>
      <AdminSectionCard title="每日免费积分" description="新用户每天可自动领取的积分额度。">
        <fieldset disabled={saving || !canBilling} className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="freeDailyPointsEnabled" defaultChecked={settings.freeDailyPointsEnabled} />启用每日免费积分</label>
          <AdminField label="每日积分额度"><AdminInput name="freeDailyPoints" type="number" min="0" step="1" defaultValue={settings.freeDailyPoints} /></AdminField>
          {!canBilling && <AdminNotice tone="warning">当前管理员没有计费职责，每日免费积分不可编辑。</AdminNotice>}
        </fieldset>
      </AdminSectionCard>
      <div className="flex justify-end"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-3.5" />{saving ? '保存中' : '保存注册与积分'}</ControlButton></div>
    </form>
  )
}

/* ------------------------------ 计费与权益 ------------------------------ */

function PointsSection({ settings, onSave, saving }: { settings: AdminSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean }) {
  const [plans, setPlans] = useState(settings.entitlements.plans.map((plan) => ({ ...plan, limits: { ...plan.limits }, features: [...plan.features] })))
  const [entitlementsEnabled, setEntitlementsEnabled] = useState(settings.entitlements.enabled)
  const [defaultPlanId, setDefaultPlanId] = useState(settings.entitlements.defaultPlanId)
  const [limits, setLimits] = useState(settings.generationCostControl)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({
      entitlements: { enabled: entitlementsEnabled, defaultPlanId, plans },
      generationCostControl: limits,
    }, ['套餐权益', '生成成本控制'])
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <AdminSectionCard title="成本控制上限" description="限制单次任务与每日积分消耗，0 表示不限制。">
        <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-3">
          <AdminField label="单任务积分上限"><AdminInput type="number" min="0" value={limits.maxPointsPerTask} onChange={(event) => setLimits({ ...limits, maxPointsPerTask: Number(event.target.value) || 0 })} /></AdminField>
          <AdminField label="单用户每日上限"><AdminInput type="number" min="0" value={limits.dailyUserPointSpend} onChange={(event) => setLimits({ ...limits, dailyUserPointSpend: Number(event.target.value) || 0 })} /></AdminField>
          <AdminField label="全站每日上限"><AdminInput type="number" min="0" value={limits.dailyTotalPointSpend} onChange={(event) => setLimits({ ...limits, dailyTotalPointSpend: Number(event.target.value) || 0 })} /></AdminField>
        </fieldset>
      </AdminSectionCard>

      <AdminSectionCard title="权益方案" description="用户所属套餐决定每日积分与各类调用上限。">
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
                  <StatusBadge tone="muted">{plan.id}</StatusBadge>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={plan.enabled} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item))} />启用</label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <AdminField label="方案名称"><AdminInput value={plan.name} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} /></AdminField>
                  <AdminField label="每日赠送积分"><AdminInput type="number" min="0" value={plan.dailyPoints} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, dailyPoints: Number(event.target.value) || 0 } : item))} /></AdminField>
                  <AdminField label="每日积分消耗上限"><AdminInput type="number" min="0" value={plan.limits.dailyPointSpend} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyPointSpend: Number(event.target.value) || 0 } } : item))} /></AdminField>
                  <AdminField label="每日图片上限"><AdminInput type="number" min="0" value={plan.limits.dailyImages} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyImages: Number(event.target.value) || 0 } } : item))} /></AdminField>
                  <AdminField label="每日视频上限"><AdminInput type="number" min="0" value={plan.limits.dailyVideos} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyVideos: Number(event.target.value) || 0 } } : item))} /></AdminField>
                  <AdminField label="每日文本上限"><AdminInput type="number" min="0" value={plan.limits.dailyText} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, limits: { ...item.limits, dailyText: Number(event.target.value) || 0 } } : item))} /></AdminField>
                </div>
                <AdminField label="功能标识（每行一项）" className="mt-3">
                  <AdminTextarea rows={3} value={plan.features.join('\n')} onChange={(event) => setPlans((current) => current.map((item, position) => position === index ? { ...item, features: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) } : item))} />
                </AdminField>
              </div>
            ))}
            {!plans.length && <AdminEmpty title="暂无权益方案" description="后端尚未返回任何套餐方案定义。" />}
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

      <div className="flex justify-end"><ControlButton type="submit" variant="primary" disabled={saving}><Wallet className="size-3.5" />{saving ? '保存中' : '保存计费与权益'}</ControlButton></div>
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

      <div className="flex justify-end"><ControlButton type="submit" variant="primary" disabled={saving}><Server className="size-3.5" />{saving ? '保存中' : '保存生成设置'}</ControlButton></div>
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
  const [draft, setDraft] = useState<MailSettings>({ ...mail, password: '' })

  async function testSend() {
    setTesting(true); setTestError(''); setTestMessage('')
    try {
      await sendTestMail(testTo, draft)
      setTestMessage('测试邮件已发送，请检查收件箱。')
    } catch (reason) {
      setTestError(reason instanceof Error ? reason.message : '测试邮件发送失败')
    } finally { setTesting(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const patch: MailSettings = { ...draft }
    if (!patch.password) delete patch.password
    onSave({ mail: patch }, ['邮件服务配置'])
  }

  return (
    <div className="flex flex-col gap-4">
      <AdminSectionCard title="邮件服务" description="用于邮箱验证码、通知和测试邮件。密码字段不会回显，留空表示沿用已保存的密码。">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge tone={mail.host ? 'success' : 'muted'}>{mail.host ? `已配置：${mail.host}` : '未配置 SMTP'}</StatusBadge>
          <StatusBadge tone={mail.password ? 'success' : 'muted'}>{mail.password ? 'SMTP 密码已保存' : 'SMTP 密码未保存'}</StatusBadge>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
            <AdminField label="服务商说明"><AdminInput value={draft.provider || ''} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} /></AdminField>
            <AdminField label="SMTP 主机"><AdminInput value={draft.host || ''} onChange={(event) => setDraft({ ...draft, host: event.target.value })} /></AdminField>
            <AdminField label="端口"><AdminInput type="number" min="1" max="65535" value={draft.port ?? 465} onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) || 465 })} /></AdminField>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.secure ?? true} onChange={(event) => setDraft({ ...draft, secure: event.target.checked })} />使用 SSL/TLS</label>
            <AdminField label="SMTP 用户名"><AdminInput value={draft.username || ''} onChange={(event) => setDraft({ ...draft, username: event.target.value })} autoComplete="off" /></AdminField>
            <AdminField label="SMTP 密码" hint={mail.password ? '已保存密码，留空表示不修改。' : '尚未保存密码。'}>
              <AdminInput type="password" value={draft.password || ''} onChange={(event) => setDraft({ ...draft, password: event.target.value })} autoComplete="new-password" placeholder={mail.password ? '留空表示不修改' : ''} />
            </AdminField>
            <AdminField label="发件邮箱"><AdminInput value={draft.fromEmail || ''} onChange={(event) => setDraft({ ...draft, fromEmail: event.target.value })} /></AdminField>
            <AdminField label="发件人名称"><AdminInput value={draft.fromName || ''} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} /></AdminField>
          </fieldset>
          <div className="flex justify-end"><ControlButton type="submit" variant="primary" disabled={saving}><Save className="size-3.5" />{saving ? '保存中' : '保存邮件设置'}</ControlButton></div>
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

  useEffect(() => { if (storage) setDraft(storage) }, [storage])

  if (!storage) return <AdminEmpty title="存储配置不可用" description="当前管理员没有系统设置职责，无法读取或修改对象存储。" />

  async function save() {
    setBusy(true); onError('')
    try {
      const result = await updateObjectStorage({
        enabled: draft.enabled,
        endpoint: draft.endpoint,
        region: draft.region,
        bucket: draft.bucket,
        prefix: draft.prefix,
        forcePathStyle: draft.forcePathStyle,
        ...(accessKeyId ? { accessKeyId } : {}),
        ...(secretAccessKey ? { secretAccessKey } : {}),
      })
      void result
      setAccessKeyId(''); setSecretAccessKey('')
      onMessage('对象存储配置已保存')
      onReload()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '对象存储配置保存失败')
    } finally { setBusy(false) }
  }

  async function check() {
    setChecking(true); onError('')
    try {
      await testObjectStorage()
      onMessage('外部存储连接正常，读写权限可用。')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '外部存储连接检测失败')
    } finally { setChecking(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <AdminSectionCard title="对象存储（OSS / S3）" description="生成素材会同步到外部存储。密钥字段不会回显，留空表示沿用已保存的值。" action={<div className="flex gap-2"><StatusBadge tone={storage.enabled ? 'success' : 'muted'}>{storage.enabled ? '已启用' : '未启用'}</StatusBadge></div>}>
        <div className="mb-4 flex flex-wrap gap-2">
          <StatusBadge tone={storage.hasAccessKeyId ? 'success' : 'muted'}>Access Key {storage.hasAccessKeyId ? '已配置' : '未配置'}</StatusBadge>
          <StatusBadge tone={storage.hasSecretAccessKey ? 'success' : 'muted'}>Secret Key {storage.hasSecretAccessKey ? '已配置' : '未配置'}</StatusBadge>
          <span className="text-xs text-muted-foreground">最近更新：{storage.updatedAt ? new Date(storage.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
        </div>
        <fieldset disabled={busy || checking} className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用外部存储</label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.forcePathStyle} onChange={(event) => setDraft({ ...draft, forcePathStyle: event.target.checked })} />使用 Path Style 访问</label>
          <AdminField label="Endpoint"><AdminInput value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://s3.example.com" /></AdminField>
          <AdminField label="Region"><AdminInput value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></AdminField>
          <AdminField label="Bucket"><AdminInput value={draft.bucket} onChange={(event) => setDraft({ ...draft, bucket: event.target.value })} /></AdminField>
          <AdminField label="对象前缀"><AdminInput value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value })} /></AdminField>
          <AdminField label="Access Key ID" hint={storage.hasAccessKeyId ? '已保存，留空表示不修改。' : '尚未保存。'}><AdminInput type="password" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} autoComplete="new-password" placeholder={storage.hasAccessKeyId ? '留空表示不修改' : ''} /></AdminField>
          <AdminField label="Secret Access Key" hint={storage.hasSecretAccessKey ? '已保存，留空表示不修改。' : '尚未保存。'}><AdminInput type="password" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} autoComplete="new-password" placeholder={storage.hasSecretAccessKey ? '留空表示不修改' : ''} /></AdminField>
        </fieldset>
      </AdminSectionCard>
      <div className="flex flex-wrap justify-end gap-2">
        <ControlButton variant="secondary" onClick={() => void check()} disabled={busy || checking}><Cloud className="size-3.5" />{checking ? '检测中' : '连接检测'}</ControlButton>
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
      <AdminSectionCard title="备份与恢复" description="当前后台未开放网页端备份下载与恢复入口，避免在本地预览环境误覆盖生产数据。">
        <div className="flex items-start gap-2 text-xs text-muted-foreground"><Database className="mt-0.5 size-3.5 shrink-0" /><span>数据备份由部署层负责。如需导出或恢复数据，请使用服务器上的备份流程，不要在预览环境执行覆盖操作。</span></div>
      </AdminSectionCard>
      <div className="flex justify-end"><ControlButton type="submit" variant="primary" disabled={saving}><Settings2 className="size-3.5" />{saving ? '保存中' : '保存数据保留设置'}</ControlButton></div>
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
