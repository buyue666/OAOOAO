'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { request } from '@/lib/studio/api'
import { safeAnnouncementHref } from '@/lib/studio/announcements'
import { safePopupImageUrl, type SitePopup, type SitePopupInput } from '@/lib/studio/site-popups'
import { SitePopupCard } from '@/components/site-popup-card'
import { ControlButton, StatusBadge } from './ui'
import {
  AdminCell, AdminDataPanel, AdminDrawer, AdminError, AdminField, AdminInput, AdminNotice,
  AdminPagination, AdminRow, AdminSelect, AdminStat, AdminTable, AdminTextarea,
  TableMessageRow, formatAdminDate, formatAdminNumber, useConfirm,
} from './admin-kit'

type PopupPage = 'home' | 'studio'
type PopupList = { popups: SitePopup[]; total: number; page: number; pageSize: number }
const pageLabels: Record<PopupPage, string> = { home: '官网首页', studio: '开始创作页' }
const pageOptions = ['home', 'studio'] as const
const endpoint = '/api/admin/site-popups'

function popupStatus(item: SitePopup, now: number) {
  if (!item.enabled) return { label: '未启用', tone: 'muted' as const }
  if (item.endsAt && Date.parse(item.endsAt) <= now) return { label: '已结束', tone: 'warning' as const }
  if (item.startsAt && Date.parse(item.startsAt) > now) return { label: '待生效', tone: 'muted' as const }
  return { label: '生效中', tone: 'success' as const }
}

