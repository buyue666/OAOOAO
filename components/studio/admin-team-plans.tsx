'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Pencil, Plus } from 'lucide-react'
import { request } from '@/lib/studio/api'
import { TeamPlanCard } from '@/components/membership/team-plan-card'
import membershipStyles from '@/components/membership/membership.module.css'
import { PlanTonePicker } from './plan-tone-picker'
import type { AdminSettings } from '@/lib/studio/admin-types'
import { PlanModelControl } from './plan-model-control'
import { newClientRequestId } from '@/lib/studio/generation-api'
import { teamPlanPriceCents, teamPlanStorageBytes } from '@/lib/studio/team-admin'
import { teamSubmissionUncertain } from '@/lib/studio/team-generation'
import { formatTeamBytes, teamNumber, type TeamPlan, type TeamSummary } from '@/lib/studio/team-types'
import { ControlButton, StatusBadge } from './ui'
import { useAdminReload, useAdminSession } from './admin-shell'
import { AdminCell, AdminDataPanel, AdminDrawer, AdminError, AdminField, AdminInput, AdminNotice, AdminPagination, AdminRow, AdminSearch, AdminSelect, AdminTable, AdminTabs, AdminTextarea, TableMessageRow, formatAdminDate, formatAdminMoney } from './admin-kit'

function useTeamAdminQuery<T>(path: string | null) {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const query = useSWR<T>(path && session.user ? ['admin-team', session.user.id, path] : null, ([, , url]: string[]) => request<T>(url), { shouldRetryOnError: false, keepPreviousData: false })
  useEffect(() => { if (reloadKey) void query.mutate() }, [reloadKey, query.mutate])
  return { ...query, data: query.error ? undefined : query.data }
}

export function AdminTeamPlansPanel() {
  const session = useAdminSession()
  const canPlans = session.can('commerce.manage'), canGrants = session.can('billing.manage')
  const [tab, setTab] = useState<'plans' | 'teams'>(canPlans ? 'plans' : 'teams')
  const selected = tab === 'plans' && !canPlans ? 'teams' : tab === 'teams' && !canGrants ? 'plans' : tab
  return <div className="flex flex-col gap-5">
    <AdminNotice>团队版当前使用人工开通。开通权益与发放积分会记录审计日志，不会创建已支付订单。</AdminNotice>
    <AdminTabs label="团队管理分区" value={selected} onChange={setTab} items={[...(canPlans ? [['plans', '套餐配置'] as const] : []), ...(canGrants ? [['teams', '团队与权益'] as const] : [])]} />
    {selected === 'plans' && canPlans && <TeamPlansAdmin />}
    {selected === 'teams' && canGrants && <TeamEntitlementsAdmin />}
  </div>
}

function TeamPlansAdmin() {
  const query = useTeamAdminQuery<{ plans: TeamPlan[] }>('/api/admin/team-plans')
  const [editing, setEditing] = useState<TeamPlan | null>(null)
  const [message, setMessage] = useState('')
  return <div className="flex flex-col gap-4">{query.error && <AdminError message={query.error.message} retry={() => void query.mutate()} />}{message && <AdminNotice tone="success">{message}</AdminNotice>}
    <AdminDataPanel title="团队套餐" description="发布前配置价格、席位、积分、容量、并发和模型范围。修改用于后续开通，已有团队本期权益保持开通时的配置。">
      <AdminTable columns={['套餐', '状态', '每席／30 天', '席位范围', '每席积分', '团队总容量', '操作']}>
        {query.data?.plans.map(plan => <AdminRow key={plan.id}><AdminCell><p className="font-medium">{plan.name}</p><p className="mt-1 max-w-72 whitespace-pre-wrap text-xs text-muted-foreground">{plan.description}</p></AdminCell><AdminCell><StatusBadge tone={plan.enabled ? 'success' : 'neutral'}>{plan.enabled ? '已发布' : '未发布'}</StatusBadge></AdminCell><AdminCell>{plan.priceCents === null ? '尚未定价' : formatAdminMoney(plan.priceCents)}</AdminCell><AdminCell>{plan.minSeats}–{plan.maxSeats} 人</AdminCell><AdminCell>{teamNumber(plan.pointsPerSeat)}</AdminCell><AdminCell>{formatTeamBytes(plan.storageBytes)}</AdminCell><AdminCell><ControlButton size="sm" onClick={() => setEditing(plan)}><Pencil className="size-3.5" />编辑套餐</ControlButton></AdminCell></AdminRow>)}
        {!query.data?.plans.length && <TableMessageRow colSpan={7} loading={query.isLoading} error={query.error?.message} empty="暂无团队套餐，请确认团队模块迁移已完成。" />}
      </AdminTable>
    </AdminDataPanel>
    {editing && <TeamPlanEditor key={editing.id} plan={editing} onClose={() => setEditing(null)} onSaved={() => { setMessage('团队套餐已保存。'); setEditing(null); void query.mutate() }} />}
  </div>
}

