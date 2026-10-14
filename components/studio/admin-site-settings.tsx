'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink, RotateCcw, Save } from 'lucide-react'
import { SiteBrand } from '@/components/site-brand'
import { safeBrandImageUrl } from '@/lib/studio/site-brand'
import { normalizeSiteFooter, validateSiteFooter } from '@/lib/studio/site-footer'
import type { AdminSettingsPatch } from '@/lib/studio/admin-api'
import type { SiteSettings } from '@/lib/studio/admin-types'
import { ControlButton, StatusBadge } from './ui'
import { AdminField, AdminInput, AdminNotice, AdminSaveBar, AdminSectionCard, AdminTabs, AdminTextarea } from './admin-kit'
import { AdminSiteFooter } from './admin-site-footer'

const textFields = ['title', 'logoUrl', 'iconUrl', 'seoTitle', 'seoDescription', 'seoKeywords', 'termsUrl', 'termsVersion', 'termsContent', 'privacyUrl', 'privacyVersion', 'privacyContent'] as const
const labels: Record<(typeof textFields)[number], string> = { title: '站点名称', logoUrl: '品牌 Logo', iconUrl: '浏览器图标', seoTitle: '搜索标题', seoDescription: '搜索描述', seoKeywords: '搜索关键词', termsUrl: '服务条款地址', termsVersion: '服务条款版本', termsContent: '服务条款正文', privacyUrl: '隐私政策地址', privacyVersion: '隐私政策版本', privacyContent: '隐私政策正文' }
const tabs = [['brand', '品牌标识'], ['search', '搜索信息'], ['footer', '页脚'], ['policies', '条款与隐私']] as const
type BrandTab = (typeof tabs)[number][0]

function draftFromSite(site: SiteSettings) {
  return {
    ...Object.fromEntries(textFields.map((key) => [key, String(site[key] ?? '')])) as Record<(typeof textFields)[number], string>,
    footer: normalizeSiteFooter(site.footer),
  }
}

