'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowUpRight, Mail } from 'lucide-react'
import GithubOutlined from '@ant-design/icons/lib/icons/GithubOutlined'
import { useStudio } from '@/lib/studio/store'
import { useLocale } from '@/lib/studio/i18n'
import { resolveSiteBrand, type SiteBrandInput } from '@/lib/studio/site-brand'
import { DEFAULT_FOOTER_DESCRIPTION, SITE_SOURCE_REPOSITORY, normalizeSiteFooter, safeFooterHref, type SiteFooterSettings } from '@/lib/studio/site-footer'
import { SiteBrand } from './site-brand'
import styles from './site-footer.module.css'

type FooterSite = SiteBrandInput & { footer?: Partial<SiteFooterSettings>; termsUrl?: unknown; privacyUrl?: unknown }

export function SiteFooter({ placement = 'landing', site, preview = false }: { placement?: 'landing' | 'studio'; site?: FooterSite; preview?: boolean }) {
  const { state } = useStudio()
  const { locale, t } = useLocale()
  const current = site ?? state.sessionSettings?.site
  const footer = normalizeSiteFooter(current?.footer)
  const brand = resolveSiteBrand(current)
  const english = locale === 'en-US'
  if (placement === 'studio' && !footer.showOnStudio && !preview) return null
  const description = footer.description === DEFAULT_FOOTER_DESCRIPTION ? t('footerDescription') : footer.description
  return <footer className={styles.footer} data-tone={placement === 'landing' ? 'light' : 'theme'} data-site-footer={placement} aria-label={english ? 'Platform information' : '平台信息'}>
    <div className={styles.grid}>
      <div className={styles.brand}>
        <FooterLink href="/" preview={preview}><SiteBrand site={current} tone={placement === 'landing' ? 'light' : 'theme'} imageClassName="h-8 max-w-[180px]" /></FooterLink>
        <span className={styles.brandName}>{brand.title}</span>
        {description && <p>{description}</p>}
        <p className={styles.copyright}>© {new Date().getFullYear()} {footer.copyrightHolder || brand.title}</p>
        <p className={styles.registration}>
          {footer.registrationLabel && <span className={styles.registrationNumber}>{footer.registrationUrl ? <FooterLink href={footer.registrationUrl} preview={preview}>{footer.registrationLabel}</FooterLink> : footer.registrationLabel}</span>}
          <FooterLink href={SITE_SOURCE_REPOSITORY} preview={preview}><GithubOutlined style={{ fontSize: 14 }} aria-hidden="true" />{english ? 'GitHub repository' : 'GitHub 仓库'}</FooterLink>
        </p>
      </div>
      {footer.productLinks.length > 0 && <FooterColumn title={english ? 'Create with us' : '产品与创作'}>{footer.productLinks.map((item, index) => <li key={`${index}:${item.url}`}><FooterLink href={item.url} preview={preview}>{item.label}</FooterLink></li>)}</FooterColumn>}
      <FooterColumn title={english ? 'Platform policies' : '平台协议'}>
        <li><FooterLink href={safeFooterHref(current?.termsUrl) || '/terms'} preview={preview}>{english ? 'Terms of service' : '服务条款'}</FooterLink></li>
        <li><FooterLink href={safeFooterHref(current?.privacyUrl) || '/privacy'} preview={preview}>{english ? 'Privacy policy' : '隐私政策'}</FooterLink></li>
      </FooterColumn>
      {(footer.contactEmail || footer.contactUrl || footer.socialLinks.length > 0) && <FooterColumn title={english ? 'Contact us' : '联系我们'}>
        {footer.contactEmail && <li><FooterLink href={`mailto:${encodeURIComponent(footer.contactEmail)}`} preview={preview}><Mail size={14} aria-hidden="true" />{footer.contactEmail}</FooterLink></li>}
        {footer.contactUrl && <li><FooterLink href={footer.contactUrl} preview={preview}>{english ? 'Get in touch' : '联系与支持'}<ArrowUpRight size={13} aria-hidden="true" /></FooterLink></li>}
        {footer.socialLinks.map((item, index) => <li key={`${index}:${item.url}`}><FooterLink href={item.url} preview={preview}>{item.label}<ArrowUpRight size={13} aria-hidden="true" /></FooterLink></li>)}
      </FooterColumn>}
    </div>
  </footer>
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.column}><h2>{title}</h2><ul>{children}</ul></div>
}

function FooterLink({ href, preview, children }: { href: string; preview: boolean; children: ReactNode }) {
  if (preview) return <span className={styles.link} title={`预览链接：${href}`}>{children}</span>
  const external = /^https?:\/\//i.test(href)
  return href.startsWith('/') ? <Link href={href} className={styles.link}>{children}</Link> : <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className={styles.link}>{children}</a>
}
