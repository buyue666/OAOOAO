import type { XYPosition } from '@xyflow/react'
import type { FreeCanvasEdge, FreeCanvasNode } from './types'

export type CanvasSelectionSnapshot = { nodes: FreeCanvasNode[]; edges: FreeCanvasEdge[] }

/** A selected group owns its complete descendant tree, including nested groups. */
export function selectionNodes(nodes: readonly FreeCanvasNode[], selectedIds?: readonly string[]): FreeCanvasNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const selected = new Set(selectedIds ?? nodes.filter(node => node.selected).map(node => node.id))
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node.id)
    children.set(node.parentId, siblings)
  }
  const queue = [...selected].filter(id => byId.get(id)?.type === 'group')
  const expanded = new Set<string>()
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    if (expanded.has(id)) continue
    expanded.add(id)
    for (const child of children.get(id) ?? []) { selected.add(child); queue.push(child) }
  }
  const emitted = new Set<string>()
  return nodes.filter(node => {
    if (!selected.has(node.id) || emitted.has(node.id)) return false
    emitted.add(node.id)
    return true
  })
}

/** Roots move in world coordinates; descendants retain parent-relative coordinates. */
export function selectionRoots(nodes: readonly FreeCanvasNode[], selectedIds?: readonly string[]): FreeCanvasNode[] {
  const selected = selectionNodes(nodes, selectedIds)
  const included = new Set(selected.map(node => node.id))
  const byId = new Map(nodes.map(node => [node.id, node]))
  return selected.filter(node => {
    const visited = new Set([node.id])
    let parent = node.parentId
    while (parent) {
      if (included.has(parent)) return false
      if (visited.has(parent)) break
      visited.add(parent)
      parent = byId.get(parent)?.parentId
    }
    return true
  })
}

const pointOf = (point: XYPosition): XYPosition => ({ x: Number.isFinite(point.x) ? point.x : 0, y: Number.isFinite(point.y) ? point.y : 0 })

/** Resolve a complete board once, without recursion or repeated scans of ancestor chains. */
export function absoluteNodePositions(nodes: readonly FreeCanvasNode[]): Map<string, XYPosition> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const positions = new Map<string, XYPosition>()
  for (const node of nodes) {
    const path: FreeCanvasNode[] = []
    const visited = new Set<string>()
    let cursor: FreeCanvasNode | undefined = node
    while (cursor && !positions.has(cursor.id)) {
      if (visited.has(cursor.id)) {
        // Broken legacy ancestry has no absolute position. Keep its stored
        // coordinates as a conservative fallback, without mutating or looping.
        for (const item of path) positions.set(item.id, pointOf(item.position))
        break
      }
      visited.add(cursor.id)
      path.push(cursor)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
    if (positions.has(node.id)) continue
    let origin = cursor ? positions.get(cursor.id)! : { x: 0, y: 0 }
    for (let index = path.length - 1; index >= 0; index--) {
      const item = path[index], point = pointOf(item.position)
      origin = { x: origin.x + point.x, y: origin.y + point.y }
      positions.set(item.id, origin)
    }
  }
  return positions
}

export function absoluteNodePosition(node: FreeCanvasNode, nodes: readonly FreeCanvasNode[]): XYPosition {
  return absoluteNodePositions(nodes).get(node.id) ?? pointOf(node.position)
}

/** Capture only the chosen tree and its internal links; all readable data survives. */
export function selectionSnapshot(nodes: readonly FreeCanvasNode[], edges: readonly FreeCanvasEdge[], selectedIds?: readonly string[]): CanvasSelectionSnapshot {
  const selected = selectionNodes(nodes, selectedIds)
  const included = new Set(selected.map(node => node.id))
  const positions = absoluteNodePositions(nodes)
  return {
    nodes: selected.map(node => {
      const externalParent = node.parentId && !included.has(node.parentId)
      return {
        ...node,
        position: { ...(externalParent ? positions.get(node.id)! : node.position) },
        ...(externalParent ? { parentId: undefined, extent: node.extent === 'parent' ? undefined : node.extent } : {}),
        data: structuredClone(node.data),
      } as FreeCanvasNode
    }),
    edges: edges.filter(edge => included.has(edge.source) && included.has(edge.target)).map(edge => ({ ...edge, ...(edge.data ? { data: structuredClone(edge.data) } : {}) })),
  }
}

/** React Flow requires each parent before its children, including nested groups. */
export function orderNodesParentsFirst(nodes: readonly FreeCanvasNode[]): FreeCanvasNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  // Invalid legacy IDs must not cause this ordering pass to discard content.
  if (byId.size !== nodes.length) return [...nodes]
  const ordered: FreeCanvasNode[] = [], emitted = new Set<string>()
  for (const node of nodes) {
    const path: FreeCanvasNode[] = [], visited = new Set<string>()
    let current: FreeCanvasNode | undefined = node
    while (current && !emitted.has(current.id) && !visited.has(current.id)) {
      path.push(current); visited.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    for (let index = path.length - 1; index >= 0; index--) {
      const item = path[index]
      if (emitted.has(item.id)) continue
      emitted.add(item.id); ordered.push(item)
    }
  }
  return ordered
}