export function AdminSiteSettings({ site, onSave, saving, onDirtyChange }: { site: SiteSettings; onSave: (patch: AdminSettingsPatch, summary: string[]) => void; saving: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(() => draftFromSite(site))
  const [active, setActive] = useState<BrandTab>('brand')
  const [error, setError] = useState('')
  const original = draftFromSite(site)
  const changed = textFields.filter((key) => draft[key] !== original[key])
  const footerChanged = JSON.stringify(draft.footer) !== JSON.stringify(original.footer)
  const dirty = changed.length > 0 || footerChanged

  useEffect(() => { setDraft(draftFromSite(site)); setError('') }, [site])
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function field(key: (typeof textFields)[number]) {
    return { name: key, value: draft[key], onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dirty || saving) return
    for (const key of ['logoUrl', 'iconUrl'] as const) {
      if (draft[key].trim() && !safeBrandImageUrl(draft[key])) { setActive('brand'); setError(`${labels[key]}请使用站内路径或完整的 HTTP(S) 图片地址。`); return }
    }
    const footerError = footerChanged ? validateSiteFooter(draft.footer) : null
    if (footerError) { setActive('footer'); setError(footerError); return }
    setError('')
    const next: SiteSettings = { ...Object.fromEntries(changed.map((key) => [key, draft[key].trim()])), ...(footerChanged ? { footer: normalizeSiteFooter(draft.footer) } : {}) }
    onSave({ site: next }, [...changed.map((key) => labels[key]), ...(footerChanged ? ['页脚'] : [])])
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AdminTabs label="站点展示设置" items={tabs} value={active} onChange={setActive} />
        <StatusBadge tone={dirty ? 'warning' : 'neutral'}>{dirty ? `${changed.length + Number(footerChanged)} 项未保存` : '已保存配置'}</StatusBadge>
      </div>
      {error && <AdminNotice tone="danger">{error}</AdminNotice>}

      <div hidden={active !== 'brand'}>
        <AdminSectionCard title="一处设置，统一展示" description="站点名称与 Logo 同步到登录页、创作工作台和管理后台；浏览器图标用于标签页。">
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
            <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
              <AdminField label="站点名称" hint="留空时使用 OAO。"><AdminInput {...field('title')} maxLength={40} placeholder="OAO" /></AdminField>
              <AdminField label="品牌 Logo 地址" hint="建议使用透明背景的横版图片；留空使用内置 OAO 标志。"><AdminInput {...field('logoUrl')} placeholder="/media/brand/oao-logo-transparent.png" /></AdminField>
              <AdminField label="浏览器图标地址" hint="建议使用正方形图片，用于浏览器标签页。"><AdminInput {...field('iconUrl')} placeholder="/media/brand/oao-mark.png" /></AdminField>
              <ControlButton type="button" size="sm" className="self-start" onClick={() => setDraft((current) => ({ ...current, logoUrl: '', iconUrl: '' }))}><RotateCcw className="size-3.5" />使用内置品牌图片</ControlButton>
              <p className="text-xs leading-5 text-muted-foreground">右侧为尚未保存的预览。自定义图片保留原色，请同时检查浅色与深色背景。</p>
            </fieldset>
            <aside aria-label="品牌实时预览" className="min-w-0 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">实时预览</p>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="space-y-5 bg-white px-5 py-4 text-zinc-900"><span className="text-[11px] text-zinc-500">浅色背景</span><div className="min-h-8"><SiteBrand site={draft} tone="light" imageClassName="h-8 max-w-[200px] w-auto" /></div><p className="truncate text-xs">{draft.title || 'OAO'} · 管理后台</p></div>
                <div className="space-y-5 bg-zinc-950 px-5 py-4 text-zinc-100"><span className="text-[11px] text-zinc-400">深色背景</span><div className="min-h-8"><SiteBrand site={draft} tone="dark" imageClassName="h-8 max-w-[200px] w-auto" /></div><p className="truncate text-xs">{draft.title || 'OAO'} · 创作工作台</p></div>
              </div>
              <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5"><SiteBrand site={draft} variant="icon" imageClassName="size-5" /><span className="truncate text-xs">{draft.title || 'OAO'} · 浏览器标签页</span></div>
              <SiteBrand site={draft} showFallbackNotice imageClassName="hidden" className="text-xs" />
              <SiteBrand site={draft} variant="icon" showFallbackNotice imageClassName="hidden" className="text-xs" />
            </aside>
          </div>
        </AdminSectionCard>
      </div>

      <div hidden={active !== 'search'}>
        <AdminSectionCard title="搜索信息" description="维护站点对外展示的搜索标题与介绍。">
          <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
            <AdminField label="搜索标题"><AdminInput {...field('seoTitle')} /></AdminField>
            <AdminField label="搜索关键词"><AdminInput {...field('seoKeywords')} /></AdminField>
            <AdminField label="搜索描述" className="sm:col-span-2"><AdminTextarea {...field('seoDescription')} rows={3} /></AdminField>
          </fieldset>
        </AdminSectionCard>
      </div>

      <div hidden={active !== 'policies'} className="space-y-4">
        {(['terms', 'privacy'] as const).map((kind) => (
          <AdminSectionCard key={kind} title={kind === 'terms' ? '服务条款' : '隐私政策'} description="使用站内政策页时，需填写版本及正式正文。" action={<Link href={`/${kind}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">查看已发布页面<ExternalLink className="size-3.5" /></Link>}>
            <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
              <AdminField label="页面地址"><AdminInput {...field(`${kind}Url`)} placeholder={`/${kind}`} /></AdminField>
              <AdminField label="政策版本"><AdminInput {...field(`${kind}Version`)} /></AdminField>
              <AdminField label={kind === 'terms' ? '服务条款正文' : '隐私政策正文'} className="sm:col-span-2"><AdminTextarea {...field(`${kind}Content`)} rows={12} /></AdminField>
            </fieldset>
          </AdminSectionCard>
        ))}
      </div>

      <div hidden={active !== 'footer'}><AdminSiteFooter value={draft.footer} site={draft} disabled={saving} onChange={footer => setDraft(current => ({ ...current, footer }))} /></div>

      <AdminSaveBar hint={dirty ? `待保存：${[...changed.map((key) => labels[key]), ...(footerChanged ? ['页脚'] : [])].join('、')}` : '品牌与页脚预览使用同一套公开配置；首页横幅请在内容与公告中管理。'}>
        {dirty && <ControlButton type="button" disabled={saving} onClick={() => { setDraft(original); setError('') }}>撤销更改</ControlButton>}
        <ControlButton type="submit" variant="primary" disabled={saving || !dirty}><Save className="size-3.5" />{saving ? '保存中' : '保存站点设置'}</ControlButton>
      </AdminSaveBar>
    </form>
  )
}
