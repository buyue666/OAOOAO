type SettingsRecord = Record<string, any>;

export function hasSiteCommercePolicy(config: SettingsRecord): boolean {
  const site = config.site;
  return Boolean(site && typeof site === 'object' && !Array.isArray(site) && Object.hasOwn(site, 'commercePolicy'));
}

/** A nested draft or explicit clear is authoritative; legacy flat values apply only when absent. */
export function resolveCommercePolicy(config: SettingsRecord): SettingsRecord | null {
  const candidate = hasSiteCommercePolicy(config) ? config.site.commercePolicy : config.commercePolicy;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null;
}
