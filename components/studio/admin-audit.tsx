'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { listAuditLogs } from '@/lib/studio/admin-api'
import type { AuditFilters, AuditLog } from '@/lib/studio/admin-types'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminCell,
  AdminDefinition,
  AdminDrawer,
  AdminError,
  AdminField,
  AdminInput,
  AdminLoading,
  AdminNotice,
  AdminPagination,
  AdminRow,
  AdminSectionCard,
  AdminSelect,
  AdminStat,
  AdminTable,
  TableMessageRow,
  formatAdminDate,
  formatAdminNumber,
  statusTone,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

const actionLabels: Record<string, string> = {
  'auth.login': '管理员登录',
  'auth.logout': '退出登录',
  'admin.user.create': '新增用户',
  'admin.user.update': '修改用户',
  'admin.user.delete': '删除用户',
  'admin.settings.update': '修改系统设置',
  'admin.settings.channel_api_key.view': '查看渠道密钥',
  'admin.billing.product.upsert': '保存商品',
  'admin.billing.promotion.save': '保存促销活动',
  'admin.billing.order.refund': '订单退款',
  'admin.billing.order.close': '关闭订单',
  'admin.billing.order.complete': '标记订单已支付',
  'admin.work.approve': '通过作品审核',
  'admin.work.reject': '驳回作品',
  'admin.work.take-down': '下架作品',
  'admin.work.delete': '删除作品',
  'admin.work-governance.resolve': '处理治理案件',
  'admin.object-storage.update': '修改对象存储',
  'admin.referrals.program.update': '修改邀请奖励',
}

const targetTypeLabels: Record<string, string> = {
  user: '用户', settings: '系统设置', 'system-model-channel': '上游渠道', billing_product: '商品', billing_order: '订单',
  promotion_campaign: '促销活动', published_work: '公开作品', published_work_case: '治理案件', object_storage: '对象存储', referral_program: '邀请奖励',
}

const sensitiveKeys = ['password', 'token', 'cookie', 'apikey', 'api_key', 'secret', 'authorization', 'webhooksecret', 'accesskeyid', 'secretaccesskey']

const presetActions = [
  '', 'auth.login', 'admin.user.create', 'admin.user.update', 'admin.user.delete', 'admin.settings.update', 'admin.billing.order.refund',
  'admin.billing.product.upsert', 'admin.work.approve', 'admin.work.reject', 'admin.work.take-down', 'admin.object-storage.update',
]

