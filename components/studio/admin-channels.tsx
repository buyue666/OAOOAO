'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Layers3, Pencil, Plus, RefreshCw, Search, ServerCog, Trash2, Zap } from 'lucide-react'
import { fetchChannelModels, getAdminSettings, listGenerationOperations, saveChannels, saveRouting } from '@/lib/studio/admin-api'
import { collectAliasIssues, formatAliasInput, normalizeAliases, normalizeModelKey, parseAliasInput, requestNamesOf, validateAlias } from '@/lib/studio/model-alias'
import type { AdminGenerationChannel, AdminSettings, ChannelModelConfig, LogicalModel, SystemChannel, SystemChannelModelFetchResult } from '@/lib/studio/admin-types'
import { cn } from '@/lib/utils'
import { ControlButton, StatusBadge } from './ui'
import { ModelIcon } from './model-icon'
import { LobeIconPicker } from './lobe-icon-picker'
import {
  AdminCell,
  AdminDataPanel,
  AdminDefinition,
  AdminDrawer,
  AdminEmpty,
  AdminError,
  AdminField,
  AdminInput,
  AdminLoading,
  AdminNotice,
  AdminRow,
  AdminSearch,
  AdminSectionCard,
  AdminSelect,
  AdminStat,
  AdminTable,
  AdminTabs,
  TableMessageRow,
  formatAdminNumber,
  useConfirm,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

const capabilities = [['text', '文本'], ['image', '图片'], ['video', '视频'], ['audio', '音频']] as const
type Capability = typeof capabilities[number][0]
type ChannelTab = 'channels' | 'models' | 'defaults'

const protocols = [
  ['auto', '自动识别'], ['openai', 'OpenAI 兼容'], ['anthropic', 'Anthropic'], ['gemini', 'Gemini'],
  ['azure', 'Azure OpenAI'], ['responses', 'OpenAI Responses'], ['ciyuan-async', '词元 · 异步生图'],
] as const

function localizeChannelError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason || '')
  const translations: Array<[string, string]> = [
    ['Changing a channel origin requires a new API key or clearing the saved key', '更换渠道地址后，必须填写新的 API Key，或勾选“清空已保存的 API Key”。留空仅表示沿用旧密钥。'],
    ['Changing a channel origin requires a new webhook secret or clearing the saved secret', '更换渠道地址后，必须填写新的 Webhook 密钥，或清空已保存的密钥。'],
    ['A saved API key cannot be used with a different provider origin', '保存的 API Key 不能用于不同的渠道地址，请填写新密钥或清空旧密钥。'],
    ['Changing the storage origin requires a new access key ID or clearing the saved key', '更换存储地址后，必须填写新的 Access Key ID，或清空已保存的密钥。'],
  ]
  return translations.find(([english]) => message.includes(english))?.[1] || message || fallback
}

/** 图片模型的能力选项。绑定级配置会随 capabilityProfile 一起提交给后端。 */
const imageProfileRatios = [
  ['1:1', '1:1 · 1254×1254'],
  ['3:2', '3:2 · 1536×1024'],
  ['2:3', '2:3 · 1024×1536'],
  ['16:9', '16:9 · 1672×941'],
  ['9:16', '9:16 · 941×1672'],
  ['4:3', '4:3 · 1448×1086'],
  ['3:4', '3:4 · 1086×1448'],
  ['21:9', '21:9 · 1923×817'],
] as const
const imageProfileResolutions = [['1K', '1K'], ['2K', '2K'], ['4K', '4K']] as const
const imageProfileQualities = [['auto', '自动'], ['low', '低'], ['medium', '中'], ['high', '高']] as const

