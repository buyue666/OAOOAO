import { useEffect } from 'react'
import type { XYPosition } from '@xyflow/react'
import { useCanvasStore } from './canvas-store'
import { createMediaNode } from './node-factory'
import type { NodeReference } from './types'

/** 作品页「发送到画布」写入的待接收队列；键名需与作品页保持一致。 */
const WORK_HANDOFF_KEY = 'oaooao-canvas-handoff'
const HANDOFF_SPACING = 260

type WorkHandoffEntry = { id: string; kind?: string; title?: string; src: string }

function isWorkHandoffEntry(value: unknown): value is WorkHandoffEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<WorkHandoffEntry>
  return typeof entry.id === 'string' && typeof entry.src === 'string'
}

/** 读取并清空队列。先清空再返回，即使后续插入出错也不会反复重放同一批结果。 */
function takeWorkHandoff(): WorkHandoffEntry[] {
  try {
    const raw = window.localStorage.getItem(WORK_HANDOFF_KEY)
    if (!raw) return []
    window.localStorage.removeItem(WORK_HANDOFF_KEY)
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isWorkHandoffEntry) : []
  } catch {
    return []
  }
}

/** 把作品页发送来的结果插入为参考素材节点，位置从当前视口中心开始横向排列。 */
export function useWorkHandoff(viewportCenter: () => XYPosition) {
  useEffect(() => {
    const entries = takeWorkHandoff()
    if (!entries.length) return
    const origin = viewportCenter()
    const nodes = entries.map((entry, index) => {
      const media: NodeReference = {
        id: entry.id,
        title: entry.title || '来自作品的结果',
        url: entry.src,
        mediaKind: entry.kind === 'video' ? 'video' : 'image',
      }
      const position = { x: origin.x + index * HANDOFF_SPACING, y: origin.y }
      return createMediaNode('reference', position, media, `handoff-${entry.id}-${index}`)
    })
    useCanvasStore.getState().insertNodes(nodes, [], { select: true })
  }, [viewportCenter])
}
