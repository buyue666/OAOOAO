'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, CheckCircle2, LoaderCircle, Pencil, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react'
import {
  createAdminUser,
  getAdminSettings,
  listAdminUsers,
  listUserGenerationTasks,
  listUserOrders,
  updateAdminUser,
} from '@/lib/studio/admin-api'
import { ADMIN_PERMISSIONS, type AdminPermission, type AdminUser, type AdminUserListPayload, type AdminUserUpdateInput, type AdminUserSummary, type BillingOrder, type AdminGenerationTask } from '@/lib/studio/admin-types'
import type { Paged } from '@/lib/studio/admin-api'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminCell,
  AdminDefinition,
  AdminDrawer,
  AdminEmpty,
  AdminError,
  AdminField,
  AdminInput,
  AdminNotice,
  AdminPagination,
  AdminRow,
  AdminSearch,
  AdminSectionCard,
  AdminSelect,
  AdminStat,
  AdminTable,
  TableMessageRow,
  formatAdminDate,
  formatAdminMoney,
  formatAdminNumber,
  labelOf,
  orderStatusLabels,
  statusTone,
  taskStatusLabels,
  useConfirm,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

const emptySummary: AdminUserSummary = { total: 0, active: 0, disabled: 0, admins: 0, activeAdmins: 0, usersWithPlan: 0, totalPointsBalance: 0 }

