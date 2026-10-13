export type ProjectSearchParams = Record<string, string | string[] | undefined>

/** Legacy canvas project URLs enter the owner-checked canvas loader. */
export function legacyCanvasPath(projectId: string, search: ProjectSearchParams = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (value !== undefined) query.append(key, value)
  }
  const suffix = query.toString()
  return `/canvas/${encodeURIComponent(projectId)}${suffix ? `?${suffix}` : ''}`
}