export function AdminSitePopupsPanel({ canManage, reloadKey }: { canManage: boolean; reloadKey: number }) {
  const [data, setData] = useState<PopupList>({ popups: [], total: 0, page: 1, pageSize: 20 })
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editor, setEditor] = useState<SitePopup | 'new' | null>(null)
  const [preview, setPreview] = useState<SitePopup | null>(null)
  const [now, setNow] = useState(Date.now)
  const confirm = useConfirm()
  const reload = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    request<PopupList>(`${endpoint}?page=${page}&pageSize=20`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '推广弹窗加载失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, revision, reloadKey])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const toggle = (item: SitePopup) => confirm.confirm({
    title: item.enabled ? `停用「${item.title}」？` : `启用「${item.title}」？`,
    description: item.enabled ? '停用后不再向访客展示，内容和配置会保留。' : '将按所选页面、展示频率和生效时间展示。已结束的弹窗需先调整结束时间。',
    confirmLabel: item.enabled ? '确认停用' : '确认启用',
    tone: item.enabled ? 'danger' : 'default',
    onConfirm: async () => {
      setBusy(item.id); setMessage('')
      try {
        await request<{ popup: SitePopup }>(`${endpoint}/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled }) })
        setMessage(item.enabled ? '推广弹窗已停用' : '推广弹窗已启用'); reload()
      } finally { setBusy(null) }
    },
  })

  const remove = (item: SitePopup) => confirm.confirm({
    title: `删除「${item.title}」？`, description: '删除后无法恢复，访客不再看到这条推广弹窗。',
    confirmLabel: '确认删除', tone: 'danger',
    onConfirm: async () => {
      setBusy(item.id); setMessage('')
      try {
        await request(`${endpoint}/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
        setMessage('推广弹窗已删除')
        if (data.popups.length === 1 && page > 1) setPage(value => value - 1)
        else reload()
      } finally { setBusy(null) }
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {confirm.dialog}
      <div className="grid gap-3 sm:grid-cols-3">
        <AdminStat label="推广弹窗总数" value={formatAdminNumber(data.total)} detail="图片、活动与创作推荐" />
        <AdminStat label="本页生效中" value={formatAdminNumber(data.popups.filter(item => popupStatus(item, now).label === '生效中').length)} tone="success" />
        <AdminStat label="本页未启用" value={formatAdminNumber(data.popups.filter(item => !item.enabled).length)} detail="保存内容后可单独启用" />
      </div>
      {error && <AdminError message={error} retry={reload} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}
      <AdminDataPanel
        title="推广弹窗" description="在官网首页或开始创作页展示独立推广卡片，可设置图片、内容、跳转地址与展示频率。"
        actions={<>
          <ControlButton variant="secondary" size="sm" onClick={reload} disabled={loading || !!busy}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>
          {canManage && <ControlButton variant="primary" size="sm" disabled={!!busy} onClick={() => setEditor('new')}><Plus className="size-3.5" />新增推广弹窗</ControlButton>}
        </>}
        footer={<AdminPagination page={page} pageSize={20} total={data.total} loading={loading || !!busy} onChange={setPage} />}
      >
        <AdminTable columns={['推广内容', '状态', '展示位置与频率', '生效区间', '更新时间', '操作']} minWidth={1040} caption="推广弹窗列表">
          {data.popups.map(item => {
            const status = popupStatus(item, now)
            return (
              <AdminRow key={item.id}>
                <AdminCell className="max-w-[320px]"><p className="truncate font-medium">{item.title}</p><p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.content || '图片推广'}</p></AdminCell>
                <AdminCell><StatusBadge tone={status.tone}>{status.label}</StatusBadge></AdminCell>
                <AdminCell className="text-xs"><p>{item.pages.map(value => pageLabels[value]).join(' · ')}</p><p className="mt-1 text-muted-foreground">{item.frequency === 'daily' ? '每天一次' : '每次会话一次'}</p></AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{item.startsAt ? formatAdminDate(item.startsAt) : '立即生效'}<br />至 {item.endsAt ? formatAdminDate(item.endsAt) : '长期有效'}</AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(item.updatedAt)}</AdminCell>
                <AdminCell><div className="flex flex-wrap gap-1.5">
                  <ControlButton variant="secondary" size="sm" onClick={() => setPreview(item)}><Eye className="size-3.5" />预览</ControlButton>
                  {canManage && <>
                    <ControlButton variant="secondary" size="sm" disabled={!!busy} onClick={() => setEditor(item)}><Pencil className="size-3.5" />编辑</ControlButton>
                    <ControlButton variant={item.enabled ? 'secondary' : 'primary'} size="sm" disabled={!!busy} onClick={() => toggle(item)}>{item.enabled ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{item.enabled ? '停用' : '启用'}</ControlButton>
                    <ControlButton variant="danger" size="sm" disabled={!!busy} onClick={() => remove(item)} aria-label={`删除推广弹窗 ${item.title}`}><Trash2 className="size-3.5" /></ControlButton>
                  </>}
                </div></AdminCell>
              </AdminRow>
            )
          })}
          {!data.popups.length && <TableMessageRow colSpan={6} loading={loading} error={error} empty="暂无推广弹窗，新增后可先预览再启用" />}
        </AdminTable>
      </AdminDataPanel>
      {editor && <SitePopupEditor key={editor === 'new' ? 'new' : editor.id} item={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMessage('推广弹窗已保存'); reload() }} />}
      {preview && <AdminDrawer open title="推广弹窗预览" description="预览不会计入展示次数，也不会打开跳转地址。" onClose={() => setPreview(null)} footer={<ControlButton variant="secondary" onClick={() => setPreview(null)}>关闭预览</ControlButton>}><div className="rounded-xl bg-muted/50 p-3 sm:p-5"><SitePopupCard popup={preview} preview /></div></AdminDrawer>}
    </div>
  )
}

function localDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function inputDate(value: string, original?: string | null) {
  if (!value) return null
  if (value === localDate(original)) return original || null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function SitePopupEditor({ item, onClose, onSaved }: { item?: SitePopup; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title || '')
  const [content, setContent] = useState(item?.content || '')
  const [imageUrl, setImageUrl] = useState(item?.imageUrl || '')
  const [actionUrl, setActionUrl] = useState(item?.actionUrl || '')
  const [buttonText, setButtonText] = useState(item?.buttonText || '查看详情')
  const [pages, setPages] = useState<PopupPage[]>(item?.pages || ['home', 'studio'])
  const [frequency, setFrequency] = useState<'session' | 'daily'>(item?.frequency || 'session')
  const [enabled, setEnabled] = useState(item?.enabled ?? false)
  const [startsAt, setStartsAt] = useState(localDate(item?.startsAt))
  const [endsAt, setEndsAt] = useState(localDate(item?.endsAt))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const submitting = useRef(false)
  const initial = useRef(JSON.stringify([title, content, imageUrl, actionUrl, buttonText, pages, frequency, enabled, startsAt, endsAt]))
  const dirty = initial.current !== JSON.stringify([title, content, imageUrl, actionUrl, buttonText, pages, frequency, enabled, startsAt, endsAt])
  const image = safePopupImageUrl(imageUrl)
  const action = safeAnnouncementHref(actionUrl)
  const close = () => { if (!submitting.current) { if (dirty) setDiscard(true); else onClose() } }
  const popup: SitePopup = {
    id: item?.id || 'preview', title: title.trim() || '推广标题', content: content.trim(), imageUrl: image || undefined,
    actionUrl: action || undefined, buttonText: buttonText.trim() || '查看详情', enabled, pages, frequency,
    startsAt: inputDate(startsAt, item?.startsAt) || undefined, endsAt: inputDate(endsAt, item?.endsAt) || undefined,
    createdAt: item?.createdAt || '', updatedAt: item?.updatedAt || '',
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    setError(''); setDiscard(false)
    const start = inputDate(startsAt, item?.startsAt), end = inputDate(endsAt, item?.endsAt)
    if (!title.trim() || title.trim().length > 120) { setError('请输入不超过 120 字的推广标题。'); return }
    if (content.length > 10000 || (!content.trim() && !imageUrl.trim())) { setError('请填写推广内容或图片地址；内容最多 10000 字。'); return }
    if (imageUrl.trim() && !image) { setError('图片地址仅支持 /media/ 路径或完整 HTTPS 网址，不能使用 SVG、凭据或控制字符。'); return }
    if (actionUrl.trim() && !action) { setError('跳转地址须为安全的站内路径或完整 HTTP(S) 网址，最长 2048 字。'); return }
    if (buttonText.trim().length > 24) { setError('按钮文字最多 24 字。'); return }
    if (!pages.length) { setError('请至少选择一个展示页面。'); return }
    if (start === undefined || end === undefined || (start && end && Date.parse(end) <= Date.parse(start))) { setError('请检查生效时间，结束时间须晚于开始时间。'); return }
    const payload: SitePopupInput = { title: title.trim(), content: content.trim(), imageUrl: imageUrl.trim() || null, actionUrl: actionUrl.trim() || null, buttonText: buttonText.trim() || '查看详情', enabled, pages, frequency, startsAt: start, endsAt: end }
    submitting.current = true; setBusy(true)
    try {
      await request<{ popup: SitePopup }>(item ? `${endpoint}/${encodeURIComponent(item.id)}` : endpoint, { method: item ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      onSaved()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '推广弹窗保存失败') }
    finally { submitting.current = false; setBusy(false) }
  }

  return (
    <AdminDrawer open title={item ? '编辑推广弹窗' : '新增推广弹窗'} description="编辑内容即可预览，保存后按配置展示。" width="sm:max-w-5xl" onClose={close}
      footer={<>
        {error && <div className="w-full" role="alert"><AdminNotice tone="danger">{error}</AdminNotice></div>}
        {discard && <div className="mr-auto flex flex-wrap items-center gap-2 text-xs" role="alert"><span>修改尚未保存，确认放弃？</span><ControlButton variant="danger" size="sm" onClick={onClose}>放弃修改</ControlButton><ControlButton variant="secondary" size="sm" onClick={() => setDiscard(false)}>继续编辑</ControlButton></div>}
        <ControlButton variant="secondary" onClick={close} disabled={busy}>取消</ControlButton>
        <ControlButton type="submit" form="site-popup-editor" variant="primary" disabled={busy}><Save className="size-3.5" />{busy ? '保存中' : '保存推广弹窗'}</ControlButton>
      </>}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form id="site-popup-editor" onSubmit={submit} className="min-w-0">
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            <AdminField label="推广标题"><AdminInput name="title" required maxLength={120} autoFocus value={title} onChange={event => setTitle(event.target.value)} /></AdminField>
            <AdminField label="推广内容" hint="与图片至少填写一项，支持分段纯文本。"><AdminTextarea name="content" maxLength={10000} rows={5} value={content} onChange={event => setContent(event.target.value)} /></AdminField>
            <AdminField label="图片地址（可选）" hint="使用可公开访问的 /media/ 图片路径或 HTTPS 图片网址，不支持 SVG。"><AdminInput name="imageUrl" maxLength={2048} value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder="https://example.com/promotion.webp" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></AdminField>
            {imageUrl.trim() && !image && <p className="text-xs text-destructive" role="status">图片地址格式不安全，预览已隐藏该图片。</p>}
            <AdminField label="跳转地址（可选）" hint="站内路径在当前页打开，完整网址在新窗口打开。留空时按钮关闭弹窗。"><AdminInput name="actionUrl" maxLength={2048} value={actionUrl} onChange={event => setActionUrl(event.target.value)} placeholder="/plans 或 https://example.com/activity" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></AdminField>
            <AdminField label="按钮文字" hint="留空时使用“查看详情”，最多 24 字。"><AdminInput name="buttonText" maxLength={24} value={buttonText} onChange={event => setButtonText(event.target.value)} /></AdminField>
            <fieldset className="rounded-lg border border-border p-3"><legend className="px-1 text-xs font-medium text-muted-foreground">展示页面（至少一项）</legend><div className="flex flex-wrap gap-4">{pageOptions.map(value => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="pages" value={value} checked={pages.includes(value)} onChange={event => setPages(current => event.target.checked ? [...current, value] : current.filter(page => page !== value))} />{pageLabels[value]}</label>)}</div></fieldset>
            <AdminField label="展示频率"><AdminSelect name="frequency" value={frequency} onChange={event => setFrequency(event.target.value as 'session' | 'daily')}><option value="session">每次浏览器会话一次</option><option value="daily">每天一次</option></AdminSelect></AdminField>
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField label="开始时间" hint="本地时间，留空立即生效。"><AdminInput name="startsAt" type="datetime-local" step={1} value={startsAt} onChange={event => setStartsAt(event.target.value)} /></AdminField>
              <AdminField label="结束时间" hint="本地时间，留空长期有效。"><AdminInput name="endsAt" type="datetime-local" step={1} value={endsAt} onChange={event => setEndsAt(event.target.value)} /></AdminField>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm"><input type="checkbox" name="enabled" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用推广弹窗</label>
            {!enabled && <p className="text-xs text-muted-foreground">当前保存为未启用状态，访客不会看到这条内容。</p>}
          </fieldset>
        </form>
        <aside aria-label="推广弹窗实时预览" className="min-w-0 rounded-xl border border-border bg-muted/40 p-3 sm:p-4 lg:sticky lg:top-0">
          <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">实时预览</h3><StatusBadge tone="muted">未保存预览</StatusBadge></div>
          <div className="max-h-[70dvh] overflow-y-auto rounded-3xl"><SitePopupCard popup={popup} preview /></div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">预览不受生效时间影响，不会打开跳转地址或消耗展示次数。图片实际加载结果以图片来源为准。</p>
        </aside>
      </div>
    </AdminDrawer>
  )
}