export function AdminUsersPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const canManage = session.can('users.manage')
  const canGrant = session.can('administrators.manage')

  const [data, setData] = useState<AdminUserListPayload>({ users: [], total: 0, page: 1, pageSize: 20, summary: emptySummary })
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState<AdminUser | null>(null)
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true); setError('')
    listAdminUsers({ page, pageSize: 20, keyword: query, role, status })
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : '用户加载失败'))
      .finally(() => setLoading(false))
  }, [page, query, role, status, reloadKey])

  useEffect(() => { void load() }, [load])

  const toggleStatus = useCallback((user: AdminUser) => {
    const disabling = user.status !== 'disabled'
    confirm.confirm({
      title: disabling ? `禁用用户 ${user.username}？` : `启用用户 ${user.username}？`,
      description: disabling ? '禁用后该用户将无法登录，也不会继续消耗积分。' : '启用后该用户可以重新登录并使用现有积分。',
      confirmLabel: disabling ? '确认禁用' : '确认启用',
      tone: disabling ? 'danger' : 'default',
      onConfirm: async () => {
        await updateAdminUser(user.id, { status: disabling ? 'disabled' : 'active' })
        setMessage(disabling ? '用户已禁用' : '用户已启用')
        if (detail?.id === user.id) setDetail({ ...detail, status: disabling ? 'disabled' : 'active' })
        load()
      },
    })
  }, [confirm, detail, load])

  const items = data.users
  const summary = data.summary ?? emptySummary

  return (
    <div className="flex flex-col gap-5">
      {confirm.dialog}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStat label="账户总数" value={formatAdminNumber(summary.total)} detail={`正常 ${formatAdminNumber(summary.active)} · 禁用 ${formatAdminNumber(summary.disabled)}`} />
        <AdminStat label="管理员" value={formatAdminNumber(summary.admins)} detail={`其中启用 ${formatAdminNumber(summary.activeAdmins)}`} tone="warning" />
        <AdminStat label="持有套餐" value={formatAdminNumber(summary.usersWithPlan)} detail="已激活订阅套餐的用户" tone="success" />
        <AdminStat label="积分总量" value={formatAdminNumber(summary.totalPointsBalance)} detail="所有账户积分余额合计" />
      </div>

      <AdminSectionCard
        title="用户账户"
        description="支持用户名、昵称、邮箱关键字搜索，并按角色和状态筛选。"
        action={canManage ? <ControlButton variant="primary" size="sm" onClick={() => setEditing('new')}><UserPlus className="size-3.5" />新增用户</ControlButton> : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <AdminSearch value={keyword} onChange={setKeyword} placeholder="搜索用户名、昵称或邮箱" onSubmit={() => { setPage(1); setQuery(keyword) }} />
          <AdminSelect aria-label="筛选角色" value={role} onChange={(event) => { setPage(1); setRole(event.target.value) }} className="w-32">
            <option value="">全部角色</option><option value="admin">管理员</option><option value="user">普通用户</option>
          </AdminSelect>
          <AdminSelect aria-label="筛选状态" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }} className="w-32">
            <option value="">全部状态</option><option value="active">正常</option><option value="disabled">已禁用</option>
          </AdminSelect>
          <ControlButton variant="secondary" size="sm" onClick={load} disabled={loading} title="刷新用户列表"><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} /></ControlButton>
        </div>

        {error && <div className="mt-3"><AdminError message={error} retry={load} /></div>}
        {message && <div className="mt-3"><AdminNotice tone="success">{message}</AdminNotice></div>}

        <div className="mt-4">
          <AdminTable columns={['账户', '角色与职责', '状态', '套餐', '积分', '最近登录', '操作']} minWidth={1020} caption="用户账户列表">
            {items.map((user) => (
              <AdminRow key={user.id}>
                <AdminCell className="max-w-[260px]">
                  <p className="truncate font-medium">{user.displayName || user.username}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{user.email || user.username}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">#{user.accountId || user.id.slice(0, 8)}</p>
                </AdminCell>
                <AdminCell className="max-w-[280px]">
                  {user.role === 'admin'
                    ? <div className="flex flex-col gap-1.5"><StatusBadge tone="accent">管理员</StatusBadge><span className="text-[11px] text-muted-foreground">{(user.adminPermissions || []).length} 项职责</span></div>
                    : <span className="text-xs text-muted-foreground">普通用户</span>}
                </AdminCell>
                <AdminCell><StatusBadge tone={statusTone(user.status)}>{user.status === 'disabled' ? '已禁用' : '正常'}</StatusBadge></AdminCell>
                <AdminCell className="text-xs">{user.planName || user.planId || '免费用户'}</AdminCell>
                <AdminCell>
                  <p className="font-medium">{formatAdminNumber(user.pointsBalance)}</p>
                  {Boolean(user.dailyPointsBalance) && <p className="mt-1 text-[11px] text-muted-foreground">含每日 {formatAdminNumber(user.dailyPointsBalance)}</p>}
                </AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(user.lastLoginAt)}</AdminCell>
                <AdminCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ControlButton variant="secondary" size="sm" onClick={() => setDetail(user)}>详情</ControlButton>
                    {canManage && <ControlButton variant="secondary" size="sm" onClick={() => setEditing(user)} aria-label={`编辑 ${user.username}`}><Pencil className="size-3.5" /></ControlButton>}
                    {canManage && (
                      <ControlButton variant={user.status === 'disabled' ? 'secondary' : 'danger'} size="sm" disabled={user.id === session.user?.id} onClick={() => toggleStatus(user)}>
                        {user.status === 'disabled' ? <><CheckCircle2 className="size-3.5" />启用</> : <><Ban className="size-3.5" />禁用</>}
                      </ControlButton>
                    )}
                  </div>
                </AdminCell>
              </AdminRow>
            ))}
            {!items.length && <TableMessageRow colSpan={7} loading={loading} error={error} empty="没有匹配的用户" />}
          </AdminTable>
        </div>

        <div className="mt-4"><AdminPagination page={page} pageSize={20} total={data.total} loading={loading} onChange={setPage} /></div>
      </AdminSectionCard>

      {detail && <UserDetailDrawer user={detail} canManage={canManage} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null) }} />}
      {editing && <UserEditor user={editing === 'new' ? undefined : editing} canGrant={canGrant} onClose={() => setEditing(null)} onSaved={(text) => { setMessage(text); setEditing(null); load() }} />}
    </div>
  )
}

