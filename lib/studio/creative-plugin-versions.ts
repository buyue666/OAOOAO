import releases from './creative-plugin-releases.json'

export const directorVersions = [
  {version:'0.1.0',label:'经典简版',note:'人物、灯光与机位布置，导出镜头参考。',entry:null},
] as const
export type DirectorPluginVersion = typeof directorVersions[number]['version']
export type PluginPreferences = Record<string, { version: string; autoUpdate: boolean }>

export function directorRelease(version: string) {
  return directorVersions.find(release => release.version === version) ?? directorVersions.find(release => release.version === '0.1.0')!
}
export function normalizePluginPreferences(value: unknown): PluginPreferences {
  if (!value || typeof value !== 'object') return {}
  const item = (value as Record<string, unknown>).director
  if (!item || typeof item !== 'object') return {}
  const { version, autoUpdate } = item as Record<string, unknown>
  if (typeof version !== 'string' || !directorVersions.some(release => release.version === version) || typeof autoUpdate !== 'boolean') return {}
  return { director: { version, autoUpdate } }
}
export function installedDirectorVersion(preferences: PluginPreferences): DirectorPluginVersion {
  const item = preferences.director
  // An account created before version pinning keeps its previously installed editor.
  return directorRelease(item?.autoUpdate ? releases.director.version : item?.version ?? '0.1.0').version
}