export function AdminChannelsPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const canManage = session.can('upstream.manage')

  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [health, setHealth] = useState<AdminGenerationChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<SystemChannel | 'new' | null>(null)
  const [routing, setRouting] = useState(false)
  const [tab, setTab] = useState<ChannelTab>('channels')
  const [channelQuery, setChannelQuery] = useState('')
  const [channelStatus, setChannelStatus] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [modelQuery, setModelQuery] = useState('')
  const [modelCapability, setModelCapability] = useState<'all' | Capability>('all')
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true); setError('')
    Promise.all([getAdminSettings(), listGenerationOperations({ page: 1, pageSize: 1 }).then((result) => result.channels).catch(() => [] as AdminGenerationChannel[])])
      .then(([next, channels]) => { setSettings(next); setHealth(channels) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '渠道配置加载失败'))
      .finally(() => setLoading(false))
  }, [reloadKey])

  useEffect(() => { void load() }, [load])

  const channels = settings?.systemChannels ?? []
  const models = settings?.logicalModels ?? []
  const enabledChannels = channels.filter((channel) => channel.enabled)
  const missingKey = channels.filter((channel) => !channel.hasApiKey).length
  /** 运行时健康信息来自生成运维接口，按渠道汇总失败次数与冷却状态。 */
  const healthByChannel = useMemo(() => {
    const map = new Map<string, { cooling: boolean; consecutiveFailures: number; cooldownUntil?: number; lastError?: string; bindings: number; capability: string }>()
    for (const item of health) {
      const current = map.get(item.id)
      const cooling = item.runtimeHealth.status === 'cooling'
      map.set(item.id, {
        cooling: (current?.cooling || false) || cooling,
        consecutiveFailures: Math.max(current?.consecutiveFailures || 0, item.runtimeHealth.consecutiveFailures || 0),
        cooldownUntil: item.runtimeHealth.cooldownUntil || current?.cooldownUntil,
        lastError: item.runtimeHealth.lastError || current?.lastError,
        bindings: (current?.bindings || 0) + 1,
        capability: current?.capability || item.capability,
      })
    }
    return map
  }, [health])
  const coolingCount = Array.from(healthByChannel.values()).filter((item) => item.cooling).length

  const removeChannel = useCallback((channel: SystemChannel) => {
    confirm.confirm({
      title: `删除渠道 ${channel.name || channel.id}？`,
      description: '删除后引用该渠道的逻辑模型绑定会同时移除。已有生成记录不受影响。',
      confirmLabel: '确认删除渠道',
      tone: 'danger',
      onConfirm: async () => {
        await saveChannels(channels.filter((item) => item.id !== channel.id))
        setMessage('渠道已删除')
        load()
      },
    })
  }, [channels, confirm, load])

  const toggleChannel = useCallback(async (channel: SystemChannel) => {
    try {
      await saveChannels(channels.map((item) => item.id === channel.id ? { ...item, enabled: !item.enabled } : item))
      setMessage(channel.enabled ? '渠道已停用' : '渠道已启用')
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '状态修改失败')
    }
  }, [channels, load])

  const channelNeedle = channelQuery.trim().toLowerCase()
  const visibleChannels = channels.filter((channel) => {
    if (channelStatus === 'enabled' && !channel.enabled) return false
    if (channelStatus === 'disabled' && channel.enabled) return false
    return !channelNeedle || [channel.id, channel.name, channel.baseUrl].some((field) => field?.toLowerCase().includes(channelNeedle))
  })
  const modelNeedle = modelQuery.trim().toLowerCase()
  const visibleModels = models.filter((model) => {
    if (modelCapability !== 'all' && model.capability !== modelCapability) return false
    return !modelNeedle || [model.id, model.name].some((field) => field?.toLowerCase().includes(modelNeedle))
  })

  if (loading && !settings) return <AdminLoading label="正在读取模型与渠道" />
  if (!settings) return <AdminError message={error || '渠道配置加载失败'} retry={load} />

  return (
    <div className="flex flex-col gap-5">
      {confirm.dialog}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStat label="逻辑模型" value={formatAdminNumber(models.length)} detail="对外展示给用户的模型" />
        <AdminStat label="配置渠道" value={formatAdminNumber(channels.length)} detail={`其中启用 ${formatAdminNumber(enabledChannels.length)}`} tone="success" />
        <AdminStat label="冷却中渠道" value={formatAdminNumber(coolingCount)} detail="连续失败后被自动降权" tone={coolingCount ? 'danger' : 'neutral'} />
        <AdminStat label="缺少密钥" value={formatAdminNumber(missingKey)} detail="未保存 API Key 的渠道" tone={missingKey ? 'warning' : 'neutral'} />
      </div>

      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}

      <AdminTabs
        label="模型与渠道分区"
        items={[['channels', '上游渠道'], ['models', '逻辑模型'], ['defaults', '默认模型与价格']] as const}
        value={tab}
        onChange={setTab}
      />

      {tab === 'channels' && (
        <AdminDataPanel
          title="上游渠道"
          description="Base URL、密钥与协议配置。API Key 始终脱敏显示，编辑时留空表示沿用已保存的密钥。"
          actions={canManage ? <ControlButton variant="primary" size="sm" onClick={() => setEditing('new')}><Plus className="size-3.5" />新增渠道</ControlButton> : undefined}
          filters={
            <>
              <AdminSearch value={channelQuery} onChange={setChannelQuery} placeholder="搜索渠道名称、标识或地址" />
              <AdminSelect aria-label="按启用状态筛选渠道" value={channelStatus} onChange={(event) => setChannelStatus(event.target.value as typeof channelStatus)} className="w-36">
                <option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option>
              </AdminSelect>
            </>
          }
          filterActions={<ControlButton variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>}
        >
          {channels.length ? (
            <AdminTable columns={['渠道', '协议', '状态', '模型', '绑定', '连续失败', '密钥与回调', '操作']} minWidth={1120} caption="上游渠道列表">
              {visibleChannels.map((channel) => {
                const runtime = healthByChannel.get(channel.id)
                const bindingCount = models.reduce((total, model) => total + model.bindings.filter((binding) => binding.channelId === channel.id).length, 0)
                return (
                  <AdminRow key={channel.id}>
                    <AdminCell className="max-w-[280px]">
                      <p className="truncate font-medium">{channel.name || channel.id}</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{channel.baseUrl || '未配置地址'}</p>
                    </AdminCell>
                    <AdminCell className="text-xs">{channel.advancedConfig?.protocol || channel.apiFormat || 'auto'}</AdminCell>
                    <AdminCell className="max-w-[240px]">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge tone={channel.enabled ? 'success' : 'muted'}>{channel.enabled ? '已启用' : '已停用'}</StatusBadge>
                        {runtime?.cooling && <StatusBadge tone="danger">冷却中</StatusBadge>}
                      </div>
                      {runtime?.cooldownUntil && <p className="mt-1.5 text-[11px] text-studio-warn">冷却至 {new Date(runtime.cooldownUntil).toLocaleString('zh-CN', { hour12: false })}</p>}
                      {runtime?.lastError && <p className="mt-1 line-clamp-2 text-[11px] text-destructive" title={runtime.lastError}>最后错误：{runtime.lastError}</p>}
                    </AdminCell>
                    <AdminCell className="text-xs">{channel.models.length}</AdminCell>
                    <AdminCell className="text-xs">{bindingCount}</AdminCell>
                    <AdminCell className={cn('text-xs', runtime?.consecutiveFailures ? 'text-destructive' : '')}>{runtime?.consecutiveFailures ?? 0}</AdminCell>
                    <AdminCell className="text-xs">
                      <p>API Key：{channel.hasApiKey ? '已配置（已脱敏）' : '未配置'}</p>
                      <p className="mt-1 text-muted-foreground">Webhook：{channel.hasWebhookSecret ? '已配置（已脱敏）' : '未配置'}</p>
                    </AdminCell>
                    <AdminCell>
                      {canManage && (
                        <div className="flex flex-wrap gap-1.5">
                          <ControlButton variant="secondary" size="sm" onClick={() => setEditing(channel)}><Pencil className="size-3.5" />编辑</ControlButton>
                          <ControlButton variant="secondary" size="sm" onClick={() => void toggleChannel(channel)}>{channel.enabled ? '停用' : '启用'}</ControlButton>
                          <ControlButton variant="danger" size="sm" onClick={() => removeChannel(channel)} aria-label={`删除渠道 ${channel.name || channel.id}`}><Trash2 className="size-3.5" /></ControlButton>
                        </div>
                      )}
                    </AdminCell>
                  </AdminRow>
                )
              })}
              {!visibleChannels.length && <TableMessageRow colSpan={8} loading={false} empty="没有匹配的渠道" />}
            </AdminTable>
          ) : <AdminEmpty title="暂无渠道配置" description="新增至少一个上游渠道后，才能为逻辑模型建立绑定并开始生成。" />}
        </AdminDataPanel>
      )}

      {tab === 'models' && (
        <AdminDataPanel
          title="逻辑模型"
          description="对用户展示的模型名称、能力类型与渠道绑定优先级。修改后立即影响路由。"
          actions={canManage ? <ControlButton variant="primary" size="sm" onClick={() => setRouting(true)}><Layers3 className="size-3.5" />管理路由</ControlButton> : undefined}
          filters={
            <>
              <AdminSearch value={modelQuery} onChange={setModelQuery} placeholder="搜索显示名称或标识" />
              <AdminSelect aria-label="按能力筛选模型" value={modelCapability} onChange={(event) => setModelCapability(event.target.value as 'all' | Capability)} className="w-36">
                <option value="all">全部能力</option>
                {capabilities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </AdminSelect>
            </>
          }
        >
          {models.length ? (
            <AdminTable columns={['显示名称', '标识', '能力', '状态', '渠道绑定']} minWidth={900} caption="逻辑模型列表">
              {visibleModels.map((model) => (
                <AdminRow key={model.id}>
                  <AdminCell className="font-medium">{model.name || model.id}</AdminCell>
                  <AdminCell className="font-mono text-[11px]">{model.id}</AdminCell>
                  <AdminCell><StatusBadge tone="muted">{capabilityLabel(model.capability)}</StatusBadge></AdminCell>
                  <AdminCell><StatusBadge tone={model.enabled ? 'success' : 'muted'}>{model.enabled ? '已启用' : '已停用'}</StatusBadge></AdminCell>
                  <AdminCell>
                    <div className="flex flex-wrap gap-1.5">
                      {model.bindings.map((binding) => (
                        <span key={binding.id} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">
                          {binding.channelId}:{binding.upstreamModel} · P{binding.priority}
                          {!binding.enabled && <span className="text-destructive">停用</span>}
                        </span>
                      ))}
                      {!model.bindings.length && <span className="text-xs text-muted-foreground">未绑定渠道</span>}
                    </div>
                  </AdminCell>
                </AdminRow>
              ))}
              {!visibleModels.length && <TableMessageRow colSpan={5} loading={false} empty="没有匹配的模型" />}
            </AdminTable>
          ) : <AdminEmpty title="暂无逻辑模型" description="逻辑模型决定用户在生成页看到的模型列表。" />}
        </AdminDataPanel>
      )}

      {tab === 'defaults' && (
        <AdminSectionCard title="默认模型与价格" description="生成页在用户未显式选择模型时使用的默认模型，以及每个模型的计费倍率。">
          <SettingsSummary settings={settings} onEdit={canManage ? () => setRouting(true) : undefined} />
        </AdminSectionCard>
      )}

      {editing && (
        <ChannelEditor
          channel={editing === 'new' ? undefined : editing}
          existingChannels={channels}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setMessage(text); setEditing(null); load() }}
        />
      )}
      {routing && settings && (
        <RoutingEditor
          settings={settings}
          onClose={() => setRouting(false)}
          onSaved={(text) => { setMessage(text); setRouting(false); load() }}
        />
      )}
    </div>
  )
}