function UserDetailDrawer({ user, canManage, onClose, onEdit }: { user: AdminUser; canManage: boolean; onClose: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<'profile' | 'calls' | 'orders'>('profile')
  const [taskPage, setTaskPage] = useState(1)
  const [orderPage, setOrderPage] = useState(1)
  const [tasks, setTasks] = useState<Paged<AdminGenerationTask> | null>(null)
  const [orders, setOrders] = useState<Paged<BillingOrder> | null>(null)
  const [tasksLoading, setTasksLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [tasksError, setTasksError] = useState('')
  const [ordersError, setOrdersError] = useState('')

  /** 调用记录与订单记录分别按页向后端请求，失败时保留错误并提供重试。 */
  const loadTasks = useCallback(() => {
    setTasksLoading(true); setTasksError('')
    listUserGenerationTasks(user.id, taskPage, 10)
      .then(setTasks)
      .catch((reason) => setTasksError(reason instanceof Error ? reason.message : '用户调用记录加载失败'))
      .finally(() => setTasksLoading(false))
  }, [taskPage, user.id])

  const loadOrders = useCallback(() => {
    setOrdersLoading(true); setOrdersError('')
    listUserOrders(user.id, orderPage, 10)
      .then(setOrders)
      .catch((reason) => setOrdersError(reason instanceof Error ? reason.message : '用户订单记录加载失败'))
      .finally(() => setOrdersLoading(false))
  }, [orderPage, user.id])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => { loadOrders() }, [loadOrders])

  const permissions = useMemo(() => ADMIN_PERMISSIONS.filter((item) => (user.adminPermissions || []).includes(item.id)), [user.adminPermissions])

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title={user.displayName || user.username}
      description={`账户 #${user.accountId || user.id} · ${user.email || '未填写邮箱'}`}
      footer={canManage ? <ControlButton variant="primary" onClick={onEdit}><Pencil className="size-3.5" />编辑账户</ControlButton> : undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {([['profile', '资料与权限'], ['calls', `调用记录${tasks ? ` (${tasks.total})` : ''}`], ['orders', `订单消费${orders ? ` (${orders.total})` : ''}`]] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${tab === value ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}>{label}</button>
          ))}
        </div>

        {tab === 'profile' && (
          <>
            <AdminSectionCard title="账户资料" className="p-4">
              <AdminDefinition label="用户名" value={user.username} />
              <AdminDefinition label="昵称" value={user.displayName} />
              <AdminDefinition label="邮箱" value={user.email} />
              <AdminDefinition label="角色" value={user.role === 'admin' ? '管理员' : '普通用户'} />
              <AdminDefinition label="状态" value={<StatusBadge tone={statusTone(user.status)}>{user.status === 'disabled' ? '已禁用' : '正常'}</StatusBadge>} />
              <AdminDefinition label="套餐" value={user.planName || user.planId || '免费用户'} />
              <AdminDefinition label="积分余额" value={formatAdminNumber(user.pointsBalance)} />
              <AdminDefinition label="其中每日积分" value={formatAdminNumber(user.dailyPointsBalance)} />
              <AdminDefinition label="注册时间" value={formatAdminDate(user.createdAt)} />
              <AdminDefinition label="最近登录" value={formatAdminDate(user.lastLoginAt)} />
              <AdminDefinition label="两步验证" value={user.mfaEnabled ? '已开启' : '未开启'} />
            </AdminSectionCard>
            <AdminSectionCard title="管理员职责" description={user.role === 'admin' ? '该账号可以访问的后台模块由以下职责决定。' : '普通用户没有后台职责。'} className="p-4">
              {permissions.length ? (
                <ul className="flex flex-col gap-2">
                  {permissions.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 text-xs"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span><span className="font-medium">{item.label}</span><span className="text-muted-foreground"> · {item.description}</span></span></li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground">{user.role === 'admin' ? '该管理员尚未分配任何职责。' : '—'}</p>}
            </AdminSectionCard>
          </>
        )}

        {tab === 'calls' && (
          <AdminSectionCard
            title="调用记录"
            description="按页读取该用户的生成任务，包含状态、耗时与积分消耗。"
            action={<ControlButton variant="secondary" size="sm" onClick={loadTasks} disabled={tasksLoading}><RefreshCw className={tasksLoading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>}
            className="p-4"
          >
            {tasksError && <div className="mb-3"><AdminError message={tasksError} retry={loadTasks} /></div>}
            {tasksLoading && !tasks ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><LoaderCircle className="size-3.5 animate-spin" />正在加载调用记录</p>
            ) : tasks?.items.length ? (
              <>
                <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="text-muted-foreground"><tr>{['类型', '模型', '状态', '耗时', '积分', '时间'].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead><tbody>
                  {tasks.items.map((task) => <tr key={task.id} className="border-t border-border"><td className="py-2 pr-3">{labelOf({ agent: '导演 Agent', image: '图片', video: '视频', audio: '音频', text: '文本' }, task.type)}</td><td className="max-w-[140px] truncate py-2 pr-3">{task.model || '-'}</td><td className="py-2 pr-3"><StatusBadge tone={statusTone(task.status)}>{labelOf(taskStatusLabels, task.status)}</StatusBadge>{task.error && <p className="mt-1 max-w-40 truncate text-destructive" title={task.error}>{task.error}</p>}</td><td className="py-2 pr-3">{task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : '-'}</td><td className="py-2 pr-3">{formatAdminNumber(task.pointsCost)}</td><td className="py-2 pr-3 text-muted-foreground">{formatAdminDate(task.createdAt)}</td></tr>)}
                </tbody></table></div>
                <div className="mt-3"><AdminPagination page={taskPage} pageSize={10} total={tasks.total} loading={tasksLoading} onChange={setTaskPage} /></div>
              </>
            ) : <AdminEmpty title="暂无调用记录" description="该用户还没有产生生成请求。" />}
          </AdminSectionCard>
        )}

        {tab === 'orders' && (
          <AdminSectionCard
            title="订单与消费"
            description="按页读取该用户的订单，含支付与退款状态。"
            action={<ControlButton variant="secondary" size="sm" onClick={loadOrders} disabled={ordersLoading}><RefreshCw className={ordersLoading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>}
            className="p-4"
          >
            {ordersError && <div className="mb-3"><AdminError message={ordersError} retry={loadOrders} /></div>}
            {ordersLoading && !orders ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><LoaderCircle className="size-3.5 animate-spin" />正在加载订单</p>
            ) : orders?.items.length ? (
              <>
                <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="text-muted-foreground"><tr>{['订单号', '商品', '金额', '状态', '时间'].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead><tbody>
                  {orders.items.map((order) => <tr key={order.id} className="border-t border-border"><td className="py-2 pr-3 font-mono">{order.orderNo}</td><td className="max-w-[160px] truncate py-2 pr-3">{order.subject}</td><td className="py-2 pr-3">{formatAdminMoney(order.amountCents, order.currency)}</td><td className="py-2 pr-3"><StatusBadge tone={statusTone(order.status)}>{labelOf(orderStatusLabels, order.status)}</StatusBadge></td><td className="py-2 pr-3 text-muted-foreground">{formatAdminDate(order.createdAt)}</td></tr>)}
                </tbody></table></div>
                <div className="mt-3"><AdminPagination page={orderPage} pageSize={10} total={orders.total} loading={ordersLoading} onChange={setOrderPage} /></div>
              </>
            ) : <AdminEmpty title="暂无订单" description="该用户还没有产生订单记录。" />}
          </AdminSectionCard>
        )}
      </div>
    </AdminDrawer>
  )
}

function UserEditor({ user, canGrant, onClose, onSaved }: { user?: AdminUser; canGrant: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [role, setRole] = useState<'admin' | 'user'>(user?.role === 'admin' ? 'admin' : 'user')
  const [permissions, setPermissions] = useState<AdminPermission[]>((user?.adminPermissions ?? []) as AdminPermission[])
  const [plans, setPlans] = useState<Array<{ id: string; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isNew = !user

  // 套餐下拉来自系统设置中的真实权益方案，避免手写无效标识。
  useEffect(() => {
    let active = true
    getAdminSettings()
      .then((settings) => { if (active) setPlans(settings.entitlements.plans.map((plan) => ({ id: plan.id, name: plan.name || plan.id }))) })
      .catch(() => { if (active) setPlans([]) })
    return () => { active = false }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    const value = (key: string) => String(data.get(key) ?? '').trim()
    try {
      const pointsText = value('pointsBalance')
      const patch: AdminUserUpdateInput = {
        displayName: value('displayName'),
        email: value('email'),
        status: data.get('status') === 'disabled' ? 'disabled' : 'active',
        role,
        planId: value('planId') || undefined,
      }
      if (pointsText) {
        const points = Number(pointsText)
        if (!Number.isFinite(points) || points < 0) throw new Error('积分余额必须是不小于 0 的数字')
        patch.pointsBalance = points
      }
      const password = value('password')
      if (password) patch.password = password
      if (role === 'admin') patch.adminPermissions = permissions
      if (isNew) {
        patch.username = value('username')
        if (!patch.username) throw new Error('请填写用户名')
        if (!password) throw new Error('新增用户需要设置初始密码')
        await createAdminUser(patch as AdminUserUpdateInput & { username: string })
        onSaved('用户已创建')
      } else {
        await updateAdminUser(user.id, patch)
        onSaved('用户资料已保存')
      }
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
      title={isNew ? '新增用户' : `编辑 ${user?.username ?? ''}`}
      description="修改账户资料、状态、积分与套餐。密码与积分变更都会写入审计日志。"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          {isNew && <AdminField label="用户名" hint="登录账号，创建后不可修改。"><AdminInput name="username" required maxLength={40} autoComplete="off" /></AdminField>}
          {isNew && <AdminField label="初始密码" hint="至少 8 位，仅本次提交，后台不会回显。"><AdminInput name="password" type="password" required minLength={8} autoComplete="new-password" /></AdminField>}
          <AdminField label="昵称"><AdminInput name="displayName" defaultValue={user?.displayName} maxLength={40} /></AdminField>
          <AdminField label="邮箱"><AdminInput name="email" type="email" defaultValue={user?.email} maxLength={120} /></AdminField>
          <AdminField label="账户状态">
            <AdminSelect name="status" defaultValue={user?.status === 'disabled' ? 'disabled' : 'active'}><option value="active">正常</option><option value="disabled">已禁用</option></AdminSelect>
          </AdminField>
          <AdminField label="积分余额" hint="直接设为该数值，不是增量。"><AdminInput name="pointsBalance" type="number" min="0" step="1" placeholder={user ? String(user.pointsBalance) : '0'} /></AdminField>
          <AdminField label="套餐" hint="套餐决定每日积分与调用上限；方案在系统设置中维护。">
            <AdminSelect name="planId" defaultValue={user?.planId || 'free'}>
              {!plans.some((plan) => plan.id === (user?.planId || 'free')) && user?.planId && <option value={user.planId}>{user.planName || user.planId}</option>}
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </AdminSelect>
          </AdminField>
          <AdminField label="重置密码" hint="留空表示不修改密码。"><AdminInput name="password" type="password" minLength={8} autoComplete="new-password" placeholder="不修改请留空" /></AdminField>
          {!isNew && <AdminField label="角色">
            <AdminSelect value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'user')} disabled={!canGrant}>
              <option value="user">普通用户</option><option value="admin">管理员</option>
            </AdminSelect>
          </AdminField>}
        </fieldset>

        {isNew && <AdminField label="角色">
          <AdminSelect value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'user')} disabled={!canGrant}>
            <option value="user">普通用户</option><option value="admin">管理员</option>
          </AdminSelect>
        </AdminField>}

        {role === 'admin' && (
          <AdminSectionCard title="管理员职责" description={canGrant ? '至少勾选一项，后台菜单会按职责显示。' : '只有拥有“管理员管理”职责的账号可以修改分配。'} className="p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {ADMIN_PERMISSIONS.map((item) => {
                const checked = permissions.includes(item.id)
                return (
                  <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={busy || !canGrant}
                      onChange={() => setPermissions((current) => checked ? current.filter((value) => value !== item.id) : [...current, item.id])}
                    />
                    <span className="min-w-0"><span className="font-medium">{item.label}</span><span className="mt-0.5 block text-muted-foreground">{item.description}</span></span>
                  </label>
                )
              })}
            </div>
          </AdminSectionCard>
        )}

        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
          <ControlButton type="submit" variant="primary" disabled={busy}>{busy ? '保存中' : '保存账户'}</ControlButton>
        </div>
      </form>
    </AdminDrawer>
  )
}
