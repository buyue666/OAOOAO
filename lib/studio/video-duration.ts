export type VideoDurationRule = {
  mode: 'range' | 'list'
  min?: number
  max?: number
  step?: number
  values?: number[]
}

/** Compact consecutive seconds while preserving gaps in fixed duration presets. */
export function formatVideoDurations(values: readonly number[], separator = '、'): string {
  const sorted = [...new Set(values.filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b)
  const parts: string[] = []
  for (let start = 0; start < sorted.length;) {
    let end = start
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++
    parts.push(end > start ? `${sorted[start]}-${sorted[end]}` : String(sorted[start]))
    start = end + 1
  }
  return parts.join(separator)
}

/** Accept a range such as 4-30, or a list such as 4,6,8; reject ambiguous input. */
export function parseVideoDurationInput(value: string): VideoDurationRule | undefined {
  const text = value.trim()
  const range = /^(\d+)\s*[-–—~至]\s*(\d+)$/.exec(text)
  if (range) {
    const min = Number(range[1]), max = Number(range[2])
    return min >= 1 && max >= min && max <= 3600 ? { mode: 'range', min, max, step: 1 } : undefined
  }
  if (/(?:[,，、]\s*){2}/.test(text) || /^[,，、]|[,，、]$/.test(text)) return undefined
  const expanded: number[] = []
  for (const token of text.split(/[,，、\s]+/)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token)
    if (!match) return undefined
    const start = Number(match[1]), end = Number(match[2] || match[1])
    if (start < 1 || end < start || end > 3600 || expanded.length + end - start + 1 > 120) return undefined
    for (let seconds = start; seconds <= end; seconds++) expanded.push(seconds)
  }
  const values = [...new Set(expanded)].sort((a, b) => a - b)
  return values.length <= 120 && values.every(seconds => Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600)
    ? { mode: 'list', values }
    : undefined
}
