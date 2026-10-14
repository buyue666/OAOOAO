import { safeAnnouncementHref } from './announcements'

export type SiteFooterLink = { label: string; url: string }
export type SiteFooterSettings = {
  showOnStudio: boolean
  description: string
  copyrightHolder: string
  registrationLabel: string
  registrationUrl: string
  contactEmail: string
  contactUrl: string
  socialLinks: SiteFooterLink[]
  productLinks: SiteFooterLink[]
}

export const DEFAULT_FOOTER_DESCRIPTION = '把想法变成画面、镜头与故事。为下一次灵感，留一片自由的空间。'
export const DEFAULT_FOOTER_PRODUCTS: SiteFooterLink[] = [
  { label: '图片生成', url: '/image' }, { label: '视频生成', url: '/video' },
  { label: '自由画布', url: '/canvas' }, { label: '创作助手', url: '/agent' },
  { label: '积分超市', url: '/credits' },
]
export const FOOTER_LINK_LIMIT = 8
export const safeFooterHref = (value: unknown) => typeof value === 'string' ? safeAnnouncementHref(value) : ''
export function safeFooterEmail(value: unknown) {
  if (typeof value !== 'string') return ''
  const email = value.trim()
  return email.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email) ? email : ''
}

const text = (value: unknown, limit: number, fallback = '') => typeof value === 'string' ? value.trim().slice(0, limit) : fallback
function links(value: unknown, fallback: SiteFooterLink[] = []): SiteFooterLink[] {
  if (!Array.isArray(value)) return fallback.map(item => ({ ...item }))
  return value.slice(0, FOOTER_LINK_LIMIT).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const label = text(item.label, 40), url = safeFooterHref(item.url)
    return label && url ? [{ label, url }] : []
  })
}

/** Public reads are tolerant of old settings; absent fields get honest defaults. */
export function normalizeSiteFooter(value: unknown): SiteFooterSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    showOnStudio: input.showOnStudio === true,
    description: text(input.description, 500, DEFAULT_FOOTER_DESCRIPTION),
    copyrightHolder: text(input.copyrightHolder, 160),
    registrationLabel: text(input.registrationLabel, 160),
    registrationUrl: safeFooterHref(input.registrationUrl),
    contactEmail: input.contactEmail === undefined ? 'siyuesy@gmail.com' : safeFooterEmail(input.contactEmail),
    contactUrl: safeFooterHref(input.contactUrl),
    socialLinks: links(input.socialLinks),
    productLinks: links(input.productLinks, DEFAULT_FOOTER_PRODUCTS),
  }
}

/** Never silently drop an administrator's incomplete or unsafe draft on save. */
export function validateSiteFooter(input: SiteFooterSettings): string | null {
  for (const [key, label, limit] of [['description', '品牌介绍', 500], ['copyrightHolder', '版权主体', 160], ['registrationLabel', '备案号', 160]] as const) {
    if (input[key].trim().length > limit) return `${label}最多 ${limit} 个字符。`
  }
  if (input.contactEmail.trim() && !safeFooterEmail(input.contactEmail)) return '请填写有效的联系邮箱，或留空隐藏。'
  for (const [key, label] of [['registrationUrl', '备案链接'], ['contactUrl', '联系页面']] as const) {
    if (input[key].trim() && !safeFooterHref(input[key])) return `${label}请使用站内路径或完整的 HTTP(S) 地址。`
  }
  if (input.registrationUrl.trim() && !input.registrationLabel.trim()) return '填写备案链接时，请同时填写真实备案号。'
  for (const [key, label] of [['productLinks', '产品链接'], ['socialLinks', '社媒链接']] as const) {
    if (input[key].length > FOOTER_LINK_LIMIT) return `${label}最多 ${FOOTER_LINK_LIMIT} 项。`
    for (const [index, item] of input[key].entries()) {
      if (!item.label.trim() || item.label.trim().length > 40) return `${label}第 ${index + 1} 项需要 1–40 个字符的名称。`
      if (!safeFooterHref(item.url)) return `${label}第 ${index + 1} 项请填写站内路径或完整的 HTTP(S) 地址。`
    }
  }
  return null
}
