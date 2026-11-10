import { request } from './api'
import type { TryOnReference, TryOnRole } from './tryon'
import type { ImageGenerationInput } from './generation-types'

export type CreativeReferencePage = { items: TryOnReference[]; total: number; page: number; pageSize: number; grouped: boolean; categories: string[]; styles: string[]; angles: string[] }
export function listCreativeReferences(options: { role: TryOnRole; keyword?: string; category?: string; style?: string; angle?: string; page?: number }, signal?: AbortSignal) {
  const query = new URLSearchParams({ role: options.role, pageSize: '36' })
  for (const [key,value] of Object.entries(options)) if (value !== undefined && value !== '') query.set(key,String(value))
  return request<CreativeReferencePage>(`/api/creative-references?${query}`, { signal })
}
export function quoteTryOn(input: ImageGenerationInput, signal?: AbortSignal) {
  return request<{points:number;estimated:boolean}>('/api/image-tasks/quote', { method: 'POST', signal, body: JSON.stringify({ prompt: input.prompt, kind: input.kind, references: input.references, config: { model: input.model, size: input.ratio, resolution: input.resolution, quality: input.quality, n: input.count } }) })
}