function SettingsSummary({ settings, onEdit }: { settings: AdminSettings; onEdit?: () => void }) {
  const defaults = settings.defaultModels
  const costs = Object.entries(settings.modelPointCosts || {})
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 text-xs sm:grid-cols-4">
        {capabilities.map(([value, label]) => <AdminDefinition key={value} label={`默认${label}模型`} value={defaults[value === 'text' ? 'textModel' : value === 'image' ? 'imageModel' : value === 'video' ? 'videoModel' : 'audioModel']} />)}
      </div>
      {costs.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">模型</th><th className="py-2 font-medium">单次积分</th></tr></thead>
            <tbody>{costs.map(([model, cost]) => <tr key={model} className="border-t border-border"><td className="py-2 pr-3 font-mono text-[11px]">{model}</td><td className="py-2">{formatAdminNumber(cost)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="text-xs text-muted-foreground">未配置模型积分价格，将使用生成倍率计算。</p>}
      {onEdit && <ControlButton variant="secondary" size="sm" className="self-start" onClick={onEdit}><Zap className="size-3.5" />修改默认模型与价格</ControlButton>}
    </div>
  )
}

function capabilityLabel(value: Capability | string) {
  return capabilities.find(([id]) => id === value)?.[1] ?? value
}

/* -------------------------------- 渠道编辑 -------------------------------- */

function ChannelEditor({ channel, existingChannels, onClose, onSaved }: { channel?: SystemChannel; existingChannels: SystemChannel[]; onClose: () => void; onSaved: (message: string) => void }) {
  const isNew = !channel
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [models, setModels] = useState<string[]>(channel?.models ?? [])
  const [capabilityMap, setCapabilityMap] = useState<Record<string, Capability>>(() => normalizeCapabilities(channel))
  const [modelConfigs, setModelConfigs] = useState<Record<string, ChannelModelConfig>>(() => channel?.advancedConfig?.modelConfigs ?? {})
  const [fetching, setFetching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearApiKey, setClearApiKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState(channel?.baseUrl ?? '')
  const [protocol, setProtocol] = useState(channel?.advancedConfig?.protocol || 'auto')

  const save = useCallback(async (form: HTMLFormElement) => {
    const data = new FormData(form)
    const value = (key: string) => String(data.get(key) ?? '').trim()
    const id = channel?.id || value('id')
    if (!id) throw new Error('请填写渠道标识')
    if (!value('baseUrl')) throw new Error('请填写 Base URL')
    const payload: SystemChannel = {
      id,
      name: value('name') || id,
      baseUrl: value('baseUrl'),
      apiKey: value('apiKey'),
      webhookSecret: value('webhookSecret'),
      apiFormat: channel?.apiFormat || 'openai',
      models,
      enabled: data.get('enabled') !== null,
      clearApiKey: clearApiKey || undefined,
      advancedConfig: {
        ...(channel?.advancedConfig || {}),
        protocol: value('protocol') || protocol,
        modelCapabilities: Object.fromEntries(models.map((model) => [model, capabilityMap[model] || 'text'])),
        modelConfigs,
      },
    }
    const next = isNew ? [...existingChannels, payload] : existingChannels.map((item) => item.id === channel!.id ? payload : item)
    await saveChannels(next)
    return id
  }, [capabilityMap, channel, clearApiKey, existingChannels, isNew, modelConfigs, models, protocol])

  async function pullModels(form: HTMLFormElement) {
    setFetching(true); setError(''); setMessage('')
    try {
      const data = new FormData(form)
      const apiKey = String(data.get('apiKey') ?? '').trim()
      if (!apiKey && !channel?.hasApiKey) throw new Error('拉取模型需要先填写 API Key')
      const result: SystemChannelModelFetchResult = await fetchChannelModels({
        channelId: channel?.id,
        baseUrl: String(data.get('baseUrl') ?? '').trim(),
        apiKey: apiKey || undefined,
        apiFormat: channel?.apiFormat || 'openai',
        protocol: String(data.get('protocol') ?? '') || undefined,
        configuredModels: models,
      })
      const merged = Array.from(new Set([...models, ...(result.models ?? [])]))
      setModels(merged)
      setCapabilityMap((current) => {
        const next = { ...current }
        for (const model of result.models ?? []) next[model] = (result.modelCapabilities?.[model] as Capability) || next[model] || 'text'
        return next
      })
      setModelConfigs((current) => ({ ...current, ...(result.modelConfigs ?? {}) }))
      setMessage(`拉取到 ${result.discoveredCount ?? result.models?.length ?? 0} 个模型，共 ${merged.length} 个可配置模型。${result.warning || ''}`)
    } catch (reason) {
      setError(localizeChannelError(reason, '拉取模型失败'))
    } finally {
      setFetching(false)
    }
  }

  async function testConnection(form: HTMLFormElement) {
    setTesting(true); setError(''); setMessage('')
    try {
      const data = new FormData(form)
      const apiKey = String(data.get('apiKey') ?? '').trim()
      if (!apiKey && !channel?.hasApiKey) throw new Error('连通性测试需要先填写 API Key')
      const result = await fetchChannelModels({
        channelId: channel?.id,
        baseUrl: String(data.get('baseUrl') ?? '').trim(),
        apiKey: apiKey || undefined,
        apiFormat: channel?.apiFormat || 'openai',
        protocol: String(data.get('protocol') ?? '') || undefined,
      })
      setMessage(`连通正常，识别到 ${result.discoveredCount ?? result.models?.length ?? 0} 个模型。`)
    } catch (reason) {
      setError(localizeChannelError(reason, '连通性测试失败'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title={isNew ? '新增渠道' : `编辑渠道 ${channel?.name || channel?.id}`}
      description="API Key 不会回显；留空表示沿用已保存的密钥。所有密钥只提交新值。"
      footer={
        <>
          <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
          <ControlButton type="submit" form="channel-editor-form" variant="primary" disabled={busy}>{busy ? '保存中' : '保存渠道'}</ControlButton>
        </>
      }
    >
      <form
        id="channel-editor-form"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true); setError(''); setMessage('')
          try { const id = await save(event.currentTarget); onSaved(`渠道 ${id} 已保存`) }
          catch (reason) { setError(localizeChannelError(reason, '保存失败')) }
          finally { setBusy(false) }
        }}
        className="flex flex-col gap-4"
      >
        <fieldset disabled={busy || fetching || testing} className="grid gap-4 sm:grid-cols-2">
          <AdminField label="渠道标识" hint="唯一标识，创建后不可修改。"><AdminInput name="id" required={isNew} disabled={!isNew} defaultValue={channel?.id} maxLength={60} pattern="[A-Za-z0-9._-]+" /></AdminField>
          <AdminField label="渠道名称"><AdminInput name="name" defaultValue={channel?.name} maxLength={80} /></AdminField>
          <AdminField label="Base URL" className="sm:col-span-2"><AdminInput name="baseUrl" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></AdminField>
          <AdminField label="API Key" hint={channel?.hasApiKey ? '已保存密钥。留空表示不修改（仅当 Base URL 不变时沿用）；更换地址请填新密钥或勾选清空。' : '尚未保存密钥。'}>
            <AdminInput name="apiKey" type="password" autoComplete="new-password" placeholder={channel?.hasApiKey ? '留空表示不修改' : '请输入 API Key'} disabled={clearApiKey} />
          </AdminField>
          <AdminField label="Webhook 密钥" hint={channel?.hasWebhookSecret ? '已保存。留空表示不修改。' : '仅异步回调渠道需要。'}>
            <AdminInput name="webhookSecret" type="password" autoComplete="new-password" placeholder={channel?.hasWebhookSecret ? '留空表示不修改' : '可选'} />
          </AdminField>
          <AdminField label="渠道协议">
            <AdminSelect name="protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)}>
              {protocols.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </AdminSelect>
          </AdminField>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="enabled" defaultChecked={channel?.enabled ?? true} />启用该渠道</label>
          {channel?.hasApiKey && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
              <input type="checkbox" checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} />清空已保存的 API Key（更换地址且不需要密钥时使用）
            </label>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <ControlButton variant="secondary" size="sm" disabled={busy || fetching} onClick={(event) => { const form = (event.currentTarget as HTMLButtonElement).form; if (form) void pullModels(form) }}><Download className="size-3.5" />{fetching ? '拉取中' : '拉取模型列表'}</ControlButton>
          <ControlButton variant="secondary" size="sm" disabled={busy || testing} onClick={(event) => { const form = (event.currentTarget as HTMLButtonElement).form; if (form) void testConnection(form) }}><ServerCog className="size-3.5" />{testing ? '测试中' : '连通性测试'}</ControlButton>
        </div>

        {models.length > 0 && (
          <AdminSectionCard title="模型能力配置" description="为每个模型选择能力类型；图片、视频、音频与文本会走不同的协议路径。" className="p-4">
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {models.map((model) => (
                <div key={model} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{model}</span>
                  <AdminSelect
                    aria-label={`${model} 能力`}
                    className="w-28"
                    value={capabilityMap[model] || 'text'}
                    onChange={(event) => setCapabilityMap((current) => ({ ...current, [model]: event.target.value as Capability }))}
                  >
                    {capabilities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </AdminSelect>
                  <ControlButton variant="ghost" size="sm" onClick={() => { setModels((current) => current.filter((item) => item !== model)); setModelConfigs((current) => { const next = { ...current }; delete next[model]; return next }) }} aria-label={`移除 ${model}`}><Trash2 className="size-3.5" /></ControlButton>
                </div>
              ))}
            </div>
            <ManualModelAdd onAdd={(model) => { setModels((current) => current.includes(model) ? current : [...current, model]); setCapabilityMap((current) => ({ ...current, [model]: current[model] || 'text' })) }} />
          </AdminSectionCard>
        )}

        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
        {message && <AdminNotice tone="success">{message}</AdminNotice>}
      </form>
    </AdminDrawer>
  )
}

function ManualModelAdd({ onAdd }: { onAdd: (model: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="mt-3 flex gap-2">
      <AdminInput aria-label="手动添加模型" value={value} onChange={(event) => setValue(event.target.value)} placeholder="上游未提供目录时手动填写模型 ID" />
      <ControlButton variant="secondary" size="sm" onClick={() => { const model = value.trim(); if (!model) return; onAdd(model); setValue('') }}><Plus className="size-3.5" />添加</ControlButton>
    </div>
  )
}

/* -------------------------------- 路由编辑 -------------------------------- */

function RoutingEditor({ settings, onClose, onSaved }: { settings: AdminSettings; onClose: () => void; onSaved: (message: string) => void }) {
  const [models, setModels] = useState<LogicalModel[]>(() => settings.logicalModels.map((model) => ({ ...model, bindings: model.bindings.map((binding) => ({ ...binding })) })))
  const [defaults, setDefaults] = useState(settings.defaultModels)
  const [costs, setCosts] = useState<Record<string, number>>(settings.modelPointCosts || {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [capabilityFilter, setCapabilityFilter] = useState<'all' | Capability>('all')
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState(() => settings.defaultModels.imageModel || settings.logicalModels[0]?.id || '')
  const [batchNotice, setBatchNotice] = useState('')
  const confirm = useConfirm()

  const channelIds = useMemo(() => settings.systemChannels.map((channel) => channel.id), [settings.systemChannels])
  const channelModels = useMemo(() => new Map(settings.systemChannels.map((channel) => [channel.id, channel.models])), [settings.systemChannels])
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return models.filter((model) => {
      const matchesQuery = !normalized || [model.id, model.name, ...(model.aliases || [])].some((value) => value.toLowerCase().includes(normalized))
      const matchesCapability = capabilityFilter === 'all' || model.capability === capabilityFilter
      return matchesQuery && matchesCapability && (!enabledOnly || model.enabled)
    })
  }, [capabilityFilter, enabledOnly, models, query])
  const selectedModel = filteredModels.find((model) => model.id === selectedModelId) || filteredModels[0]

  /* 批量作用于当前筛选结果；停用会让模型脱离路由，因此必须二次确认。草稿仍需「保存路由配置」才生效。 */
  const setFilteredEnabled = (enabled: boolean) => {
    const ids = new Set(filteredModels.map((model) => model.id))
    if (!ids.size) return
    const apply = () => {
      setModels((current) => current.map((model) => (ids.has(model.id) ? { ...model, enabled } : model)))
      setBatchNotice(`已${enabled ? '启用' : '停用'} ${ids.size} 个逻辑模型，保存路由配置后生效`)
    }
    if (enabled) { apply(); return }
    confirm.confirm({
      title: `停用 ${ids.size} 个逻辑模型？`,
      description: '停用后这些模型不再参与路由，用户将无法选择它们。',
      confirmLabel: '确认停用',
      tone: 'danger',
      onConfirm: apply,
    })
  }

  /**
   * 别名输入框是**本地草稿**：只有点「保存别名」才写进 `models`。
   *
   * 逐字符写入会让「输入到一半的别名」立刻参与冲突校验，
   * 于是正常输入 `oaooao-image` 的过程中会被自己前几个字符判为冲突/非法。
   */
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const model of settings.logicalModels) initial[model.id] = formatAliasInput(model.aliases)
    return initial
  })
  const [aliasError, setAliasError] = useState<Record<string, string>>({})

  function patchModel(id: string, patch: Partial<LogicalModel>) {
    setModels((current) => current.map((model) => model.id === id ? { ...model, ...patch } : model))
  }


  /** 校验并写入别名；冲突时只提示、不写入。 */
  function applyAliasDraft(modelId: string) {
    const parsed = parseAliasInput(aliasDraft[modelId] ?? '')
    const model = models.find((item) => item.id === modelId)
    if (!model) return
    const currentKeys = new Set((model.aliases ?? []).map(normalizeModelKey))
    const accepted: string[] = []
    const siblings: string[] = []
    for (const alias of parsed) {
      // 与本模型已有别名重复时直接跳过，不算冲突。
      if (currentKeys.has(normalizeModelKey(alias))) { siblings.push(alias); continue }
      const issue = validateAlias({ alias, modelId, siblings, models })
      if (issue) { setAliasError((current) => ({ ...current, [modelId]: issue })); return }
      siblings.push(alias)
      accepted.push(alias)
    }
    const next = normalizeAliases([...(model.aliases ?? []), ...accepted], modelId)
    setModels((current) => current.map((item) => item.id === modelId ? { ...item, aliases: next } : item))
    setAliasDraft((current) => ({ ...current, [modelId]: formatAliasInput(next) }))
    setAliasError((current) => ({ ...current, [modelId]: '' }))
  }

  async function submit() {
    setBusy(true); setError('')
    try {
      for (const model of models) {
        for (const binding of model.bindings) {
          if (!channelIds.includes(binding.channelId)) throw new Error(`模型 ${model.name || model.id} 绑定了不存在的渠道 ${binding.channelId}`)
        }
      }
      const routeAliasOwners = new Map<string, string>()
      for (const model of models) {
        for (const binding of model.bindings) {
          const alias = binding.requestAlias?.trim()
          if (!alias) continue
          const key = normalizeModelKey(alias)
          const owner = routeAliasOwners.get(key)
          const currentOwner = `${model.id}:${binding.channelId}`
          if (owner && owner !== currentOwner) throw new Error(`请求别名 ${alias} 被多个渠道入口使用，请为每个售卖入口设置唯一别名`)
          routeAliasOwners.set(key, currentOwner)
        }
      }
      // 别名冲突必须在提交前拦住：保存后行为会随数组顺序变化。
      const aliasIssues = collectAliasIssues(models)
      if (aliasIssues.length) throw new Error(aliasIssues[0])
      await saveRouting({ logicalModels: models, defaultModels: defaults, modelPointCosts: costs })
      onSaved('模型路由、默认模型与价格已保存')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title="逻辑模型与路由"
      description="按「渠道 → 逻辑模型 → 别名 → 显示信息 → 价格」的层级编辑；先筛选模型，保存时一次提交当前配置。"
      width="sm:max-w-6xl"
      footer={<>
        <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
        <ControlButton variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? '保存中' : '保存路由配置'}</ControlButton>
      </>}
    >
      <div className="flex flex-col gap-4">
        {confirm.dialog}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <AdminSectionCard title="默认模型" description="用户在生成页未选择模型时使用。" className="p-4 xl:order-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {capabilities.map(([value, label]) => {
              const key = value === 'text' ? 'textModel' : value === 'image' ? 'imageModel' : value === 'video' ? 'videoModel' : 'audioModel'
              const candidates = models.filter((model) => model.capability === value).map((model) => model.id)
              return (
                <AdminField key={value} label={`默认${label}模型`}>
                  <AdminSelect value={defaults[key as keyof typeof defaults] || ''} onChange={(event) => setDefaults((current) => ({ ...current, [key]: event.target.value }))}>
                    <option value="">未设置</option>
                    {candidates.map((id) => <option key={id} value={id}>{id}</option>)}
                  </AdminSelect>
                </AdminField>
              )
            })}
          </div>
        </AdminSectionCard>

        <AdminSectionCard title="可售模型目录" description="一个逻辑模型可以拆成多个渠道入口；每个入口可使用独立别名、价格和图标。" className="p-4 xl:order-1">
          <div className="flex flex-wrap items-center gap-2">
            <label className="studio-field flex h-9 min-w-0 flex-1 items-center gap-2 border border-border bg-card px-3 text-muted-foreground sm:max-w-sm">
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <input aria-label="搜索逻辑模型" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、标识或别名" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70" />
            </label>
            <AdminSelect aria-label="按能力筛选模型" className="w-32" value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value as 'all' | Capability)}>
              <option value="all">全部能力</option>
              {capabilities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </AdminSelect>
            <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs text-muted-foreground">
              <input type="checkbox" checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} />仅看启用
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <ControlButton variant="secondary" size="sm" disabled={!filteredModels.length} onClick={() => setFilteredEnabled(true)}>启用当前结果</ControlButton>
              <ControlButton variant="secondary" size="sm" disabled={!filteredModels.length} onClick={() => setFilteredEnabled(false)}>停用当前结果</ControlButton>
            </div>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">显示 {filteredModels.length} / {models.length}</span>
          </div>
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {filteredModels.map((model) => (
              <button
                key={model.id}
                type="button"
                aria-pressed={selectedModel?.id === model.id}
                onClick={() => setSelectedModelId(model.id)}
                className={cn('min-w-0 rounded-lg border px-3 py-2.5 text-left transition-colors', selectedModel?.id === model.id ? 'border-studio-accent/55 bg-studio-accent/10' : 'border-border bg-card/45 hover:bg-muted')}
              >
                  <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2"><span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted p-1 text-studio-accent"><ModelIcon model={model} /></span><span className="min-w-0 truncate text-xs font-semibold">{model.name || model.id}</span></span>
                  <StatusBadge tone={model.enabled ? 'success' : 'muted'}>{model.enabled ? '启用' : '停用'}</StatusBadge>
                </span>
                <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{model.id}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">{capabilityLabel(model.capability)} · {model.bindings.length} 个渠道绑定 · {formatAdminNumber(costs[model.id] ?? 0)} 积分/次</span>
              </button>
            ))}
          </div>
          {batchNotice && <p role="status" className="mt-2 text-xs text-muted-foreground">{batchNotice}</p>}
        </AdminSectionCard>
        </div>

        {selectedModel ? [selectedModel].map((model) => (
          <details key={model.id} open className="admin-model-editor overflow-hidden rounded-lg border border-border bg-card/25">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">{model.name || model.id}<span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">{model.id} · {capabilityLabel(model.capability)} · {model.bindings.length} 个绑定</span></span>
              <span className="shrink-0 text-xs text-studio-accent">当前编辑</span>
            </summary>
            <div className="border-t border-border p-4">
              <AdminSectionCard
                title={`${model.name || model.id}`}
                description={`标识 ${model.id} · 能力 ${capabilityLabel(model.capability)}`}
                action={<ControlButton variant="ghost" size="sm" onClick={() => setModels((current) => current.filter((item) => item.id !== model.id))} aria-label={`删除 ${model.id}`}><Trash2 className="size-3.5" /></ControlButton>}
                className="p-4"
              >
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-foreground">1 · 渠道绑定<span className="ml-2 font-normal text-muted-foreground">优先级数字越小越先选中；权重决定同级流量分配；并发上限 0 表示沿用渠道默认</span></p>
              {model.bindings.map((binding, index) => {
                const requestKey = binding.requestAlias?.trim() || binding.upstreamModel
                const routeCost = costs[requestKey] ?? costs[model.id] ?? 0
                return (
                  <div key={binding.id || index} className="flex flex-wrap items-center gap-2">
                    <AdminSelect className="w-40" value={binding.channelId} onChange={(event) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, channelId: event.target.value, id: `${event.target.value}:${item.upstreamModel}` } : item) })}>
                      <option value="">选择渠道</option>
                      {channelIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </AdminSelect>
                    <AdminInput className="w-44" value={binding.upstreamModel} placeholder="上游模型 ID" onChange={(event) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, upstreamModel: event.target.value, id: `${item.channelId}:${event.target.value}` } : item) })} />
                    <AdminInput className="w-44" value={binding.requestAlias || ''} placeholder="对外别名（可选）" aria-label={`${model.id} 渠道${index + 1} 对外别名`} onChange={(event) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, requestAlias: event.target.value.trim() || undefined } : item) })} />
                    <AdminInput className="w-24" type="number" min="0" step="0.01" value={routeCost} aria-label={`${model.id} 渠道${index + 1} 单价`} title={binding.requestAlias ? `别名 ${binding.requestAlias} 的单次积分` : '该上游模型的单次积分'} onChange={(event) => setCosts((current) => ({ ...current, [requestKey]: Number(event.target.value) || 0 }))} />
                    <LobeIconPicker className="w-48" compact value={binding.iconUrl} aria-label={`${model.id} 渠道${index + 1} 图标`} onChange={(value) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, iconUrl: value } : item) })} />
                    <AdminInput className="w-20" type="number" min="1" value={binding.priority} aria-label="优先级" title="优先级：数字越小越先被选中" onChange={(event) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, priority: Number(event.target.value) || 1 } : item) })} />
                    <AdminInput className="w-20" type="number" min="1" max="1000" value={binding.weight ?? 1} aria-label="权重" title="权重：同级渠道之间的流量分配比例" onChange={(event) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, weight: Number(event.target.value) || 1 } : item) })} />
                    <AdminInput
                      className="w-24" type="number" min="0" max="1000" aria-label="并发上限" title="该绑定的并发上限，0 表示沿用渠道默认"
                      value={Number((binding.capabilityProfile as Record<string, unknown> | undefined)?.concurrencyLimit ?? 0)}
                      onChange={(event) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, capabilityProfile: { ...(item.capabilityProfile || {}), concurrencyLimit: Number(event.target.value) || 0 } } : item) })}
                    />
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={binding.enabled} onChange={(event) => patchModel(model.id, { bindings: model.bindings.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item) })} />启用</label>
                    <ControlButton variant="ghost" size="sm" aria-label="移除绑定" onClick={() => patchModel(model.id, { bindings: model.bindings.filter((_, position) => position !== index) })}><Trash2 className="size-3.5" /></ControlButton>
                    {channelModels.has(binding.channelId) && !channelModels.get(binding.channelId)?.includes(binding.upstreamModel) && <StatusBadge tone="warning">渠道未列出该模型</StatusBadge>}
                    {model.capability === 'image' && (
                      <ImageBindingCapabilityEditor
                        profile={binding.capabilityProfile}
                        onChange={(patch) => patchModel(model.id, {
                          bindings: model.bindings.map((item, position) => position === index
                            ? { ...item, capabilityProfile: { ...(item.capabilityProfile || {}), ...patch } }
                            : item),
                        })}
                        onReset={() => patchModel(model.id, {
                          bindings: model.bindings.map((item, position) => {
                            if (position !== index) return item
                            const profile = { ...(item.capabilityProfile || {}) }
                            for (const key of ['aspectRatios', 'outputResolutions', 'resolutions', 'imageQualities', 'qualities', 'outputDimensions', 'sizeMap']) delete profile[key]
                            return { ...item, capabilityProfile: profile }
                          }),
                        })}
                      />
                    )}
                  </div>
                )
              })}
              <ControlButton
                variant="secondary" size="sm" className="self-start"
                onClick={() => patchModel(model.id, { bindings: [...model.bindings, { id: `new-${Date.now()}`, channelId: channelIds[0] || '', upstreamModel: model.id, enabled: true, priority: model.bindings.length + 1 }] })}
              ><Plus className="size-3.5" />添加绑定</ControlButton>
            </div>

            <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <p className="text-xs font-semibold text-foreground sm:col-span-2">2 · 逻辑模型<span className="ml-2 font-normal text-muted-foreground">能力决定请求路径；停用后不参与路由</span></p>
              <AdminField label="能力类型">
                <AdminSelect value={model.capability} onChange={(event) => patchModel(model.id, { capability: event.target.value as LogicalModel['capability'] })}>
                  {capabilities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </AdminSelect>
              </AdminField>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={model.enabled} onChange={(event) => patchModel(model.id, { enabled: event.target.checked })} />启用该逻辑模型</label>
            </div>

            {/**
              * 请求别名。
              *
              * `id` 被已有任务、计价键与默认模型引用，改它风险高；
              * 别名让运营在不改 `id` 的前提下提供额外可请求的名字。
              * 这里即时校验冲突，避免保存后「同一个名字解析到两个模型」。
              */}
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3" data-testid={`model-alias-editor-${model.id}`}>
              <p className="text-xs font-semibold text-foreground">3 · 请求别名<span className="ml-2 font-normal text-muted-foreground">客户端用别名或标识请求都会解析到该模型；计费与日志仍记在标识上</span></p>
              <div className="flex flex-wrap items-center gap-2">
                <AdminInput
                  aria-label={`${model.id} 别名`}
                  data-testid={`model-alias-input-${model.id}`}
                  className="w-full sm:w-72"
                  value={aliasDraft[model.id] ?? ''}
                  placeholder="多个别名用逗号分隔，例如：oaooao-image, image-latest"
                  onChange={(event) => setAliasDraft((current) => ({ ...current, [model.id]: event.target.value }))}
                />
                <ControlButton
                  variant="secondary" size="sm"
                  data-testid={`model-alias-apply-${model.id}`}
                  onClick={() => applyAliasDraft(model.id)}
                >保存别名</ControlButton>
                <ControlButton
                  variant="ghost" size="sm"
                  data-testid={`model-alias-clear-${model.id}`}
                  disabled={!(model.aliases ?? []).length}
                  onClick={() => { setAliasDraft((current) => ({ ...current, [model.id]: '' })); patchModel(model.id, { aliases: [] }) }}
                >清空别名</ControlButton>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" data-testid={`model-alias-list-${model.id}`}>
                <span className="text-[11px] text-muted-foreground">可请求名字：</span>
                {requestNamesOf(model).map((name) => (
                  <span key={name} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{name}</span>
                ))}
              </div>
              {aliasError[model.id] && <p className="text-[11px] text-destructive" role="alert" data-testid={`model-alias-error-${model.id}`}>{aliasError[model.id]}</p>}
              <p className="text-[11px] leading-5 text-muted-foreground">
                别名不能与任何逻辑模型的标识或别名重复（否则同一个名字会解析到两个模型）。
              </p>
            </div>
            <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <p className="text-xs font-semibold text-foreground sm:col-span-2">4 · 用户显示信息<span className="ml-2 font-normal text-muted-foreground">只影响界面展示，不参与请求路由</span></p>
              <AdminField label="显示名称" hint="只影响界面展示，不能用于请求"><AdminInput aria-label={`${model.id} 显示名称`} value={model.name} onChange={(event) => patchModel(model.id, { name: event.target.value })} /></AdminField>
              <AdminField label="默认模型图标" hint="可搜索 LobeHub 图标并单选，也可以粘贴站内路径或 HTTPS 地址；渠道绑定可单独覆盖"><LobeIconPicker value={model.iconUrl} aria-label={`${model.id} 默认模型图标`} onChange={(value) => patchModel(model.id, { iconUrl: value })} /></AdminField>
            </div>
            <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <p className="text-xs font-semibold text-foreground sm:col-span-2">5 · 价格<span className="ml-2 font-normal text-muted-foreground">各渠道单价在上方绑定中设置；此处是未设置渠道单价时的默认单次积分</span></p>
              <AdminField label="单次积分" hint="0 表示按倍率与上游价格计算"><AdminInput aria-label={`${model.id} 单次积分`} type="number" min="0" step="1" value={costs[model.id] ?? 0} onChange={(event) => setCosts((current) => ({ ...current, [model.id]: Number(event.target.value) || 0 }))} /></AdminField>
            </div>
              </AdminSectionCard>
            </div>
          </details>
        )) : null}

        {!filteredModels.length && <AdminEmpty title="没有匹配的逻辑模型" description="调整搜索关键字、能力筛选或“仅看启用”条件后继续。" />}
        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
      </div>
    </AdminDrawer>
  )
}

