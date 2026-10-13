import { useEffect } from 'react'
import type { XYPosition } from '@xyflow/react'
import { useCanvasStore } from './canvas-store'
import { createMediaNode } from './node-factory'
import type { NodeReference } from './types'
import { takeWorkHandoff } from '@/lib/studio/work-handoff'
import { useStudio } from '@/lib/studio/store'
const HANDOFF_SPACING = 260

/** 把作品页发送来的结果插入为参考素材节点，位置从当前视口中心开始横向排列。 */
export function useWorkHandoff(viewportCenter: () => XYPosition) {
  const { state } = useStudio()
  const accountId = state.backendStatus === 'connected' ? state.user.id : ''
  useEffect(() => {
    if (!accountId) return
    const entries = takeWorkHandoff(window.sessionStorage, accountId)
    if (!entries.length) return
    const origin = viewportCenter()
    const nodes = entries.map((entry, index) => {
      const media: NodeReference = {
        id: entry.id,
        title: entry.title || '来自作品的结果',
        url: entry.src,
        mediaKind: entry.kind,
      }
      const position = { x: origin.x + index * HANDOFF_SPACING, y: origin.y }
      return createMediaNode('reference', position, media, `handoff-${entry.id}-${index}`)
    })
    useCanvasStore.getState().insertNodes(nodes, [], { select: true })
  }, [viewportCenter, accountId])
}
