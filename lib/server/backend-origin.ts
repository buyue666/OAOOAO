export function resolveBackendOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PUBLIC_ORIGIN || env.OAOAO_PUBLIC_URL
  if (explicit) return new URL(explicit).origin

  const candidates = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL,
    env.V0_DEV_APP_URL, env.V0_BUILD_URL, env.V0_SANDBOX_URL, env.V0_RUNTIME_URL]
  for (const value of candidates) {
    if (!value) continue
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`)
      if (['http:', 'https:'].includes(url.protocol)) return url.origin
    } catch { /* v0 的内部运行时标识不一定是可用于站点的 HTTP 地址。 */ }
  }
  return 'http://localhost:3000'
}
