'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { XYPosition } from '@xyflow/react'
import type { CreatableKind } from './node-factory'
import type { NodeSide } from './types'
import type { AgentActions } from './use-agent-actions'
import type { GenerationActions } from './use-generation-actions'

export type CanvasActions = GenerationActions & AgentActions & {
  createNodeNear: (sourceId: string, side: NodeSide, kind: CreatableKind) => void
  createNodeAt: (kind: CreatableKind, position: XYPosition) => void
  focusAgent: () => void
  exportCanvas: () => void
}

const CanvasActionsContext = createContext<CanvasActions | null>(null)

export function CanvasActionsProvider({ value, children }: { value: CanvasActions; children: ReactNode }) {
  return <CanvasActionsContext.Provider value={value}>{children}</CanvasActionsContext.Provider>
}

export function useCanvasActions() {
  const actions = useContext(CanvasActionsContext)
  if (!actions) throw new Error('useCanvasActions 必须在 CanvasActionsProvider 内使用')
  return actions
}
