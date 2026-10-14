'use client'

import { useId, useState } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { SiteAnnouncementBar } from '@/components/site-announcement-bar'
import {
  announcementEffects,
  announcementTones,
  normalizeAnnouncementEffect,
  type AnnouncementEffect,
  type AnnouncementTone,
} from '@/lib/studio/announcement-appearance'
import { cn } from '@/lib/utils'
import { AdminField, AdminSelect } from './admin-kit'

const showDetailsPreview = () => {}

export function AdminAnnouncementAppearance({ tone, effect, onToneChange, onEffectChange, text, description, href, dismissible = true, hasDetails = false, disabled = false }: {
  tone: AnnouncementTone
  effect: AnnouncementEffect
  onToneChange: (tone: AnnouncementTone) => void
  onEffectChange: (effect: AnnouncementEffect) => void
  text: string
  description?: string
  href?: string
  dismissible?: boolean
  hasDetails?: boolean
  disabled?: boolean
}) {
  const colorGroup = useId()
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')

  return (
    <section className="min-w-0 space-y-4" aria-label="横幅外观与预览">
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">横幅配色</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {announcementTones.map((option) => (
            <label key={option.value} className="min-w-0 cursor-pointer">
              <input type="radio" name={colorGroup} value={option.value} checked={tone === option.value} onChange={() => onToneChange(option.value)} className="peer sr-only" />
              <span className={cn('flex h-full flex-col gap-2 rounded-lg border p-2 text-center text-xs transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-studio-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-60', tone === option.value ? 'border-studio-accent bg-studio-accent/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50')}>
                <span aria-hidden="true" className={cn('h-5 w-full rounded-md', `oao-announcement-${option.value}`)} style={{ background: 'linear-gradient(112deg, var(--notice-start), var(--notice-end))' }} />
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <AdminField label="动态效果" hint="动效只装饰横幅背景，保持文字清晰；访客开启减少动态效果时会自动静止。">
        <AdminSelect disabled={disabled} value={effect} onChange={(event) => onEffectChange(normalizeAnnouncementEffect(event.target.value))}>
          {announcementEffects.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </AdminSelect>
      </AdminField>
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-muted/20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <span className="text-xs font-medium">实时预览</span>
          <div role="group" aria-label="横幅预览尺寸" className="flex rounded-lg border border-border bg-card p-0.5">
            {([['desktop', '桌面', Monitor], ['mobile', '手机', Smartphone]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" aria-pressed={viewport === value} disabled={disabled} onClick={() => setViewport(value)} className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-accent disabled:opacity-50', viewport === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}><Icon className="size-3.5" aria-hidden="true" />{label}</button>
            ))}
          </div>
        </div>
        <div className="p-3">
          <div className={cn('mx-auto w-full overflow-hidden rounded-lg border border-border bg-card', viewport === 'mobile' && 'max-w-[390px]')} style={{ containerType: 'inline-size', containerName: 'announcement-preview' }}>
            <SiteAnnouncementBar
              preview
              announcement={{ enabled: true, text: text.trim() || '公告标题会显示在这里', tone, effect, href, dismissible }}
              description={description?.replace(/\s+/g, ' ').trim()}
              onOpen={hasDetails ? showDetailsPreview : undefined}
            />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">预览随编辑同步，并按屏幕宽度适配。保存前不会影响线上展示。</p>
        </div>
      </div>
    </section>
  )
}
