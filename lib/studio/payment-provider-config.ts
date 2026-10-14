import type { AdminPaymentConfigField, AdminPaymentConfigSummary, AdminPaymentProviderConfig } from './admin-types'

const supportedKinds = new Set(['text', 'url', 'secret', 'textarea', 'select'])
export const paymentProviderName = (provider: AdminPaymentProviderConfig) => ({ manual: '人工收款', epay: '易支付', alipay: '支付宝', wechat: '微信支付', stripe: '银行卡支付' }[provider.id] || provider.name)
export function canConfigureOnlinePayment(provider?: AdminPaymentProviderConfig): provider is AdminPaymentProviderConfig {
  return !!provider && provider.id === 'epay' && ['form', 'redirect', 'qr'].includes(provider.checkoutKind)
    && Array.isArray(provider.fields) && ['gatewayUrl', 'pid', 'protocol', 'paymentType'].every(key => provider.fields.some(field => field.key === key))
    && provider.fields.every(field => supportedKinds.has(field.kind))
}
export function paymentFieldLabel(field: AdminPaymentConfigField) {
  return ({ gatewayUrl: '支付网关地址', pid: '商户编号', protocol: '签名协议', paymentType: '默认付款方式', key: '商户密钥（MD5）', merchantPrivateKey: '商户私钥（RSA）', platformPublicKey: '平台公钥（RSA）' } as Record<string, string>)[field.key] || field.label
}
export function paymentOptionLabel(value: string, fallback: string) {
  return ({ v2_rsa: '易支付 V2 · RSA 签名', v1_md5: '易支付 V1 · MD5 签名', cashier: '收银台（用户自行选择）', alipay: '支付宝', wxpay: '微信支付' } as Record<string, string>)[value] || fallback
}
export function paymentValues(provider: AdminPaymentProviderConfig): Record<string, string> {
  return Object.fromEntries(provider.fields.map(field => [field.key, field.secret || field.kind === 'secret' ? '' : field.value ?? '']))
}
export function paymentFieldVisible(field: AdminPaymentConfigField, values: Record<string, string>) {
  if (field.key === 'key') return values.protocol === 'v1_md5'
  if (field.key === 'merchantPrivateKey' || field.key === 'platformPublicKey') return values.protocol === 'v2_rsa'
  return true
}
export function paymentProviderInput(provider: AdminPaymentProviderConfig, enabled: boolean, draft: Record<string, string>) {
  if (!canConfigureOnlinePayment(provider)) throw new Error('当前渠道尚未提供可用的配置定义，请重新读取。')
  const values: Record<string, string> = {}
  for (const field of provider.fields) {
    if (!paymentFieldVisible(field, draft)) continue
    let value = (draft[field.key] ?? '').trim()
    const secret = field.secret || field.kind === 'secret'
    const required = field.required || ['key', 'merchantPrivateKey', 'platformPublicKey'].includes(field.key)
    if (value.length > 16000) throw new Error(`${paymentFieldLabel(field)} 内容过长。`)
    if (enabled && required && !value && !(secret && field.configured)) throw new Error(`启用前请填写${paymentFieldLabel(field)}。`)
    if (field.kind === 'select' && !field.options?.some(option => option.value === value)) throw new Error(`请选择有效的${paymentFieldLabel(field)}。`)
    if (field.kind === 'url' && value) {
      let url: URL
      try { url = new URL(value) } catch { throw new Error('请填写完整的 HTTPS 支付网关地址。') }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || /[\\\u0000-\u0020\u007f]/.test(value) || /\/(submit\.php|mapi\.php|api\/pay\/submit)\/?$/i.test(url.pathname)) throw new Error('请填写 HTTPS 网关根地址，不要包含账户密码、查询参数、片段或支付接口路径。')
      value = url.href.replace(/\/*$/, '/')
    }
    if (field.key === 'pid' && value && !/^[1-9]\d{0,19}$/.test(value)) throw new Error('商户编号应为支付平台提供的正整数编号。')
    if (!secret || value) values[field.key] = value
  }
  return { providerId: provider.id, enabled, values }
}
export function assertPaymentProviderSaved(payload: unknown, expected: ReturnType<typeof paymentProviderInput>): asserts payload is AdminPaymentConfigSummary {
  const providers = (payload as Partial<AdminPaymentConfigSummary> | null)?.providers
  const matches = Array.isArray(providers) ? providers.filter(item => item.id === expected.providerId) : []
  const saved = matches.length === 1 ? matches[0] : undefined
  if (!canConfigureOnlinePayment(saved) || saved.enabled !== expected.enabled || (!expected.enabled && saved.ready)) throw new Error('服务端未确认支付渠道配置，请重新读取后核对。')
  for (const [key, value] of Object.entries(expected.values)) {
    const field = saved.fields.find(item => item.key === key)
    if (!field || (field.secret || field.kind === 'secret' ? !field.configured : (field.value ?? '').trim() !== value)) throw new Error('服务端返回的支付配置与本次保存不一致，请重新读取后核对。')
  }
}
