export const announcementTones = [
  { value: 'promo', label: '青绿' },
  { value: 'info', label: '海蓝' },
  { value: 'warning', label: '琥珀' },
  { value: 'violet', label: '紫罗兰' },
  { value: 'rose', label: '玫瑰' },
  { value: 'slate', label: '石墨' },
] as const

export const announcementEffects = [
  { value: 'none', label: '静态' },
  { value: 'glow', label: '柔光流动' },
  { value: 'shimmer', label: '微光掠过' },
] as const

export type AnnouncementTone = (typeof announcementTones)[number]['value']
export type AnnouncementEffect = (typeof announcementEffects)[number]['value']

export function normalizeAnnouncementTone(value: unknown): AnnouncementTone {
  return announcementTones.find(item => item.value === value)?.value ?? 'promo'
}

export function normalizeAnnouncementEffect(value: unknown): AnnouncementEffect {
  return announcementEffects.find(item => item.value === value)?.value ?? 'glow'
}
