export const appearancePresets = [
  { id: 'mint', label: '薄荷光影', colors: ['#6ee7d1', '#243e45', '#b9ebe1'] },
  { id: 'ocean', label: '深海蓝', colors: ['#73b7ff', '#1f315b', '#a0d8f0'] },
  { id: 'violet', label: '暮色紫', colors: ['#c1a3ff', '#41345d', '#e2c3f2'] },
  { id: 'rose', label: '玫瑰雾', colors: ['#ffa1bd', '#543845', '#f3d1d9'] },
  { id: 'amber', label: '日落琥珀', colors: ['#ffc079', '#574136', '#f6d9ab'] },
  { id: 'forest', label: '森林青', colors: ['#9edaaf', '#254a44', '#c2d9b8'] },
  { id: 'graphite', label: '石墨黑白', colors: ['#cbd2df', '#353a43', '#e6e9ef'] },
  { id: 'aurora', label: '极光渐变', colors: ['#8fdcd3', '#7b78b5', '#eab3cb'] },
] as const
export type AppearancePreset = typeof appearancePresets[number]['id']
export type StudioAppearance = {
  preset: AppearancePreset
  font: 'auto' | 'sans' | 'serif'
  radius: 'square' | 'small' | 'medium' | 'large'
  density: 'compact' | 'default' | 'comfortable'
}
export const defaultAppearance: StudioAppearance = { preset: 'mint', font: 'auto', radius: 'medium', density: 'default' }
export const paletteTokens: Record<AppearancePreset, { dark: [string, string]; light: [string, string] }> = {
  mint: { dark: ['#6ee7d1', '#85a9e8'], light: ['#08796b', '#586fb7'] },
  ocean: { dark: ['#8abfff', '#99d3dd'], light: ['#255fa8', '#16747b'] },
  violet: { dark: ['#c5a8ff', '#9cb6ff'], light: ['#7042a5', '#3f67a4'] },
  rose: { dark: ['#ffafc9', '#bca8ee'], light: ['#a63563', '#7650a5'] },
  amber: { dark: ['#ffd08d', '#ef9c8b'], light: ['#875500', '#a34932'] },
  forest: { dark: ['#a4dfb5', '#80c8bf'], light: ['#286c43', '#176f70'] },
  graphite: { dark: ['#d5dbe5', '#a9b5c7'], light: ['#495363', '#6b7380'] },
  aurora: { dark: ['#9ae7de', '#c6a9ef'], light: ['#1b7978', '#8659a7'] },
}
export function normalizeAppearance(raw: unknown): StudioAppearance {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return {
    preset: appearancePresets.some(item => item.id === value.preset) ? value.preset as AppearancePreset : 'mint',
    font: value.font === 'sans' || value.font === 'serif' ? value.font : 'auto',
    radius: value.radius === 'square' || value.radius === 'small' || value.radius === 'large' ? value.radius : 'medium',
    density: value.density === 'compact' || value.density === 'comfortable' ? value.density : 'default',
  }
}
