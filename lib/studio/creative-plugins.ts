/** Lightweight catalog. Keep tool implementations and asset URLs out of this module. */
export const creativePlugins = [
  { id: 'remix', name: '图片复刻', description: '分析参考图的主体、环境、风格与镜头，调整细节后重新创作。', category: '图像工具', icon: 'remix', href: '/tools/remix', version: '0.1.0', dependencies: [] },
  { id: 'tryon', name: 'AI 换装', description: '组合人物、服装与姿势参考，选择视角，完成试穿与商业成片。', category: '图像工具', icon: 'tryon', href: '/tools/tryon', version: '0.1.0', dependencies: [] },
  { id: 'agent', name: '创作助手', description: '带上想法、素材与技能，梳理方向并确认生成计划。', category: '创作规划', icon: 'agent', href: '/agent', version: '0.1.0', dependencies: [] },
  { id: 'drama', name: '短剧制作', description: '从剧本、角色和场景，到分镜、镜头与成片，逐步完成故事。', category: '创作规划', icon: 'drama', href: '/drama', version: '0.1.0', dependencies: [] },
  { id: 'canvas', name: '自由画布', description: '在无限画布上组织素材、连接生成节点，搭建自己的创作流程。', category: '空间与画布', icon: 'canvas', href: '/canvas', version: '0.1.0', dependencies: [] },
  { id: 'director', name: '3D 导演台', description: '在画布中布置人物、动作、灯光和机位，导出镜头参考。', category: '空间与画布', icon: 'director', href: '/canvas', version: '0.1.0', dependencies: ['canvas'] },
] as const

export type CreativePlugin = typeof creativePlugins[number]
export type CreativePluginId = CreativePlugin['id']
export type CreativePluginCategory = CreativePlugin['category']

export function isCreativePluginId(value: unknown): value is CreativePluginId {
  return typeof value === 'string' && creativePlugins.some(plugin => plugin.id === value)
}

export function normalizeInstalledPlugins(value: unknown): CreativePluginId[] {
  if (!Array.isArray(value)) return []
  const ids = [...new Set(value.filter(isCreativePluginId))]
  // A dependent tool cannot be usable without its host.
  return ids.filter(id => id !== 'director' || ids.includes('canvas'))
}

export function creativePlugin(id: CreativePluginId): CreativePlugin {
  return creativePlugins.find(plugin => plugin.id === id)!
}

export function matchesPlugin(plugin: CreativePlugin, query: string, category: string, installedOnly: boolean, installed: readonly CreativePluginId[]) {
  const keyword = query.trim().toLocaleLowerCase()
  return (!installedOnly || installed.includes(plugin.id))
    && (category === '全部' || plugin.category === category)
    && (!keyword || `${plugin.name} ${plugin.description} ${plugin.id}`.toLocaleLowerCase().includes(keyword))
}
