/** LobeHub plain SVGs use a fixed black fill rather than inherited currentColor. */
export function modelIconTone(src: string): 'monochrome' | 'original' {
  try {
    const url = new URL(src, 'https://oao.invalid')
    const path = decodeURIComponent(url.pathname)
    const library = /(?:^|\/)@lobehub\/icons-static-svg(?:@[^/]+)?\//.test(path)
    return library && /\/icons\/[^/]+\.svg$/i.test(path) && !/-color\.svg$/i.test(path)
      ? 'monochrome' : 'original'
  } catch {
    return 'original'
  }
}
