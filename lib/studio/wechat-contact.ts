import { safeBrandImageUrl } from './site-brand'

export type WechatContact = { enabled: boolean; imageUrl: string; caption: string; uploaded?: boolean }
export const WECHAT_CONTACT_DEFAULT = { enabled: false, imageUrl: '', caption: '' }

export function normalizeWechatContact(value: unknown): WechatContact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...WECHAT_CONTACT_DEFAULT }
  const input = value as Record<string, unknown>
  return { enabled: input.enabled === true, imageUrl: safeBrandImageUrl(input.imageUrl), caption: typeof input.caption === 'string' ? input.caption.trim().slice(0, 100) : '', uploaded: input.uploaded === true }
}