function TeamPlanEditor({ plan, onClose, onSaved }: { plan: TeamPlan; onClose: () => void; onSaved: () => void }) {
  const catalog = useTeamAdminQuery<{ settings: AdminSettings }>('/api/admin/settings')
  const [draft, setDraft] = useState(plan)
  const [restricted, setRestricted] = useState(plan.modelIds.length > 0)
  const [price, setPrice] = useState(plan.priceCents === null ? '' : (plan.priceCents / 100).toFixed(2))
  const [capacity, setCapacity] = useState(String(plan.storageBytes / 1024 ** 3))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const fields: Array<{ key: 'minSeats' | 'maxSeats' | 'reviewerLimit' | 'pointsPerSeat' | 'creditValidityDays' | 'teamConcurrency' | 'memberConcurrency' | 'taskLimit'; label: string; min: number; max: number; step?: string; group: 'price' | 'resources' }> = [
    { key: 'pointsPerSeat', label: '每席发放积分', min: 0, max: 100000000, step: '0.0001', group: 'price' }, { key: 'creditValidityDays', label: '积分有效天数', min: 1, max: 365, group: 'price' },
    { key: 'minSeats', label: '最低创作席位', min: 2, max: 100, group: 'resources' }, { key: 'maxSeats', label: '最多创作席位', min: draft.minSeats, max: 100, group: 'resources' }, { key: 'reviewerLimit', label: '团队审阅名额', min: 0, max: 500, group: 'resources' },
    { key: 'teamConcurrency', label: '团队并发任务数', min: 1, max: 100, group: 'resources' }, { key: 'memberConcurrency', label: '每位成员并发任务数', min: 1, max: draft.teamConcurrency, group: 'resources' }, { key: 'taskLimit', label: '单次任务积分上限', min: 0.0001, max: 100000000, step: '0.0001', group: 'resources' },
  ]
  const controls = (group: 'price' | 'resources') => fields.filter(field => field.group === group).map(field => <AdminField key={field.key} label={field.label}><AdminInput type="number" required min={field.min} max={field.max} step={field.step || '1'} value={draft[field.key]} onChange={event => setDraft({ ...draft, [field.key]: Number(event.target.value) })} /></AdminField>)
  let previewPrice: number | null = null, previewCapacity = draft.storageBytes
  try { previewPrice = teamPlanPriceCents(price) } catch {}
  try { previewCapacity = teamPlanStorageBytes(capacity) } catch {}
  const preview = { ...draft, priceCents: previewPrice, storageBytes: previewCapacity }
  return <AdminDrawer open width="sm:max-w-[1180px]" title={`编辑套餐 ${plan.name}`} description="配置团队权益与套餐展示，右侧同步预览。按创作席位计费，所有者占一个席位。" onClose={() => { if (!busy) onClose() }} footer={<><ControlButton variant="secondary" disabled={busy} onClick={onClose}>取消</ControlButton><ControlButton variant="primary" type="submit" form="admin-team-plan" disabled={busy}>{busy ? '正在保存…' : '保存套餐'}</ControlButton></>}>
    <form id="admin-team-plan" onSubmit={async event => {
      event.preventDefault(); if (lock.current) return
      if (restricted && !draft.modelIds.length) { setError('请至少选择一个模型，或切换为全部可用模型。'); return }
      lock.current = true; setBusy(true); setError('')
      try { const { id: _id, ...body } = draft; await request(`/api/admin/team-plans/${encodeURIComponent(plan.id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, modelIds: restricted ? draft.modelIds : [], priceCents: teamPlanPriceCents(price), storageBytes: teamPlanStorageBytes(capacity), display: { ...body.display, benefits: body.display?.benefits?.map(item => item.trim()).filter(Boolean) } }) }); onSaved() }
      catch (reason) { setError(reason instanceof Error ? reason.message : '套餐保存失败。') }
      finally { lock.current = false; setBusy(false) }
    }} className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
          <section className="space-y-4"><h3 className="text-sm font-semibold">套餐基础信息</h3><AdminField label="套餐名称"><AdminInput required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></AdminField><AdminField label="套餐说明"><AdminTextarea maxLength={2000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></AdminField><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />发布此套餐</label></section>
          <section className="space-y-4 border-t border-border pt-5"><h3 className="text-sm font-semibold">价格与积分</h3><div className="grid gap-4 sm:grid-cols-2"><AdminField label="每席价格（元／30 天）" hint="价格留空时不能发布。"><AdminInput type="number" min="0.01" max="1000000" step="0.01" value={price} onChange={event => setPrice(event.target.value)} required={draft.enabled} /></AdminField>{controls('price')}</div></section>
          <section className="space-y-4 border-t border-border pt-5"><h3 className="text-sm font-semibold">席位与创作资源</h3><div className="grid gap-4 sm:grid-cols-2">{controls('resources')}<AdminField label="团队总容量（GB）" hint="由全体成员共享，不按席位相乘。"><AdminInput type="number" min="0.000001" max="1048576" step="any" required value={capacity} onChange={event => setCapacity(event.target.value)} /></AdminField></div></section>
          {catalog.error && <AdminError message="模型目录读取失败，现有范围已保留。" retry={() => void catalog.mutate()} />}
          <PlanModelControl models={catalog.data?.settings.logicalModels || []} value={restricted ? draft.modelIds : undefined} disabled={busy || catalog.isLoading || !!catalog.error} onChange={modelIds => { setRestricted(modelIds !== undefined); setDraft({ ...draft, modelIds: modelIds || [] }) }} />
          <section className="space-y-4 border-t border-border pt-5"><div><h3 className="text-sm font-semibold">套餐页展示</h3><p className="mt-1 text-xs text-muted-foreground">与个人套餐使用同一套卡片配色和权益样式。</p></div><div className="grid gap-4 sm:grid-cols-2"><AdminField label="配色"><PlanTonePicker value={draft.display?.tone || 'standard'} onChange={tone => setDraft({ ...draft, display: { ...draft.display, tone: tone as NonNullable<TeamPlan['display']>['tone'] } })} /></AdminField><AdminField label="套餐角标" hint="留空时显示团队版。"><AdminInput maxLength={24} value={draft.display?.badge || ''} onChange={event => setDraft({ ...draft, display: { ...draft.display, badge: event.target.value } })} /></AdminField><AdminField label="补充展示权益（每行一项）" hint="仅补充展示文案，容量、席位、并发与模型权限仍以实际配置为准。" className="sm:col-span-2"><AdminTextarea rows={4} value={(draft.display?.benefits || []).join('\n')} onChange={event => setDraft({ ...draft, display: { ...draft.display, benefits: event.target.value.split('\n') } })} /></AdminField></div></section>
        </fieldset>
        <aside aria-label="团队套餐实时预览" className="min-w-0 rounded-xl border border-border bg-muted/20 p-4 xl:sticky xl:top-0"><div className="mb-3"><p className="text-sm font-semibold">套餐卡片预览</p><p className="mt-1 text-xs leading-5 text-muted-foreground">与用户页使用相同组件，可试算席位数量。</p></div><div className={`${membershipStyles.themeScope} ${membershipStyles.viewportScope} overflow-hidden rounded-[18px]`}><TeamPlanCard key={`${plan.id}:${draft.minSeats}:${draft.maxSeats}`} plan={preview} preview /></div></aside>
      </div>
      {error && <AdminError message={error} />}
    </form>
  </AdminDrawer>
}

function TeamEntitlementsAdmin() {
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const query = useTeamAdminQuery<{ teams: TeamSummary[]; total: number }>(`/api/admin/teams?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`)
  const [grant, setGrant] = useState<{ team: TeamSummary; type: 'subscription' | 'credits' } | null>(null)
  const [message, setMessage] = useState('')
  return <div className="flex flex-col gap-4">{query.error && <AdminError message={query.error.message} retry={() => void query.mutate()} />}{message && <AdminNotice tone="success">{message}</AdminNotice>}
    <AdminDataPanel title="团队与权益" description="人工开通一周期权益，或单独发放团队积分。有效期内暂不支持重新开通、加席补差价或自动续费。" filters={<AdminSearch value={keyword} onChange={value => { setKeyword(value); setPage(1) }} placeholder="搜索团队名称或所有者账号" />} footer={<AdminPagination page={page} pageSize={20} total={query.data?.total ?? 0} loading={query.isLoading} onChange={setPage} />}>
      <AdminTable columns={['团队', '创作席位', '套餐', '权益有效期', '操作']}>
        {query.data?.teams.map(team => { const active = !!team.subscriptionExpiresAt && Date.parse(team.subscriptionExpiresAt) > Date.now(); return <AdminRow key={team.id}><AdminCell><p className="font-medium">{team.name}</p></AdminCell><AdminCell>{team.occupiedSeats} / {team.seatLimit}<p className="mt-1 text-xs text-muted-foreground">待加入 {team.reservedSeats}</p></AdminCell><AdminCell>{team.planName || '尚未开通'}</AdminCell><AdminCell>{team.subscriptionExpiresAt ? formatAdminDate(team.subscriptionExpiresAt) : '尚未开通'}</AdminCell><AdminCell><div className="flex flex-wrap gap-2"><ControlButton size="sm" disabled={active} title={active ? '本期权益尚未到期，暂不支持重复开通。' : '人工开通 30 天团队权益'} onClick={() => setGrant({ team, type: 'subscription' })}>开通权益</ControlButton><ControlButton size="sm" onClick={() => setGrant({ team, type: 'credits' })}><Plus className="size-3.5" />发放积分</ControlButton></div></AdminCell></AdminRow> })}
        {!query.data?.teams.length && <TableMessageRow colSpan={5} loading={query.isLoading} error={query.error?.message} empty="暂无匹配团队。" />}
      </AdminTable>
    </AdminDataPanel>
    {grant && <TeamGrantEditor key={`${grant.team.id}:${grant.type}`} {...grant} onClose={() => setGrant(null)} onSaved={() => { setMessage(grant.type === 'subscription' ? '团队权益已开通。' : '团队积分已发放。'); setGrant(null); void query.mutate() }} />}
  </div>
}

function TeamGrantEditor({ team, type, onClose, onSaved }: { team: TeamSummary; type: 'subscription' | 'credits'; onClose: () => void; onSaved: () => void }) {
  const plans = useTeamAdminQuery<{ plans: TeamPlan[] }>(type === 'subscription' ? '/api/team-plans' : null)
  const [planId, setPlanId] = useState('')
  const [seats, setSeats] = useState(Math.max(2, team.occupiedSeats + team.reservedSeats))
  const [amount, setAmount] = useState('')
  const [expires, setExpires] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [operationId] = useState(() => newClientRequestId('team-admin'))
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const plan = plans.data?.plans.find(item => item.id === planId)
  return <AdminDrawer open title={`${type === 'subscription' ? '开通团队权益' : '发放团队积分'} · ${team.name}`} description="请核对目标团队并填写依据。此次操作不代表收到支付款。" onClose={() => { if (!busy && !uncertain) onClose() }} footer={<><ControlButton variant="secondary" disabled={busy || uncertain} onClick={onClose}>取消</ControlButton><ControlButton variant="primary" type="submit" form="admin-team-grant" disabled={busy || (!uncertain && type === 'subscription' && (!plan?.enabled || !!plans.error))}>{busy ? '正在提交…' : uncertain ? '重试确认结果' : '确认执行'}</ControlButton></>}>
    <form id="admin-team-grant" className="flex flex-col gap-5" onSubmit={async event => {
      event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError('')
      try { const body = type === 'subscription' ? { operationId, planId, seats, reason, confirmManualGrant: confirmed } : { operationId, amount, reason, expiresAt: expires ? new Date(expires).toISOString() : null }; await request(`/api/admin/teams/${team.id}/${type}`, { method: 'POST', body: JSON.stringify(body) }); setUncertain(false); onSaved() }
      catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成。'); setUncertain(teamSubmissionUncertain(failure)) }
      finally { lock.current = false; setBusy(false) }
    }}><fieldset disabled={busy || uncertain} className="flex flex-col gap-5">
      {type === 'subscription' ? <><AdminField label="团队套餐"><AdminSelect required value={planId} onChange={event => setPlanId(event.target.value)}><option value="">选择已发布套餐</option>{plans.data?.plans.filter(item => item.enabled).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</AdminSelect></AdminField><AdminField label="创作席位数" hint="包含所有者和待接受邀请占用的席位。"><AdminInput type="number" required min={Math.max(plan?.minSeats || 2, team.occupiedSeats + team.reservedSeats)} max={plan?.maxSeats || 100} value={seats} onChange={event => setSeats(Number(event.target.value))} /></AdminField>{plan && <AdminNotice>开通 30 天 · 发放 {teamNumber(plan.pointsPerSeat * seats)} 积分（有效 {plan.creditValidityDays} 天） · 团队总容量 {formatTeamBytes(plan.storageBytes)}</AdminNotice>}<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="size-4 accent-primary" />确认这是人工开通，已核实开通依据</label></> : <><AdminField label="发放积分"><AdminInput type="number" required min="0.0001" max="100000000" step="0.0001" value={amount} onChange={event => setAmount(event.target.value)} /></AdminField><AdminField label="积分到期时间" hint="留空表示永久有效。"><AdminInput type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} /></AdminField></>}
      <AdminField label={type === 'subscription' ? '开通依据' : '发放依据'} hint="至少填写 5 个字，保存到审计记录。"><AdminTextarea required minLength={5} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></AdminField>
    </fieldset>{uncertain && <AdminNotice tone="warning">提交结果尚未确认，请沿用原操作重试确认，避免重复发放。</AdminNotice>}{(error || plans.error) && <AdminError message={error || plans.error.message} />}</form>
  </AdminDrawer>
}
