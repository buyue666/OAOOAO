import { creativePlugins, type CreativePluginId } from './creative-plugins'
import defaults from './creative-tool-defaults.json'

export type ToolMedia = { type: 'image' | 'video'; url: string; poster?: string; label?: string }
export type ToolShowcase = {
  enabled: boolean
  title: string
  description: string
  order: number
  effect: 'zoom' | 'carousel' | 'compare' | 'video'
  intervalMs: number
  fit: 'cover' | 'contain'
  media: ToolMedia[]
}
export type CreativeToolsSettings = Partial<Record<CreativePluginId, Partial<ToolShowcase>>>

export const toolEffects = [
  { value: 'zoom', label: '悬浮缩放', hint: '封面在悬浮时轻微放大。' },
  { value: 'carousel', label: '图片轮播', hint: '可见时轮播，悬浮或聚焦时暂停；支持手动切换。' },
  { value: 'compare', label: '前后对比', hint: '前两张图片可拖动对比，适合展示编辑和换装效果。' },
  { value: 'video', label: '悬浮视频', hint: '悬浮或聚焦时静音播放；触屏可点击预览。' },
] as const

export function toolShowcase(id: CreativePluginId, settings?: CreativeToolsSettings): ToolShowcase {
  const index = creativePlugins.findIndex(tool => tool.id === id), tool = creativePlugins[index], saved = { ...(defaults as CreativeToolsSettings)[id], ...settings?.[id] }
  return { enabled: true, order: index * 10, effect: 'zoom', intervalMs: 4000, fit: 'cover', media: [], ...saved,
    title: saved?.title?.trim() || tool.name, description: saved?.description?.trim() || tool.description }
}

export function toolEnabled(id: CreativePluginId, settings?: CreativeToolsSettings) {
  return settings?.[id]?.enabled !== false && (id !== 'director' || settings?.canvas?.enabled !== false)
}
