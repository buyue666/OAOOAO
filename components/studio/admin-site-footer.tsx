'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react'
import { SiteFooter } from '@/components/site-footer'
import type { SiteSettings } from '@/lib/studio/admin-types'
import { FOOTER_LINK_LIMIT, SITE_SOURCE_REPOSITORY, type SiteFooterLink, type SiteFooterSettings } from '@/lib/studio/site-footer'
import { AdminField, AdminInput, AdminSectionCard, AdminTextarea } from './admin-kit'
import { ControlButton } from './ui'

export function AdminSiteFooter({ value, site, disabled, onChange }: { value: SiteFooterSettings; site: SiteSettings; disabled: boolean; onChange: (value: SiteFooterSettings) => void }) {
  const [mobile, setMobile] = useState(false)
  const [placement, setPlacement] = useState<'landing' | 'studio'>('landing')
  const field = (key: 'description' | 'copyrightHolder' | 'registrationLabel' | 'registrationUrl' | 'contactEmail' | 'contactUrl') => ({ value: value[key], name: `footer.${key}`, onChange: (event: { target: { value: string } }) => onChange({ ...value, [key]: event.target.value }) })
  return <div className="space-y-5">
    <AdminSectionCard title="页脚信息" description="官网着陆页始终显示；可另外显示在开始创作主页。品牌名称和 Logo 跟随上方品牌设置。">
      <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm sm:col-span-2"><input type="checkbox" checked={value.showOnStudio} onChange={event => onChange({ ...value, showOnStudio: event.target.checked })} />也在开始创作主页（/studio）显示</label>
        <AdminField label="品牌介绍" hint="留空隐藏介绍。" className="sm:col-span-2"><AdminTextarea {...field('description')} rows={3} maxLength={500} /></AdminField>
        <AdminField label="版权主体" hint="留空跟随站点名称，年份会自动更新。"><AdminInput {...field('copyrightHolder')} maxLength={160} placeholder="跟随站点名称" /></AdminField>
        <AdminField label="联系邮箱" hint="留空隐藏邮箱。"><AdminInput {...field('contactEmail')} maxLength={254} inputMode="email" placeholder="siyuesy@gmail.com" /></AdminField>
        <AdminField label="备案号" hint="仅填写本站实际备案信息；未备案请留空。"><AdminInput {...field('registrationLabel')} maxLength={160} placeholder="留空不显示" /></AdminField>
        <AdminField label="备案查询链接" hint="请填写实际备案查询地址。"><AdminInput {...field('registrationUrl')} maxLength={2048} placeholder="https://…" /></AdminField>
        <AdminField label="联系页面或客服网址" hint="支持 /contact 等站内路径或完整 HTTP(S) 地址；留空不显示。" className="sm:col-span-2"><AdminInput {...field('contactUrl')} maxLength={2048} placeholder="https://…" /></AdminField>
      </fieldset>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">服务条款与隐私政策使用“条款与隐私”中的页面地址，留空时使用本站独立协议页面。</p>
      <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">GitHub 仓库链接固定显示在备案信息旁；未填写备案号时仍会显示，不受产品和社媒链接配置影响。仓库：{SITE_SOURCE_REPOSITORY}。</p>
    </AdminSectionCard>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <FooterLinksEditor title="产品与创作链接" name="productLinks" value={value.productLinks} disabled={disabled} onChange={productLinks => onChange({ ...value, productLinks })} />
      <FooterLinksEditor title="社媒链接" name="socialLinks" value={value.socialLinks} disabled={disabled} onChange={socialLinks => onChange({ ...value, socialLinks })} />
    </div>
    <AdminSectionCard title="页脚实时预览" description="预览使用当前未保存的内容，链接不会跳转。完整网址在正式页中会打开新窗口。">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="预览页面" className="flex gap-1"><ControlButton size="sm" type="button" aria-pressed={placement === 'landing'} onClick={() => setPlacement('landing')}>官网着陆页</ControlButton><ControlButton size="sm" type="button" aria-pressed={placement === 'studio'} onClick={() => setPlacement('studio')}>开始创作主页</ControlButton></div>
        <div role="group" aria-label="预览宽度" className="flex gap-1"><ControlButton size="sm" type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor className="size-3.5" />宽屏</ControlButton><ControlButton size="sm" type="button" aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone className="size-3.5" />手机</ControlButton></div>
      </div>
      {placement === 'studio' && !value.showOnStudio && <p className="mb-3 text-xs text-muted-foreground">当前未开启主页展示；下面仅预览开启后的效果。</p>}
      <div className="mx-auto min-w-0 overflow-hidden rounded-xl border border-border" style={{ maxWidth: mobile ? 390 : undefined }}><SiteFooter site={{ ...site, footer: value }} placement={placement} preview /></div>
    </AdminSectionCard>
  </div>
}

function FooterLinksEditor({ title, name, value, disabled, onChange }: { title: string; name: 'productLinks' | 'socialLinks'; value: SiteFooterLink[]; disabled: boolean; onChange: (items: SiteFooterLink[]) => void }) {
  const update = (index: number, key: keyof SiteFooterLink, text: string) => onChange(value.map((item, at) => at === index ? { ...item, [key]: text } : item))
  const move = (index: number, offset: number) => {
    const next = [...value]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next)
  }
  return <AdminSectionCard title={title} description={`最多 ${FOOTER_LINK_LIMIT} 项；不填写或移除所有项时，该栏目不显示。`}>
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      {!value.length && <p className="rounded-lg border border-dashed border-border px-3 py-5 text-xs text-muted-foreground">尚未添加链接</p>}
      {value.map((item, index) => <div key={index} className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">链接 {index + 1}</span><span className="flex gap-1"><ControlButton type="button" size="sm" aria-label={`${title}第 ${index + 1} 项上移`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-3" /></ControlButton><ControlButton type="button" size="sm" aria-label={`${title}第 ${index + 1} 项下移`} disabled={index === value.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-3" /></ControlButton><ControlButton type="button" size="sm" aria-label={`删除${title}第 ${index + 1} 项`} onClick={() => onChange(value.filter((_, at) => at !== index))}><Trash2 className="size-3" /></ControlButton></span></div>
        <AdminField label="名称"><AdminInput name={`footer.${name}.${index}.label`} value={item.label} maxLength={40} onChange={event => update(index, 'label', event.target.value)} /></AdminField>
        <AdminField label="跳转地址"><AdminInput name={`footer.${name}.${index}.url`} value={item.url} maxLength={2048} placeholder="/image 或 https://…" onChange={event => update(index, 'url', event.target.value)} /></AdminField>
      </div>)}
      <ControlButton type="button" size="sm" disabled={value.length >= FOOTER_LINK_LIMIT} onClick={() => onChange([...value, { label: '', url: '' }])}><Plus className="size-3.5" />添加链接</ControlButton>
    </fieldset>
  </AdminSectionCard>
}
