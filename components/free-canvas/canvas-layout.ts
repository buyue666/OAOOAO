import { NODE_SIZE, sizeOf } from './node-factory'
import type { FreeCanvasEdge, FreeCanvasNode } from './types'

const COLUMN_GAP = 100
const ROW_GAP = 64
type Point = { x: number; y: number }
type Bounds = { left: number; top: number; right: number; bottom: number }
type Family = { root: FreeCanvasNode; offset: Point }

const coordinate = (value: number) => Number.isFinite(value) ? value : 0
const positive = (...values: (number | undefined)[]) => values.find(value => typeof value === 'number' && Number.isFinite(value) && value > 0)!

function dimensions(node: FreeCanvasNode) {
  const measured = sizeOf(node)
  const fallback = NODE_SIZE[node.type ?? 'generation']
  return {
    width: positive(node.width, node.measured?.width, measured.width, fallback.width),
    height: positive(node.height, node.measured?.height, measured.height, fallback.height),
  }
}

/** Resolve parent-relative coordinates without recursion, including deeply nested groups. */
function familiesOf(nodes: FreeCanvasNode[]): Map<string, Family> | null {
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length) return null
  const families = new Map<string, Family>()
  for (const node of nodes) {
    const path: FreeCanvasNode[] = []
    const visiting = new Set<string>()
    let current = node
    while (!families.has(current.id)) {
      // A parent cycle has no well-defined world position. Leave the board intact;
      // arranging must never silently detach children to repair corrupt input.
      if (visiting.has(current.id)) return null
      visiting.add(current.id)
      const parent = current.parentId ? byId.get(current.parentId) : undefined
      if (!parent) {
        families.set(current.id, { root: current, offset: { x: 0, y: 0 } })
        break
      }
      path.push(current)
      current = parent
    }
    for (let index = path.length - 1; index >= 0; index--) {
      const child = path[index]
      const parent = families.get(child.parentId!)!
      families.set(child.id, {
        root: parent.root,
        offset: { x: parent.offset.x + coordinate(child.position.x), y: parent.offset.y + coordinate(child.position.y) },
      })
    }
  }
  return families
}

/** Strongly connected nodes share a column; all edges between SCCs point right. */
function graphRanks(outgoing: number[][], incoming: number[][]): number[] {
  const visited = new Set<number>()
  const finished: number[] = []
  for (let start = 0; start < outgoing.length; start++) {
    if (visited.has(start)) continue
    visited.add(start)
    const stack = [{ node: start, next: 0 }]
    while (stack.length) {
      const frame = stack[stack.length - 1]
      if (frame.next < outgoing[frame.node].length) {
        const neighbor = outgoing[frame.node][frame.next++]
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          stack.push({ node: neighbor, next: 0 })
        }
      } else {
        finished.push(frame.node)
        stack.pop()
      }
    }
  }
  const componentOf = Array<number>(outgoing.length).fill(-1)
  let count = 0
  for (let index = finished.length - 1; index >= 0; index--) {
    const start = finished[index]
    if (componentOf[start] !== -1) continue
    componentOf[start] = count
    const stack = [start]
    while (stack.length) {
      for (const neighbor of incoming[stack.pop()!]) {
        if (componentOf[neighbor] !== -1) continue
        componentOf[neighbor] = count
        stack.push(neighbor)
      }
    }
    count++
  }
  const successors = Array.from({ length: count }, () => new Set<number>())
  const indegree = Array<number>(count).fill(0)
  outgoing.forEach((neighbors, from) => {
    for (const to of neighbors) {
      const source = componentOf[from], target = componentOf[to]
      if (source === target || successors[source].has(target)) continue
      successors[source].add(target)
      indegree[target]++
    }
  })
  const ranks = Array<number>(count).fill(0)
  const queue = indegree.flatMap((degree, index) => degree === 0 ? [index] : [])
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]
    for (const target of successors[source]) {
      ranks[target] = Math.max(ranks[target], ranks[source] + 1)
      if (--indegree[target] === 0) queue.push(target)
    }
  }
  return componentOf.map(component => ranks[component])
}

