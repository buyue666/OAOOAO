export type CommercePolicy = {
  version: string
  status: 'draft' | 'published'
  refundPolicy: string
  pointsExpiryPolicy: string
  renewalPolicy: string
  invoicePolicy: string
  supportEmail: string
  supportUrl: string
}

export type CommerceLegalSettings = {
  termsUrl: string
  termsVersion: string
  termsContent: string
  privacyUrl: string
  privacyVersion: string
  privacyContent: string
}

export type PurchaseReadiness = { ready: boolean; missing: string[] }

export const DEFAULT_COMMERCE_POLICY: CommercePolicy = {
  version: '',
  status: 'draft',
  refundPolicy: '',
  pointsExpiryPolicy: '',
  renewalPolicy: '',
  invoicePolicy: '',
  supportEmail: '',
  supportUrl: '',
}

const policyLabels = {
  version: '购买政策版本',
  refundPolicy: '退款规则',
  pointsExpiryPolicy: '积分有效期规则',
  renewalPolicy: '续费规则',
  invoicePolicy: '发票规则',
} as const

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeCommercePolicy(value: Partial<CommercePolicy> | undefined): CommercePolicy {
  return {
    version: text(value?.version),
    status: value?.status === 'published' ? 'published' : 'draft',
    refundPolicy: text(value?.refundPolicy),
    pointsExpiryPolicy: text(value?.pointsExpiryPolicy),
    renewalPolicy: text(value?.renewalPolicy),
    invoicePolicy: text(value?.invoicePolicy),
    supportEmail: text(value?.supportEmail),
    supportUrl: text(value?.supportUrl),
  }
}

export function isHttpsPolicyUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

export function isSupportEmail(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
}

export function getPurchaseReadiness(site: Partial<CommerceLegalSettings>, policyValue: Partial<CommercePolicy> | undefined, requirePublished = true): PurchaseReadiness {
  const policy = normalizeCommercePolicy(policyValue)
  const missing: string[] = []
  if (requirePublished && policy.status !== 'published') missing.push('购买政策尚未发布')
  for (const key of Object.keys(policyLabels) as Array<keyof typeof policyLabels>) {
    if (!policy[key]) missing.push(`未配置${policyLabels[key]}`)
  }
  if (!isSupportEmail(policy.supportEmail) && !isHttpsPolicyUrl(policy.supportUrl)) missing.push('未配置有效客服渠道')
  for (const kind of ['terms', 'privacy'] as const) {
    const label = kind === 'terms' ? '服务条款' : '隐私政策'
    const url = text(site[`${kind}Url` as keyof CommerceLegalSettings])
    if (!text(site[`${kind}Version` as keyof CommerceLegalSettings])) missing.push(`未配置${label}版本`)
    if (url === `/${kind}`) {
      if (!text(site[`${kind}Content` as keyof CommerceLegalSettings])) missing.push(`未配置${label}正式正文`)
    } else if (!isHttpsPolicyUrl(url)) {
      missing.push(`未配置${label}正式地址`)
    }
  }
  return { ready: missing.length === 0, missing }
}

export function hasCommercePolicyChanged(current: CommercePolicy, next: CommercePolicy) {
  return (Object.keys(policyLabels) as Array<keyof typeof policyLabels>).some((key) => next[key] !== current[key])
}

export function hasLegalSettingsChanged(current: Partial<CommerceLegalSettings>, next: Partial<CommerceLegalSettings>) {
  return (['termsUrl', 'termsVersion', 'termsContent', 'privacyUrl', 'privacyVersion', 'privacyContent'] as const)
    .some((key) => text(current[key]) !== text(next[key]))
}