export function AdminAuditPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  void session

  const [data, setData] = useState<{ items: AuditLog[]; total: number }>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<AuditLog | null>(null)

  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [status, setStatus] = useState('')
  const [targetType, setTargetType] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const filters = useMemo<AuditFilters>(() => ({ page, pageSize: 20, keyword: query, action, status, targetType, start, end }), [action, end, page, query, start, status, targetType])

  const load = useCallback(() => {
    setLoading(true); setError('')
    listAuditLogs(filters).then((result) => setData({ items: result.items, total: result.total })).catch((reason) => setError(reason instanceof Error ? reason.message : '审计日志加载失败')).finally(() => setLoading(false))
  }, [filters, reloadKey])

  useEffect(() => { void load() }, [load])

  const failures = data.items.filter((log) => log.status === 'failure').length
  const logins = data.items.filter((log) => log.action === 'auth.login').length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <AdminStat label="日志总数" value={formatAdminNumber(data.total)} detail="当前筛选范围" />
        <AdminStat label="本页失败操作" value={formatAdminNumber(failures)} detail="被后端拒绝或执行出错" tone={failures ? 'danger' : 'neutral'} />
        <AdminStat label="本页登录记录" value={formatAdminNumber(logins)} detail="管理员登录事件" />
      </div>

      <AdminSectionCard title="查询条件" description="支持关键词、操作类型、结果与时间范围筛选。密钥类字段在展示前会自动脱敏。">
        <div className="flex flex-wrap items-end gap-2">
          <AdminField label="关键词" className="w-full sm:w-60">
            <AdminInput value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="操作者、目标或操作标识" onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); setQuery(keyword) } }} />
          </AdminField>
          <AdminField label="操作类型" className="w-52">
            <AdminSelect value={action} onChange={(event) => { setPage(1); setAction(event.target.value) }}>
              {presetActions.map((value) => <option key={value || 'all'} value={value}>{value ? (actionLabels[value] || value) : '全部操作'}</option>)}
            </AdminSelect>
          </AdminField>
          <AdminField label="结果" className="w-32">
            <AdminSelect value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }}><option value="">全部结果</option><option value="success">成功</option><option value="failure">失败</option></AdminSelect>
          </AdminField>
          <AdminField label="目标类型" className="w-36">
            <AdminSelect value={targetType} onChange={(event) => { setPage(1); setTargetType(event.target.value) }}>
              <option value="">全部目标</option>
              {Object.entries(targetTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </AdminSelect>
          </AdminField>
          <AdminField label="开始日期" className="w-40"><AdminInput type="date" value={start} onChange={(event) => { setPage(1); setStart(event.target.value) }} /></AdminField>
          <AdminField label="结束日期" className="w-40"><AdminInput type="date" value={end} onChange={(event) => { setPage(1); setEnd(event.target.value) }} /></AdminField>
          <ControlButton variant="primary" onClick={() => { setPage(1); setQuery(keyword) }}><Search className="size-3.5" />查询</ControlButton>
          <ControlButton variant="secondary" onClick={() => { setAction(''); setStatus(''); setTargetType(''); setStart(''); setEnd(''); setKeyword(''); setQuery(''); setPage(1) }}>重置</ControlButton>
          <ControlButton variant="secondary" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>
        </div>
      </AdminSectionCard>

      {error && <AdminError message={error} retry={load} />}
      {loading && !data.items.length ? <AdminLoading label="正在加载审计日志" /> : (
        <>
          <AdminTable columns={['时间', '操作', '操作者', 'IP', '目标', '结果', '详情']} minWidth={1100} caption="审计日志列表">
            {data.items.map((log) => (
              <AdminRow key={log.id}>
                <AdminCell className="whitespace-nowrap text-xs text-muted-foreground">{formatAdminDate(log.createdAt)}</AdminCell>
                <AdminCell>
                  <p className="text-xs font-medium">{actionLabels[log.action] || log.action}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{log.action}</p>
                </AdminCell>
                <AdminCell className="text-xs">
                  {log.actor?.username || '-'}
                  {log.actor?.role && <span className="mt-1 block text-[11px] text-muted-foreground">{log.actor.role === 'admin' ? '管理员' : log.actor.role}</span>}
                </AdminCell>
                <AdminCell className="font-mono text-[11px]">{log.actor?.ip || '-'}</AdminCell>
                <AdminCell className="max-w-[220px]">
                  <p className="truncate text-xs">{log.target?.label || log.target?.id || '-'}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{log.target?.type ? (targetTypeLabels[log.target.type] || log.target.type) : '-'}</p>
                </AdminCell>
                <AdminCell><StatusBadge tone={statusTone(log.status || 'success')}>{log.status === 'failure' ? '失败' : '成功'}</StatusBadge></AdminCell>
                <AdminCell>
                  <ControlButton variant="secondary" size="sm" onClick={() => setDetail(log)}>查看</ControlButton>
                </AdminCell>
              </AdminRow>
            ))}
            {!data.items.length && <TableMessageRow colSpan={7} loading={loading} error={error} empty="没有匹配的审计日志" />}
          </AdminTable>
          <AdminPagination page={page} pageSize={20} total={data.total} loading={loading} onChange={setPage} />
        </>
      )}

      {detail && (
        <AdminDrawer open onClose={() => setDetail(null)} width="sm:max-w-xl" title="审计详情" description={actionLabels[detail.action] || detail.action}>
          <div className="flex flex-col gap-4">
            <AdminSectionCard title="操作信息" className="p-4">
              <AdminDefinition label="时间" value={formatAdminDate(detail.createdAt)} />
              <AdminDefinition label="操作标识" value={detail.action} mono />
              <AdminDefinition label="结果" value={<StatusBadge tone={statusTone(detail.status || 'success')}>{detail.status === 'failure' ? '失败' : '成功'}</StatusBadge>} />
              <AdminDefinition label="操作者" value={detail.actor?.username} />
              <AdminDefinition label="操作者角色" value={detail.actor?.role} />
              <AdminDefinition label="来源 IP" value={detail.actor?.ip} mono />
              <AdminDefinition label="客户端" value={detail.actor?.userAgent} />
              <AdminDefinition label="目标类型" value={detail.target?.type ? (targetTypeLabels[detail.target.type] || detail.target.type) : undefined} />
              <AdminDefinition label="目标名称" value={detail.target?.label} />
              <AdminDefinition label="目标 ID" value={detail.target?.id} mono />
            </AdminSectionCard>
            <AdminSectionCard title="附加数据" description="密钥、密码与令牌类字段已在展示前脱敏。" className="p-4">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-5">{JSON.stringify(maskSensitive(detail.metadata), null, 2) || '无附加数据'}</pre>
            </AdminSectionCard>
            <AdminNotice tone="neutral"><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />审计日志只读，不提供修改或删除入口。</span></AdminNotice>
          </div>
        </AdminDrawer>
      )}
    </div>
  )
}

/** 递归遮蔽敏感字段，避免密钥、密码或令牌出现在管理后台界面上。 */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[层级过深]'
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
    if (sensitiveKeys.some((sensitive) => normalized.includes(sensitive.replace(/[^a-z]/g, '')))) {
      result[key] = item === undefined || item === null || item === '' ? '' : '••••••（已脱敏）'
      continue
    }
    result[key] = maskSensitive(item, depth + 1)
  }
  return result
}