/** Arrange entire parent families while retaining node order, data and edges. */
export function arrangeCanvasNodes(nodes: FreeCanvasNode[], edges: FreeCanvasEdge[]): FreeCanvasNode[] {
  if (!nodes.length) return nodes
  const families = familiesOf(nodes)
  if (!families) return nodes
  const roots = nodes.filter(node => families.get(node.id)!.root === node)
  if (roots.length < 2) return nodes
  const rootIndex = new Map(roots.map((node, index) => [node.id, index]))
  const bounds: Bounds[] = roots.map(() => ({ left: 0, top: 0, right: 0, bottom: 0 }))
  for (const node of nodes) {
    const family = families.get(node.id)!
    const bound = bounds[rootIndex.get(family.root.id)!]
    const { width, height } = dimensions(node)
    bound.left = Math.min(bound.left, family.offset.x)
    bound.top = Math.min(bound.top, family.offset.y)
    bound.right = Math.max(bound.right, family.offset.x + width)
    bound.bottom = Math.max(bound.bottom, family.offset.y + height)
  }
  const links = roots.map(() => new Set<number>())
  const reverse = roots.map(() => new Set<number>())
  for (const edge of edges) {
    const source = families.get(edge.source), target = families.get(edge.target)
    if (!source || !target || source.root === target.root) continue
    const from = rootIndex.get(source.root.id)!, to = rootIndex.get(target.root.id)!
    links[from].add(to)
    reverse[to].add(from)
  }
  const outgoing = links.map(neighbors => [...neighbors].sort((a, b) => a - b))
  const incoming = reverse.map(neighbors => [...neighbors].sort((a, b) => a - b))
  const ranks = graphRanks(outgoing, incoming)
  const seen = new Set<number>()
  const components: number[][] = []
  for (let start = 0; start < roots.length; start++) {
    if (seen.has(start)) continue
    const members = [start]
    seen.add(start)
    for (let cursor = 0; cursor < members.length; cursor++) {
      for (const neighbor of [...outgoing[members[cursor]], ...incoming[members[cursor]]]) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        members.push(neighbor)
      }
    }
    components.push(members.sort((a, b) => a - b))
  }
  const positions = new Map<number, Point>()
  const layouts = components.map(members => {
    const layers = new Map<number, number[]>()
    for (const member of members) {
      const layer = layers.get(ranks[member]) ?? []
      layer.push(member)
      layers.set(ranks[member], layer)
    }
    let x = 0, height = 0
    for (const [, layer] of [...layers].sort(([a], [b]) => a - b)) {
      let width = 0, y = 0
      for (const member of layer) {
        const bound = bounds[member]
        positions.set(member, { x: x - bound.left, y: y - bound.top })
        width = Math.max(width, bound.right - bound.left)
        y += bound.bottom - bound.top + ROW_GAP
      }
      height = Math.max(height, y - ROW_GAP)
      x += width + COLUMN_GAP
    }
    return { width: x - COLUMN_GAP, height }
  })
  // Separate connected workflows form a compact grid instead of one long row.
  const columnCount = Math.min(4, Math.ceil(Math.sqrt(components.length)))
  const columnWidths = Array<number>(columnCount).fill(0)
  const rowHeights = Array<number>(Math.ceil(components.length / columnCount)).fill(0)
  layouts.forEach((layout, index) => {
    const column = index % columnCount, row = Math.floor(index / columnCount)
    columnWidths[column] = Math.max(columnWidths[column], layout.width)
    rowHeights[row] = Math.max(rowHeights[row], layout.height)
  })
  const starts = (sizes: number[], gap: number) => {
    let cursor = 0
    return sizes.map(size => { const start = cursor; cursor += size + gap; return start })
  }
  const columnStarts = starts(columnWidths, COLUMN_GAP), rowStarts = starts(rowHeights, ROW_GAP)
  components.forEach((members, index) => {
    for (const member of members) {
      const position = positions.get(member)!
      position.x += columnStarts[index % columnCount]
      position.y += rowStarts[Math.floor(index / columnCount)]
    }
  })
  const minimum = (values: number[]) => values.reduce((result, value) => Math.min(result, value), Infinity)
  const shift = {
    x: minimum(roots.map(node => coordinate(node.position.x))) - minimum([...positions.values()].map(position => position.x)),
    y: minimum(roots.map(node => coordinate(node.position.y))) - minimum([...positions.values()].map(position => position.y)),
  }
  let changed = false
  const arranged = nodes.map(node => {
    if (families.get(node.id)!.root !== node) return node
    const point = positions.get(rootIndex.get(node.id)!)!
    const position = { x: point.x + shift.x, y: point.y + shift.y }
    if (Math.abs(node.position.x - position.x) < 0.000001 && Math.abs(node.position.y - position.y) < 0.000001) return node
    changed = true
    return { ...node, position }
  })
  return changed ? arranged : nodes
}
