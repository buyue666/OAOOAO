'use client'

import type { Edge, Node } from '@xyflow/react'
import { media } from '@/lib/studio/mock-data'
import type { CanvasBoard, CanvasNodeData } from '@/lib/studio/types'

export const canvasEdgeStyle = { stroke: 'rgba(248, 248, 248, .82)', strokeWidth: 2.1 }
export const defaultEdgeOptions = { animated: false, style: canvasEdgeStyle }

export function createInitialBoard(projectId: string, projectTitle?: string): CanvasBoard {
  const prefix = `${projectId || 'canvas'}-canvas`

  if (projectId === 'aurora') {
    return {
      nodes: [
        { id: `${prefix}-reference`, type: 'canvas', position: { x: 80, y: 120 }, data: { title: '极夜山谷参考', kind: 'image', detail: '参考素材 · 2400 × 1600', src: media.auroraCover } },
        { id: `${prefix}-shot`, type: 'canvas', position: { x: 380, y: 70 }, data: { title: '镜头 02 · 没有寄出的信', kind: 'text', detail: '屋内桌面上的信封被风吹开。' } },
        { id: `${prefix}-result`, type: 'canvas', position: { x: 720, y: 150 }, data: { title: '镜头 07 · 候选结果', kind: 'video', detail: 'Motion 03 · 8 秒', src: media.video, poster: media.videoPoster, status: '生成中' } },
        { id: `${prefix}-task`, type: 'canvas', position: { x: 380, y: 350 }, data: { title: '待执行任务', kind: 'task', detail: '生成两组低饱和夜景候选', status: '待确认' } },
      ],
      edges: [
        { id: `${prefix}-edge-reference-shot`, source: `${prefix}-reference`, target: `${prefix}-shot`, style: canvasEdgeStyle },
        { id: `${prefix}-edge-shot-result`, source: `${prefix}-shot`, target: `${prefix}-result`, style: canvasEdgeStyle },
        { id: `${prefix}-edge-shot-task`, source: `${prefix}-shot`, target: `${prefix}-task`, type: 'smoothstep', style: canvasEdgeStyle },
      ],
    }
  }

  const title = projectTitle ?? '当前项目'
  const isNorthline = projectId === 'northline'
  const isQuietRoom = projectId === 'quiet-room'
  const reference = isNorthline ? media.cityCover : isQuietRoom ? media.studio : media.product
  const referenceDetail = isNorthline ? '城市建筑参考 · 品牌视觉' : isQuietRoom ? '室内光线参考 · 4:5' : '产品静物参考 · 广告片'

  return {
    nodes: [
      { id: `${prefix}-reference`, type: 'canvas', position: { x: 100, y: 130 }, data: { title: `${title} · 参考`, kind: 'image', detail: referenceDetail, src: reference } },
      { id: `${prefix}-brief`, type: 'canvas', position: { x: 440, y: 90 }, data: { title: `${title} · 创作说明`, kind: 'text', detail: '在这里整理镜头、参考素材与视觉方向。' } },
      { id: `${prefix}-task`, type: 'canvas', position: { x: 440, y: 310 }, data: { title: '待执行任务', kind: 'task', detail: '补充第一轮候选并确认创作方向', status: '待确认' } },
    ],
    edges: [
      { id: `${prefix}-edge-reference-brief`, source: `${prefix}-reference`, target: `${prefix}-brief`, style: canvasEdgeStyle },
      { id: `${prefix}-edge-brief-task`, source: `${prefix}-brief`, target: `${prefix}-task`, type: 'smoothstep', style: canvasEdgeStyle },
    ],
  }
}

export function cloneBoard(board: CanvasBoard): CanvasBoard {
  return {
    nodes: board.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data },
    })),
    edges: board.edges.map((edge) => ({
      ...edge,
      animated: false,
      style: { ...canvasEdgeStyle, ...edge.style },
    })),
  }
}

/** 空画布：真实登录状态下新建画布保持为空，不自动填充演示节点。 */
export const emptyBoard: CanvasBoard = { nodes: [], edges: [] }

export type CanvasFlowInstance = {
  fitView: (options?: { padding?: number; maxZoom?: number; duration?: number }) => void
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number }
  getViewport?: () => { x: number; y: number; zoom: number }
  setViewport?: (viewport: { x: number; y: number; zoom: number }, options?: { duration?: number }) => unknown
}

/** ReactFlow 不知道顶部浮动工具栏占用了画布空间，给自动适配留一段安全边距。 */
export function fitCanvasWithTopSafeArea(flow: CanvasFlowInstance, padding: number, duration = 0) {
  flow.fitView({ padding, maxZoom: 1.05, duration })
  window.setTimeout(() => {
    const viewport = flow.getViewport?.()
    if (!viewport || !flow.setViewport) return
    void flow.setViewport({ ...viewport, y: viewport.y + 62 }, { duration: 0 })
  }, Math.max(32, duration + 32))
}
export type HistoryState = { canUndo: boolean; canRedo: boolean }
export type CanvasPanelTab = 'nodes' | 'assets' | 'tasks' | 'history'
export type CanvasContextMenu = { x: number; y: number; position?: { x: number; y: number }; nodeId?: string } | null
