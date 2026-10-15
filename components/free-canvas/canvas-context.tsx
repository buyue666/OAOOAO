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
  openDirector: (nodeId: string) => void
  focusAgent: () => void
  exportCanvas: () => void
  selectSkills: (nodeId: string) => void
  createSkillFromSelection: (nodeIds?: readonly string[]) => void
  /** Legacy single-node entry opens the same editable draft; it never saves immediately. */
  saveSkillFromNode: (nodeId: string) => Promise<void>
  saveSelectionResults: (nodeIds?: readonly string[]) => void
  draftAgentFromSelection: (nodeIds?: readonly string[]) => void
  exportSelection: (nodeIds?: readonly string[]) => void
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
