const areas = ['home', 'image', 'video', 'canvas', 'features'] as const
export type TeamStudioArea = typeof areas[number]

export function teamStudioView(view?: string[]): TeamStudioArea | undefined {
  if (!view?.length) return 'home'
  return view.length === 1 ? areas.find(area => area !== 'home' && area === view[0]) : undefined
}
