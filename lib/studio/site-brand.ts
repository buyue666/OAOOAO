export type SiteBrandInput = { title?: unknown; logoUrl?: unknown; iconUrl?: unknown }

export const DEFAULT_SITE_TITLE = 'OAO'
export const DEFAULT_SITE_LOGO = '/media/brand/oao-logo-transparent.png'
export const DEFAULT_SITE_ICON = '/media/brand/oao-mark.png'

/** Only persistent HTTP(S) or same-origin paths can be used as configured images. */
export function safeBrandImageUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (!url || url.length > 4000 || /[\\\u0000-\u001f\u007f]/.test(url)) return ''
  if (url.startsWith('/')) return url.startsWith('//') ? '' : url
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : ''
  } catch { return '' }
}

export function brandSettingsFields(site?: SiteBrandInput) {
  return {
    title: typeof site?.title === 'string' ? site.title.trim().slice(0, 160) : '',
    logoUrl: typeof site?.logoUrl === 'string' ? site.logoUrl.trim().slice(0, 4000) : '',
    iconUrl: typeof site?.iconUrl === 'string' ? site.iconUrl.trim().slice(0, 4000) : '',
  }
}

export function resolveSiteBrand(site?: SiteBrandInput) {
  const fields = brandSettingsFields(site)
  const logo = safeBrandImageUrl(fields.logoUrl)
  const icon = safeBrandImageUrl(fields.iconUrl)
  // These exact paths were shipped as old defaults, not customer assets.
  const legacyLogo = logo === '/logo.svg'
  const legacyIcon = icon === '/icon.svg'
  const logoUrl = logo && !legacyLogo ? logo : DEFAULT_SITE_LOGO
  const iconUrl = icon && !legacyIcon ? icon : DEFAULT_SITE_ICON
  return {
    title: fields.title || DEFAULT_SITE_TITLE,
    logoUrl, iconUrl,
    customLogo: logoUrl !== DEFAULT_SITE_LOGO,
    customIcon: iconUrl !== DEFAULT_SITE_ICON,
    logoFallbackReason: legacyLogo ? 'legacy' : fields.logoUrl && !logo ? 'invalid' : '',
    iconFallbackReason: legacyIcon ? 'legacy' : fields.iconUrl && !icon ? 'invalid' : '',
  }
}

/** `light` and `dark` describe the background, never the desired image color. */
export function defaultBrandFilter(tone: 'theme' | 'light' | 'dark', custom: boolean) {
  return custom || tone === 'light' ? '' : tone === 'dark' ? 'invert' : 'dark:invert'
}