type BindingCapabilityProfile = Record<string, unknown>

function profileList(profile: BindingCapabilityProfile | undefined, key: string, fallback: readonly string[], legacyKey?: string) {
  const value = profile?.[key]
  if (Array.isArray(value) && value.every((item) => typeof item === 'string') && value.length) return value as string[]
  if (legacyKey) {
    const legacy = profile?.[legacyKey]
    if (Array.isArray(legacy) && legacy.every((item) => typeof item === 'string') && legacy.length) return legacy as string[]
  }
  return [...fallback]
}

function ImageBindingCapabilityEditor({ profile, onChange, onReset }: { profile?: BindingCapabilityProfile; onChange: (patch: BindingCapabilityProfile) => void; onReset: () => void }) {
  const ratios = profileList(profile, 'aspectRatios', imageProfileRatios.map(([value]) => value))
  const resolutions = profileList(profile, 'outputResolutions', imageProfileResolutions.map(([value]) => value), 'resolutions')
  const qualities = profileList(profile, 'imageQualities', imageProfileQualities.map(([value]) => value), 'qualities')

  const toggle = (key: string, current: string[], value: string) => {
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    onChange({ [key]: next })
  }

  return (
    <div className="basis-full rounded-md border border-border/80 bg-muted/20 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">图片能力</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">控制这个渠道入口可提供的画幅、清晰度和图片质量；未配置时使用默认值。</p>
        </div>
        <div className="flex items-center gap-1.5">
          <ControlButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ aspectRatios: imageProfileRatios.map(([value]) => value) })}
          >GPT 八比例</ControlButton>
          <ControlButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
          >恢复默认</ControlButton>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <CapabilityOptionGroup
          title="支持画幅"
          options={imageProfileRatios}
          selected={ratios}
          onToggle={(value) => toggle('aspectRatios', ratios, value)}
        />
        <CapabilityOptionGroup
          title="支持清晰度"
          options={imageProfileResolutions}
          selected={resolutions}
          onToggle={(value) => toggle('outputResolutions', resolutions, value)}
        />
        <CapabilityOptionGroup
          title="支持图片质量"
          options={imageProfileQualities}
          selected={qualities}
          onToggle={(value) => toggle('imageQualities', qualities, value)}
        />
      </div>
    </div>
  )
}

function CapabilityOptionGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string
  options: readonly (readonly [string, string])[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[11px] font-medium text-muted-foreground">{title}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([value, label]) => {
          const checked = selected.includes(value)
          return (
            <label key={value} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors', checked ? 'border-studio-accent/60 bg-studio-accent/10 text-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted')}>
              <input type="checkbox" className="size-3 accent-studio-accent" checked={checked} onChange={() => onToggle(value)} />
              <span>{label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function normalizeCapabilities(channel?: SystemChannel): Record<string, Capability> {
  const source = channel?.advancedConfig?.modelCapabilities || {}
  const result: Record<string, Capability> = {}
  for (const model of channel?.models ?? []) {
    const value = source[model]
    result[model] = value === 'image' || value === 'video' || value === 'audio' || value === 'text' ? value : 'text'
  }
  return result
}
