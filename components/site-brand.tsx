'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useStudio } from '@/lib/studio/store'
import { DEFAULT_SITE_ICON, DEFAULT_SITE_LOGO, defaultBrandFilter, resolveSiteBrand, type SiteBrandInput } from '@/lib/studio/site-brand'

export type SiteBrandProps = {
  site?: SiteBrandInput
  variant?: 'logo' | 'icon'
  /** Background tone: light = black default mark; dark = white default mark. */
  tone?: 'theme' | 'light' | 'dark'
  showTitle?: boolean
  showFallbackNotice?: boolean
  className?: string
  imageClassName?: string
}

export function useSiteBrand() {
  const { state } = useStudio()
  return resolveSiteBrand(state.sessionSettings?.site)
}

/** Public branding updates browser chrome too; no administrator-only settings enter the DOM. */
export function SiteBrandMetadata() {
  const { title, iconUrl, customIcon } = useSiteBrand()
  const pathname = usePathname()
  useEffect(() => {
    document.title = `${title} · ${pathname.startsWith('/admin') ? '管理后台' : pathname === '/' ? '图片、视频与故事创作' : 'AI 创作工作台'}`
    let active = true
    function setIcon(url: string) {
      const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]'))
      if (!links.length) {
        const link = document.createElement('link')
        link.rel = 'icon'; link.dataset.siteBrandIcon = 'true'; document.head.appendChild(link); links.push(link)
      }
      for (const link of links) { link.href = url; link.removeAttribute('type'); link.removeAttribute('sizes') }
    }
    setIcon(iconUrl)
    const probe = customIcon ? new window.Image() : null
    if (probe) { probe.onerror = () => { if (active) setIcon(DEFAULT_SITE_ICON) }; probe.src = iconUrl }
    return () => { active = false; if (probe) probe.onerror = null }
  }, [title, iconUrl, customIcon, pathname])
  return null
}

export function SiteBrand({ site, variant = 'logo', tone = 'theme', showTitle = false, showFallbackNotice = false, className, imageClassName }: SiteBrandProps) {
  const current = useSiteBrand()
  const brand = site === undefined ? current : resolveSiteBrand(site)
  const source = variant === 'logo' ? brand.logoUrl : brand.iconUrl
  const custom = variant === 'logo' ? brand.customLogo : brand.customIcon
  const reason = variant === 'logo' ? brand.logoFallbackReason : brand.iconFallbackReason
  return <BrandImage key={`${variant}:${source}`} source={source} fallback={variant === 'logo' ? DEFAULT_SITE_LOGO : DEFAULT_SITE_ICON} custom={custom} title={brand.title} reason={reason} variant={variant} tone={tone} showTitle={showTitle} showFallbackNotice={showFallbackNotice} className={className} imageClassName={imageClassName} />
}

function BrandImage({ source, fallback, custom, title, reason, variant, tone, showTitle, showFallbackNotice, className, imageClassName }: Omit<SiteBrandProps, 'site'> & { source: string; fallback: string; custom: boolean; title: string; reason: string; variant: 'logo' | 'icon'; tone: 'theme' | 'light' | 'dark' }) {
  const [failed, setFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const usingCustom = custom && !failed
  const fallbackMessage = failed ? '品牌图片加载失败，已使用默认品牌。' : reason === 'legacy' ? '旧默认地址已兼容为当前品牌。' : reason === 'invalid' ? '图片地址无效，已使用默认品牌。' : ''
  return <span className={cn('inline-flex min-w-0 max-w-full items-center gap-2', className)} title={title} data-site-brand={variant} data-brand-fallback={failed || Boolean(reason) ? 'true' : undefined}>
    {!fallbackFailed ? <img
      src={usingCustom ? source : fallback}
      alt={showTitle ? '' : title}
      aria-hidden={showTitle ? true : undefined}
      className={cn(variant === 'icon' ? 'size-8 shrink-0 object-contain' : 'h-7 w-auto max-w-[160px] shrink-0 object-contain', defaultBrandFilter(tone, usingCustom), imageClassName)}
      onError={() => { if (usingCustom) setFailed(true); else setFallbackFailed(true) }}
    /> : !showTitle ? <span className="truncate text-sm font-semibold">{title}</span> : null}
    {showTitle && <span className="min-w-0 truncate text-sm font-semibold">{title}</span>}
    {showFallbackNotice && fallbackMessage && <span role="status" className="text-xs text-muted-foreground">{fallbackMessage}</span>}
  </span>
}
