'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Megaphone, Pencil, Plus, RefreshCw, ShieldAlert, Star, Trash2 } from 'lucide-react'
import {
  createAnnouncement,
  deleteAnnouncement,
  deleteWork,
  featureWork,
  listAnnouncements,
  listPublishedWorks,
  listWorkCases,
  resolveWorkCase,
  reviewWork,
  takeDownWork,
  updateAnnouncement,
  type Paged,
} from '@/lib/studio/admin-api'
import type { Announcement, AnnouncementInput, PublishedWork, WorkGovernanceCase } from '@/lib/studio/admin-types'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminCell,
  AdminDefinition,
  AdminDrawer,
  AdminError,
  AdminField,
  AdminInput,
  AdminNotice,
  AdminPagination,
  AdminRow,
  AdminSectionCard,
  AdminSelect,
  AdminStat,
  AdminTable,
  AdminTextarea,
  TableMessageRow,
  formatAdminDate,
  formatAdminNumber,
  statusTone,
  useConfirm,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

const moderationLabels: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回', taken_down: '已下架' }
const lifecycleLabels: Record<string, string> = { active: '正常', revoked: '已撤回' }

export function AdminContentPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const canManage = session.can('content.manage')
  const [tab, setTab] = useState<'announcements' | 'works' | 'cases'>('announcements')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-1.5">
        {([['announcements', '公告管理'], ['works', '作品审核'], ['cases', '举报与治理']] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${tab === value ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}>{label}</button>
        ))}
      </div>
      {tab === 'announcements' && <AnnouncementsPanel canManage={canManage} reloadKey={reloadKey} />}
      {tab === 'works' && <WorksPanel canManage={canManage} reloadKey={reloadKey} />}
      {tab === 'cases' && <CasesPanel canManage={canManage} reloadKey={reloadKey} />}
    </div>
  )
}

/* -------------------------------- 公告 -------------------------------- */

