import { brandSettingsFields, type SiteBrandInput } from './site-brand'

export const SITE_BRAND_SAVED_EVENT = 'oao:site-brand-saved'
const SITE_BRAND_CHANNEL = 'oao:site-brand:v1'

/** One controller per StudioProvider, so server rendering never shares saved state. */
export function createSiteBrandSync() {
  let revision = 0
  let latest: ReturnType<typeof brandSettingsFields> | undefined
  const listeners = new Set<(site: ReturnType<typeof brandSettingsFields>) => void>()
  return {
    getRevision: () => revision,
    publish(site: SiteBrandInput) {
      latest = brandSettingsFields(site)
      revision += 1
      for (const listener of listeners) listener(latest)
    },
    subscribe(listener: (site: ReturnType<typeof brandSettingsFields>) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    merge<T extends { site?: SiteBrandInput }>(settings: T | undefined, startedAtRevision: number): T | undefined {
      // An older GET may finish after PATCH succeeds. Preserve just its new branding;
      // user/model/billing data must still come from the session response.
      if (!latest || revision === startedAtRevision) return settings
      return { ...settings, site: { ...settings?.site, ...latest } } as T
    },
  }
}

/** Called only after the existing admin API confirms a successful save. */
export function publishSiteBrandSettings(site: SiteBrandInput) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SITE_BRAND_SAVED_EVENT, { detail: brandSettingsFields(site) }))
}

/** Recheck the server when returning to a tab whose broadcast channel was suspended. */
export function subscribeSiteBrandRefresh(sync: ReturnType<typeof createSiteBrandSync>, loadSite: () => Promise<SiteBrandInput | undefined>) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  let disposed = false
  let pending = false
  const refresh = async () => {
    if (disposed || pending || document.visibilityState !== 'visible') return
    pending = true
    const startedAtRevision = sync.getRevision()
    try {
      const site = await loadSite()
      // A concurrent save/broadcast is newer than this GET. Only public branding
      // is applied; returning to a tab must not replace account or billing state.
      if (!disposed && site && sync.getRevision() === startedAtRevision) sync.publish(site)
    } catch { /* Keep the last known brand through a temporary network failure. */ }
    finally { pending = false }
  }
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)
  return () => {
    disposed = true
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', refresh)
  }
}

/** Notify other open tabs without storing a second, permanently authoritative brand. */
export function subscribeSiteBrandUpdates(listener: (site: ReturnType<typeof brandSettingsFields>) => void) {
  if (typeof window === 'undefined') return () => {}
  let channel: BroadcastChannel | undefined
  try {
    if (typeof window.BroadcastChannel === 'function') channel = new window.BroadcastChannel(SITE_BRAND_CHANNEL)
  } catch { /* Restricted browsers retain same-tab updates. */ }
  const receiveSaved = (event: Event) => {
    const site = readBrandFields((event as CustomEvent).detail)
    if (!site) return
    listener(site)
    try { channel?.postMessage({ version: 1, site }) } catch { /* A closed or unavailable channel cannot fail the saved settings. */ }
  }
  window.addEventListener(SITE_BRAND_SAVED_EVENT, receiveSaved)
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data
    if (!message || typeof message !== 'object' || Array.isArray(message) || !('version' in message) || message.version !== 1 || !('site' in message)) return
    const site = readBrandFields(message.site)
    // Do not dispatch another saved event: received updates must never rebroadcast.
    if (site) listener(site)
  }
  return () => {
    window.removeEventListener(SITE_BRAND_SAVED_EVENT, receiveSaved)
    if (channel) { channel.onmessage = null; try { channel.close() } catch { /* Already closed. */ } }
  }
}

function readBrandFields(value: unknown): ReturnType<typeof brandSettingsFields> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.title !== 'string' || input.title.length > 160 || typeof input.logoUrl !== 'string' || input.logoUrl.length > 4000 || typeof input.iconUrl !== 'string' || input.iconUrl.length > 4000) return null
  return brandSettingsFields(input)
}
