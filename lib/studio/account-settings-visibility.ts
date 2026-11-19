export type AccountSettingsVisibility = { watermark: boolean; adultContent: boolean }

const SAVED_EVENT = 'oao:account-settings-visibility-saved'
const CHANNEL = 'oao:account-settings-visibility:v1'

export function readAccountSettingsVisibility(value: unknown): AccountSettingsVisibility | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  return typeof input.watermark === 'boolean' && typeof input.adultContent === 'boolean'
    ? { watermark: input.watermark, adultContent: input.adultContent } : null
}

/** Broadcast only these two public display flags, never the administrator settings. */
export function publishAccountSettingsVisibility(settings: { watermarkPolicy?: { enabled: boolean }; accountMenu?: { adultContentSettingsVisible: boolean } }) {
  if (typeof window === 'undefined') return
  const visibility = {
    watermark: settings.watermarkPolicy?.enabled !== false,
    adultContent: settings.accountMenu?.adultContentSettingsVisible !== false,
  }
  window.dispatchEvent(new CustomEvent(SAVED_EVENT, { detail: visibility }))
  // Admin pages may not mount an account menu of their own.
  try {
    if (typeof window.BroadcastChannel === 'function') {
      const channel = new window.BroadcastChannel(CHANNEL)
      channel.postMessage(visibility)
      channel.close()
    }
  } catch { /* Same-tab updates remain available. */ }
}

export function subscribeAccountSettingsVisibility(listener: (visibility: AccountSettingsVisibility) => void) {
  if (typeof window === 'undefined') return () => {}
  let channel: BroadcastChannel | undefined
  try { if (typeof window.BroadcastChannel === 'function') channel = new window.BroadcastChannel(CHANNEL) } catch { /* Same-tab events remain available. */ }
  const receive = (event: Event) => {
    const visibility = readAccountSettingsVisibility((event as CustomEvent).detail)
    if (!visibility) return
    listener(visibility)
  }
  window.addEventListener(SAVED_EVENT, receive)
  if (channel) channel.onmessage = event => {
    const visibility = readAccountSettingsVisibility(event.data)
    if (visibility) listener(visibility)
  }
  return () => {
    window.removeEventListener(SAVED_EVENT, receive)
    if (channel) { channel.onmessage = null; channel.close() }
  }
}