function AnnouncementsPanel({ canManage, reloadKey }: { canManage: boolean; reloadKey: number }) {
  const [data, setData] = useState<Paged<Announcement>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<Announcement | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true); setError('')
    listAnnouncements(page, 20).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : '公告加载失败')).finally(() => setLoading(false))
  }, [page, reloadKey])

  useEffect(() => { void load() }, [load])

  const togglePublish = useCallback((item: Announcement) => {
    const publishing = !item.enabled
    confirm.confirm({
      title: publishing ? `发布公告「${item.title}」？` : `下线公告「${item.title}」？`,
      description: publishing ? '发布后所有用户在公告生效区间内都能看到该内容。' : '下线后用户端不再展示该公告，内容仍会保留。',
      confirmLabel: publishing ? '确认发布' : '确认下线',
      tone: publishing ? 'default' : 'danger',
      onConfirm: async () => {
        setBusy(item.id)
        try {
          await updateAnnouncement(item.id, { enabled: publishing })
          setMessage(publishing ? '公告已发布' : '公告已下线')
          load()
        } finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const togglePopup = useCallback(async (item: Announcement, field: 'popupHome' | 'popupAfterLogin') => {
    setBusy(item.id); setError('')
    try {
      await updateAnnouncement(item.id, { [field]: !item[field] })
      setMessage(field === 'popupHome' ? '首页弹窗设置已更新' : '登录后弹窗设置已更新')
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '弹窗设置保存失败')
    } finally { setBusy(null) }
  }, [load])

  const remove = useCallback((item: Announcement) => {
    confirm.confirm({
      title: `删除公告「${item.title}」？`,
      description: '删除后无法恢复，操作会写入审计日志。',
      confirmLabel: '确认删除',
      tone: 'danger',
      onConfirm: async () => {
        setBusy(item.id)
        try { await deleteAnnouncement(item.id); setMessage('公告已删除'); load() }
        finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const enabled = data.items.filter((item) => item.enabled).length

  return (
    <div className="flex flex-col gap-4">
      {confirm.dialog}
      <div className="grid gap-3 sm:grid-cols-3">
        <AdminStat label="公告总数" value={formatAdminNumber(data.total)} detail={`本页已发布 ${formatAdminNumber(enabled)}`} />
        <AdminStat label="未发布" value={formatAdminNumber(data.items.length - enabled)} detail="enabled 为关闭状态" tone="warning" />
        <AdminStat label="首页弹窗" value={formatAdminNumber(data.items.filter((item) => item.popupHome).length)} detail="访客进入首页时弹出" />
      </div>

      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}

      <AdminSectionCard
        title="站点公告"
        description="公告支持发布、下线、首页弹窗与登录后弹窗；生效区间由开始和结束时间控制。所有操作都会写入审计日志。"
        action={canManage ? <div className="flex gap-2"><ControlButton variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton><ControlButton variant="primary" size="sm" onClick={() => setEditor('new')}><Plus className="size-3.5" />新增公告</ControlButton></div> : undefined}
      >
        <AdminTable columns={['标题', '状态', '弹窗位置', '生效区间', '更新时间', '操作']} minWidth={1000} caption="公告列表">
          {data.items.map((item) => (
            <AdminRow key={item.id}>
              <AdminCell className="max-w-[360px]"><p className="truncate font-medium">{item.title}</p><p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.content?.slice(0, 120) || '无内容'}</p></AdminCell>
              <AdminCell><StatusBadge tone={item.enabled ? 'success' : 'muted'}>{item.enabled ? '已发布' : '未发布'}</StatusBadge></AdminCell>
              <AdminCell>
                <div className="flex flex-wrap gap-1.5">
                  {canManage ? <>
                    <button type="button" disabled={busy === item.id} onClick={() => void togglePopup(item, 'popupHome')} aria-pressed={item.popupHome} className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${item.popupHome ? 'border-studio-accent/40 text-studio-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>首页弹窗</button>
                    <button type="button" disabled={busy === item.id} onClick={() => void togglePopup(item, 'popupAfterLogin')} aria-pressed={item.popupAfterLogin} className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${item.popupAfterLogin ? 'border-studio-accent/40 text-studio-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>登录后弹窗</button>
                  </> : (item.popupHome || item.popupAfterLogin) ? <span className="text-[11px] text-muted-foreground">{[item.popupHome && '首页', item.popupAfterLogin && '登录后'].filter(Boolean).join(' · ')}</span> : <span className="text-[11px] text-muted-foreground">仅公告列表</span>}
                </div>
              </AdminCell>
              <AdminCell className="text-xs text-muted-foreground">{item.startsAt || item.endsAt ? `${formatAdminDate(item.startsAt)} → ${formatAdminDate(item.endsAt)}` : '长期有效'}</AdminCell>
              <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(item.updatedAt)}</AdminCell>
              <AdminCell>
                <div className="flex flex-wrap gap-1.5">
                  {canManage && <ControlButton variant="secondary" size="sm" onClick={() => setEditor(item)}><Pencil className="size-3.5" />编辑</ControlButton>}
                  {canManage && <ControlButton variant={item.enabled ? 'danger' : 'primary'} size="sm" disabled={busy === item.id} onClick={() => togglePublish(item)}>{item.enabled ? <><EyeOff className="size-3.5" />下线</> : <><Eye className="size-3.5" />发布</>}</ControlButton>}
                  {canManage && <ControlButton variant="danger" size="sm" disabled={busy === item.id} onClick={() => remove(item)} aria-label={`删除 ${item.title}`}><Trash2 className="size-3.5" /></ControlButton>}
                </div>
              </AdminCell>
            </AdminRow>
          ))}
          {!data.items.length && <TableMessageRow colSpan={6} loading={loading} error={error} empty="暂无公告" />}
        </AdminTable>
        <div className="mt-4"><AdminPagination page={page} pageSize={20} total={data.total} loading={loading} onChange={setPage} /></div>
      </AdminSectionCard>

      {editor && <AnnouncementEditor item={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={(text) => { setMessage(text); setEditor(null); load() }} />}
    </div>
  )
}

function AnnouncementEditor({ item, onClose, onSaved }: { item?: Announcement; onClose: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    const value = (key: string) => String(data.get(key) ?? '').trim()
    try {
      const startsAt = value('startsAt')
      const endsAt = value('endsAt')
      if (startsAt && endsAt && new Date(startsAt).getTime() > new Date(endsAt).getTime()) throw new Error('结束时间必须晚于开始时间')
      const payload: AnnouncementInput = {
        title: value('title'),
        content: value('content'),
        enabled: data.has('enabled'),
        popupHome: data.has('popupHome'),
        popupAfterLogin: data.has('popupAfterLogin'),
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
      }
      if (item) await updateAnnouncement(item.id, payload)
      else await createAnnouncement(payload)
      onSaved(item ? '公告已保存' : '公告已创建')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminDrawer open onClose={onClose} title={item ? `编辑公告 ${item.title}` : '新增公告'} description="未发布的公告不会对用户展示；发布后立即在生效区间内生效。">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <AdminField label="公告标题" className="sm:col-span-2"><AdminInput name="title" required maxLength={120} defaultValue={item?.title} /></AdminField>
          <AdminField label="公告内容" className="sm:col-span-2"><AdminTextarea name="content" rows={8} required defaultValue={item?.content} /></AdminField>
          <AdminField label="开始时间" hint="留空表示立即生效。"><AdminInput name="startsAt" type="datetime-local" defaultValue={toLocalInput(item?.startsAt)} /></AdminField>
          <AdminField label="结束时间" hint="留空表示长期有效。"><AdminInput name="endsAt" type="datetime-local" defaultValue={toLocalInput(item?.endsAt)} /></AdminField>
          <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={item?.enabled ?? true} />发布公告</label>
          <label className="flex items-center gap-2 text-sm"><input name="popupHome" type="checkbox" defaultChecked={item?.popupHome ?? false} />首页弹窗展示</label>
          <label className="flex items-center gap-2 text-sm"><input name="popupAfterLogin" type="checkbox" defaultChecked={item?.popupAfterLogin ?? false} />登录后弹窗展示</label>
        </fieldset>
        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
          <ControlButton type="submit" variant="primary" disabled={busy}><Megaphone className="size-3.5" />{busy ? '保存中' : '保存公告'}</ControlButton>
        </div>
      </form>
    </AdminDrawer>
  )
}

function toIso(value: string) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function toLocalInput(value?: string) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/* -------------------------------- 作品 -------------------------------- */

function WorksPanel({ canManage, reloadKey }: { canManage: boolean; reloadKey: number }) {
  const [data, setData] = useState<Paged<PublishedWork>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true); setError('')
    listPublishedWorks({ page, pageSize: 20, status, keyword: query }).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : '作品加载失败')).finally(() => setLoading(false))
  }, [page, status, query, reloadKey])

  useEffect(() => { void load() }, [load])

  const moderate = useCallback((work: PublishedWork) => {
    confirm.confirm({
      title: `下架作品「${work.currentVersion?.title || work.id}」？`,
      description: '下架后作品不再对公众展示，作者会收到状态变更。该操作会写入审计日志。',
      confirmLabel: '确认下架',
      tone: 'danger',
      onConfirm: async () => {
        setBusy(work.id)
        try { await takeDownWork(work.id, '管理员后台下架'); setMessage('作品已下架'); load() }
        finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const approve = useCallback(async (work: PublishedWork) => {
    setBusy(work.id); setError(''); setMessage('')
    try {
      await reviewWork(work.id, 'approved', { versionId: work.currentVersion?.id })
      setMessage('作品已通过审核')
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审核失败')
    } finally { setBusy(null) }
  }, [load])

  const reject = useCallback((work: PublishedWork) => {
    confirm.confirm({
      title: `驳回作品「${work.currentVersion?.title || work.id}」？`,
      description: '驳回后作者需要修改并重新提交审核。',
      confirmLabel: '确认驳回',
      tone: 'danger',
      onConfirm: async () => {
        setBusy(work.id)
        try { await reviewWork(work.id, 'rejected', { versionId: work.currentVersion?.id, reason: '管理员后台驳回' }); setMessage('作品已驳回'); load() }
        finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const remove = useCallback((work: PublishedWork) => {
    confirm.confirm({
      title: '删除该作品？',
      description: '删除会同时移除作品版本与公开资源，操作不可撤销。',
      confirmLabel: '确认删除',
      tone: 'danger',
      onConfirm: async () => {
        setBusy(work.id)
        try { await deleteWork(work.id); setMessage('作品已删除'); load() }
        finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const pending = data.items.filter((work) => work.moderationStatus === 'pending').length

  return (
    <div className="flex flex-col gap-4">
      {confirm.dialog}
      <div className="grid gap-3 sm:grid-cols-3">
        <AdminStat label="作品总数" value={formatAdminNumber(data.total)} detail="当前查询范围" />
        <AdminStat label="本页待审核" value={formatAdminNumber(pending)} detail="需要人工确认的作品" tone={pending ? 'warning' : 'neutral'} />
        <AdminStat label="本页已下架" value={formatAdminNumber(data.items.filter((work) => work.moderationStatus === 'taken_down').length)} detail="不再对公众展示" tone="danger" />
      </div>

      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}

      <AdminSectionCard title="作品审核" description="审核、下架与删除公开作品。内容操作全部写入审计日志。">
        <div className="flex flex-wrap items-center gap-2">
          <AdminInput aria-label="搜索作品" className="w-full sm:w-64" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="作品标题或作者" onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); setQuery(keyword) } }} />
          <AdminSelect aria-label="审核状态" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }} className="w-36">
            <option value="">全部状态</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="taken_down">已下架</option>
          </AdminSelect>
          <ControlButton variant="primary" size="sm" onClick={() => { setPage(1); setQuery(keyword) }}>查询</ControlButton>
          <ControlButton variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>
        </div>

        <div className="mt-4">
          <AdminTable columns={['作品', '作者', '审核状态', '生命周期', '推荐', '时间', '操作']} minWidth={1040} caption="公开作品列表">
            {data.items.map((work) => (
              <AdminRow key={work.id}>
                <AdminCell className="max-w-[280px]">
                  <p className="truncate font-medium">{work.currentVersion?.title || '未命名作品'}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{work.currentVersion?.summary || work.id}</p>
                </AdminCell>
                <AdminCell className="text-xs">{work.authorUsername || work.authorUserId || '-'}</AdminCell>
                <AdminCell><StatusBadge tone={statusTone(work.moderationStatus)}>{moderationLabels[String(work.moderationStatus)] || work.moderationStatus || '-'}</StatusBadge></AdminCell>
                <AdminCell className="text-xs">{lifecycleLabels[String(work.lifecycleStatus)] || work.lifecycleStatus || '-'}</AdminCell>
                <AdminCell>{work.featured ? <StatusBadge tone="accent">已推荐</StatusBadge> : <span className="text-xs text-muted-foreground">-</span>}</AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(work.createdAt)}</AdminCell>
                <AdminCell>
                  <div className="flex flex-wrap gap-1.5">
                    {canManage && work.moderationStatus === 'pending' && <>
                      <ControlButton variant="primary" size="sm" disabled={busy === work.id} onClick={() => void approve(work)}>通过</ControlButton>
                      <ControlButton variant="danger" size="sm" disabled={busy === work.id} onClick={() => reject(work)}>驳回</ControlButton>
                    </>}
                    {canManage && work.moderationStatus !== 'taken_down' && <ControlButton variant="danger" size="sm" disabled={busy === work.id} onClick={() => moderate(work)}>下架</ControlButton>}
                    {canManage && <ControlButton
                      variant="secondary" size="sm" disabled={busy === work.id}
                      onClick={async () => { setBusy(work.id); try { await featureWork(work.id, !work.featured); setMessage(work.featured ? '已取消推荐' : '已设为推荐'); load() } catch (reason) { setError(reason instanceof Error ? reason.message : '推荐状态修改失败') } finally { setBusy(null) } }}
                    ><Star className="size-3.5" />{work.featured ? '取消推荐' : '推荐'}</ControlButton>}
                    {canManage && <ControlButton variant="danger" size="sm" disabled={busy === work.id} onClick={() => remove(work)} aria-label="删除作品"><Trash2 className="size-3.5" /></ControlButton>}
                  </div>
                </AdminCell>
              </AdminRow>
            ))}
            {!data.items.length && <TableMessageRow colSpan={7} loading={loading} error={error} empty="暂无待处理作品" />}
          </AdminTable>
        </div>
        <div className="mt-4"><AdminPagination page={page} pageSize={20} total={data.total} loading={loading} onChange={setPage} /></div>
      </AdminSectionCard>
    </div>
  )
}

/* ------------------------------ 举报治理 ------------------------------ */

function CasesPanel({ canManage, reloadKey }: { canManage: boolean; reloadKey: number }) {
  const [data, setData] = useState<Paged<WorkGovernanceCase>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [target, setTarget] = useState<WorkGovernanceCase | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true); setError('')
    listWorkCases(page, 20).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : '治理案件加载失败')).finally(() => setLoading(false))
  }, [page, reloadKey])

  useEffect(() => { void load() }, [load])

  const resolve = useCallback((item: WorkGovernanceCase, decision: string) => {
    confirm.confirm({
      title: decision === 'uphold' ? '维持举报并处理作品？' : '驳回该举报？',
      description: '处理结果会写入审计日志，并通知相关作者或举报人。',
      confirmLabel: '确认处理',
      tone: decision === 'uphold' ? 'danger' : 'default',
      onConfirm: async () => {
        setBusy(item.id)
        try { await resolveWorkCase(item.id, decision, decision === 'uphold' ? '管理员确认违规' : '管理员判定无违规'); setMessage('治理案件已处理'); load() }
        finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const open = data.items.filter((item) => item.status !== 'resolved' && item.status !== 'rejected').length

  return (
    <div className="flex flex-col gap-4">
      {confirm.dialog}
      {target && (
        <AdminDrawer open onClose={() => setTarget(null)} width="sm:max-w-lg" title="案件详情">
          <div className="flex flex-col gap-3">
            <AdminDefinition label="案件 ID" value={target.id} mono />
            <AdminDefinition label="作品 ID" value={target.workId} mono />
            <AdminDefinition label="版本 ID" value={target.versionId} mono />
            <AdminDefinition label="类型" value={target.kind} />
            <AdminDefinition label="状态" value={<StatusBadge tone={statusTone(target.status)}>{target.status || '-'}</StatusBadge>} />
            <AdminDefinition label="举报原因" value={target.reason} />
            <AdminDefinition label="处理结果" value={target.resolution} />
            <AdminDefinition label="创建时间" value={formatAdminDate(target.createdAt)} />
            <AdminDefinition label="处理时间" value={formatAdminDate(target.resolvedAt)} />
          </div>
        </AdminDrawer>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <AdminStat label="案件总数" value={formatAdminNumber(data.total)} />
        <AdminStat label="本页未处理" value={formatAdminNumber(open)} tone={open ? 'warning' : 'neutral'} />
        <AdminStat label="本页已处理" value={formatAdminNumber(data.items.length - open)} tone="success" />
      </div>

      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}

      <AdminSectionCard title="举报与异常内容" description="处理用户举报、申诉和异常内容治理案件。" action={<ControlButton variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>}>
        <AdminTable columns={['案件', '作品', '类型', '状态', '原因', '时间', '操作']} minWidth={1040} caption="治理案件列表">
          {data.items.map((item) => (
            <AdminRow key={item.id}>
              <AdminCell className="font-mono text-[11px]">{item.id.slice(0, 12)}</AdminCell>
              <AdminCell className="font-mono text-[11px]">{item.workId?.slice(0, 12) || '-'}</AdminCell>
              <AdminCell className="text-xs">{item.kind || '-'}</AdminCell>
              <AdminCell><StatusBadge tone={statusTone(item.status)}>{item.status || '-'}</StatusBadge></AdminCell>
              <AdminCell className="max-w-[240px] truncate text-xs" >{item.reason || '-'}</AdminCell>
              <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(item.createdAt)}</AdminCell>
              <AdminCell>
                <div className="flex flex-wrap gap-1.5">
                  <ControlButton variant="secondary" size="sm" onClick={() => setTarget(item)}>详情</ControlButton>
                  {canManage && item.status !== 'resolved' && <>
                    <ControlButton variant="danger" size="sm" disabled={busy === item.id} onClick={() => resolve(item, 'uphold')}><ShieldAlert className="size-3.5" />维持</ControlButton>
                    <ControlButton variant="secondary" size="sm" disabled={busy === item.id} onClick={() => resolve(item, 'dismiss')}>驳回</ControlButton>
                  </>}
                </div>
              </AdminCell>
            </AdminRow>
          ))}
          {!data.items.length && <TableMessageRow colSpan={7} loading={loading} error={error} empty="暂无治理案件" />}
        </AdminTable>
        <div className="mt-4"><AdminPagination page={page} pageSize={20} total={data.total} loading={loading} onChange={setPage} /></div>
      </AdminSectionCard>
    </div>
  )
}
