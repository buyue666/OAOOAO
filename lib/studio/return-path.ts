export const RETURN_PATH_KEY = 'oao:workbench-return'
export function safeReturnPath(value: string | null | undefined, fallback = '/studio') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return fallback
  try {
    const url = new URL(value, 'https://oao.invalid')
    if (url.origin !== 'https://oao.invalid' || /^\/(plans|login|register|forgot-password)(\/|$)/.test(url.pathname)) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return fallback }
}
