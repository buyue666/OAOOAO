import type { XYPosition } from '@xyflow/react'
import { NODE_SIZE, type CreatableKind } from './node-factory'

/** Both the center and the resulting top-left position are canvas coordinates. */
export function nodePositionAtCenter(kind: CreatableKind, center: XYPosition): XYPosition {
  const size = kind === 'agent' ? NODE_SIZE.agent : kind === 'reference' || kind === 'asset' ? NODE_SIZE.media : NODE_SIZE.generation
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 }
}
