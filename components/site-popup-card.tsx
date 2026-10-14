'use client'

import { useState } from 'react'
import { ArrowUpRight, ImageOff } from 'lucide-react'
import { SiteBrand } from '@/components/site-brand'
import { safeAnnouncementHref } from '@/lib/studio/announcements'
import { safePopupImageUrl, type SitePopup } from '@/lib/studio/site-popups'

export function SitePopupCard({ popup, preview = false, onAction }: { popup: Pick<SitePopup, 'title' | 'content' | 'imageUrl' | 'actionUrl' | 'buttonText'>; preview?: boolean; onAction?: () => void }) {
  const imageUrl = safePopupImageUrl(popup.imageUrl)
  const href = safeAnnouncementHref(popup.actionUrl)
  const [failedImage, setFailedImage] = useState('')
  const actionClass = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-default disabled:opacity-70'
  return <div className={`grid overflow-hidden rounded-3xl bg-card text-card-foreground ${imageUrl ? 'sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]' : ''}`}>
    {imageUrl && <div className="relative flex min-h-40 items-center justify-center bg-muted p-3 sm:min-h-80">
      {failedImage === imageUrl ? <div role="status" className="flex flex-col items-center gap-2 p-5 text-center text-xs text-muted-foreground"><ImageOff className="size-8" aria-hidden="true" />图片暂时无法加载</div>
        : <img src={imageUrl} alt={popup.title || '活动图片'} referrerPolicy="no-referrer" onError={() => setFailedImage(imageUrl)} className="max-h-[35dvh] w-full rounded-2xl object-contain sm:max-h-[65dvh]" />}
    </div>}
    <div className="flex min-w-0 flex-col gap-5 p-6 pt-10 sm:p-8 sm:pt-10">
      <SiteBrand className="h-7 w-24" />
      <h2 className="break-words text-2xl font-semibold leading-tight tracking-tight">{popup.title || '弹窗标题'}</h2>
      {popup.content && <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{popup.content}</p>}
      <div className="mt-auto pt-3">
        {href ? preview ? <button type="button" disabled className={actionClass}><span className="min-w-0 break-words [overflow-wrap:anywhere]">{popup.buttonText || '查看详情'}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></button>
          : <a href={href} target={/^https?:\/\//i.test(href) ? '_blank' : undefined} rel={/^https?:\/\//i.test(href) ? 'noopener noreferrer' : undefined} onClick={onAction} className={actionClass}><span className="min-w-0 break-words [overflow-wrap:anywhere]">{popup.buttonText || '查看详情'}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></a>
          : <button type="button" disabled={preview} onClick={onAction} className={actionClass}>知道了</button>}
      </div>
    </div>
  </div>
}
