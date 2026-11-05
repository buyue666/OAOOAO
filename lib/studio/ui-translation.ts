import { studioEnglish } from './studio-messages'

export type UiLocale = 'zh-CN' | 'en-US'
export type UiText = (source: string, values?: readonly unknown[]) => string

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates = Object.entries(studioEnglish).filter(([source]) => /\{\d+\}/.test(source)).sort(([left], [right]) => right.replace(/\{\d+\}/g, '').length - left.replace(/\{\d+\}/g, '').length).map(([source, target]) => {
  const slots: string[] = []
  let offset = 0, pattern = '^'
  for (const match of source.matchAll(/\{(\d+)\}/g)) {
    pattern += escapePattern(source.slice(offset, match.index)) + '([\\s\\S]*?)'
    slots.push(match[1]); offset = match.index + match[0].length
  }
  return { pattern: new RegExp(pattern + escapePattern(source.slice(offset)) + '$'), target, slots }
})

function interpolate(source: string, values: readonly unknown[]) {
  return source.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : token)
}

/** Localize authored UI copy. Values and request payloads remain untouched. */
export function translateUiText(locale: UiLocale, source: string, values?: readonly unknown[]): string {
  if (values) return interpolate(locale === 'en-US' ? studioEnglish[source] ?? source : source, values)
  if (locale !== 'en-US') return source
  if (Object.hasOwn(studioEnglish, source)) return studioEnglish[source]
  // Compatibility for existing dynamic labels supplied by owned UI helpers.
  // Match a complete registered message, never replace arbitrary substrings.
  for (const template of templates) {
    const match = template.pattern.exec(source)
    if (!match) continue
    const captured: string[] = []
    template.slots.forEach((slot, index) => { captured[Number(slot)] = match[index + 1] })
    return interpolate(template.target, captured)
  }
  return source
}
