import type { WechatOfficialInput, WechatOfficialSettings } from './admin-types'

export const WECHAT_SECRET_FIELDS = [
  { key: 'appSecret', saved: 'hasAppSecret', clear: 'clearAppSecret', label: '应用密钥（AppSecret）' },
  { key: 'token', saved: 'hasToken', clear: 'clearToken', label: '验证令牌（Token）' },
  { key: 'encodingAESKey', saved: 'hasEncodingAESKey', clear: 'clearEncodingAESKey', label: '消息加解密密钥（EncodingAESKey）' },
] as const

export function wechatSettingsInput(saved: WechatOfficialSettings, form: FormData): WechatOfficialInput {
  const input: WechatOfficialInput = { enabled: form.has('wechatEnabled'), autoRegister: form.has('wechatAutoRegister'), appId: String(form.get('wechatAppId') ?? '').trim() }
  const changedApp = input.appId !== saved.appId
  if (input.appId && !/^wx[a-zA-Z0-9]{16}$/.test(input.appId)) throw new Error('AppID 应为微信提供的 wx 开头、共 18 位标识。')
  for (const field of WECHAT_SECRET_FIELDS) {
    const value = String(form.get(field.key) ?? '').trim()
    const clear = form.has(field.clear)
    if (clear && value) throw new Error(`${field.label} 不能同时填写新值和选择清除。`)
    if (changedApp && saved.appId && !value) throw new Error('更换 AppID 时必须重新填写三项凭证；已有微信身份的公众号不能直接更换。')
    if (value.length > 512) throw new Error(`${field.label} 长度不正确。`)
    if (field.key === 'encodingAESKey' && value && !/^[A-Za-z0-9]{43}$/.test(value)) throw new Error('消息加解密密钥应为微信提供的 43 位字母或数字。')
    if (field.key === 'token' && value && !/^[A-Za-z0-9]{3,32}$/.test(value)) throw new Error('验证令牌应为 3–32 位字母或数字。')
    if (field.key === 'appSecret' && value && !/^[A-Za-z0-9]{16,128}$/.test(value)) throw new Error('应用密钥应为微信提供的 16–128 位字母或数字。')
    if (value) input[field.key] = value
    if (clear) input[field.clear] = true
    if (input.enabled && !value && (clear || !saved[field.saved] || changedApp)) throw new Error(`启用前请填写 ${field.label}。`)
  }
  if (input.enabled && !input.appId) throw new Error('启用前请填写 AppID。')
  return input
}
