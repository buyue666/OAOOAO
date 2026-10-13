'use client'

import { useMemo } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Clapperboard, Image as ImageIcon, Layers3 } from 'lucide-react'
import type { DramaEpisode, DramaProject } from '@/lib/studio/drama-types'
import { shotAssets, stableMediaUrl } from '@/lib/studio/creative-project'
import { useStudio } from '@/lib/studio/store'
import { cn } from '@/lib/utils'
import { MediaThumb } from './ui'

type CompositionData = {
  title: string
  subtitle: string
  kind: 'source' | 'subject' | 'shot'
  mediaUrl?: string
  mediaKind?: 'image' | 'video'
  poster?: string
  selected?: boolean
  onSelect?: () => void
}
type CompositionNode = Node<CompositionData, 'composition'>

function CompositionCard({ data }: NodeProps<CompositionNode>) {
  const Icon = data.kind === 'shot' ? Clapperboard : data.kind === 'subject' ? Layers3 : ImageIcon
  const content = <><div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-xs"><Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate font-medium">{data.title}</span></div>{data.mediaUrl ? <MediaThumb src={data.mediaUrl} poster={data.poster} kind={data.mediaKind} alt="" fallback={data.title} className="aspect-video w-full" /> : <div className="flex aspect-video items-center justify-center bg-muted/30 px-4 text-center text-xs leading-5 text-muted-foreground">{data.kind === 'shot' ? '等待采用镜头版本' : '尚未设置参考图'}</div>}<p className="truncate px-3 py-2.5 text-xs text-muted-foreground">{data.subtitle}</p></>
  return (
    <div className={cn('w-[240px] overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm', data.selected ? 'border-foreground ring-2 ring-foreground/20' : 'border-border')}>
      <Handle type="target" id="left" position={Position.Left} isConnectable={false} className="!size-1.5 !border-0 !bg-muted-foreground" />
      <Handle type="target" id="top" position={Position.Top} isConnectable={false} className="!size-1.5 !border-0 !bg-muted-foreground" />
      {data.kind === 'shot' ? <button type="button" onClick={data.onSelect} aria-pressed={data.selected} aria-label={`选择${data.title}`} className="nodrag nopan block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">{content}</button> : content}
      <Handle type="source" id="right" position={Position.Right} isConnectable={false} className="!size-1.5 !border-0 !bg-muted-foreground" />
      <Handle type="source" id="bottom" position={Position.Bottom} isConnectable={false} className="!size-1.5 !border-0 !bg-muted-foreground" />
    </div>
  )
}

const nodeTypes = { composition: CompositionCard }
const fitOptions = { padding: 0.18, maxZoom: 0.9 }

export function CreativeProjectCanvas({ project, episode, selectedShotId, onSelectShot }: { project: DramaProject; episode: DramaEpisode; selectedShotId: string; onSelectShot: (id: string) => void }) {
  const { state } = useStudio()
  const { nodes, edges } = useMemo(() => {
    const nodes: CompositionNode[] = []
    const edges: Edge[] = []
    const sources = project.sourceAssets ?? []
    const subjects = [...project.characters, ...project.scenes, ...project.props, ...project.clues]
    const sourceNodes = new Map<string, string>()
    const subjectNodes = new Map<string, string>()
    sources.forEach((source, index) => {
      const id = `source:${source.id}`
      const url = stableMediaUrl(source.serverUrl || source.remoteUrl)
      if (url) sourceNodes.set(url, id)
      nodes.push({ id, type: 'composition', position: { x: 0, y: index * 250 }, data: { title: source.title, subtitle: '项目参考', kind: 'source', mediaUrl: source.type === 'image' || source.type === 'video' ? url : '', mediaKind: source.type === 'video' ? 'video' : 'image' } })
    })
    subjects.forEach((asset, index) => {
      const id = `subject:${asset.id}`
      subjectNodes.set(asset.id, id)
      const primary = asset.references?.find((ref) => ref.id === asset.primaryReferenceId) ?? asset.references?.[0]
      const url = stableMediaUrl(primary?.url || asset.referenceImageUrl)
      nodes.push({ id, type: 'composition', position: { x: sources.length ? 330 : 0, y: index * 250 }, data: { title: asset.name, subtitle: asset.profile?.consistencyRules || asset.description || '身份资产', kind: 'subject', mediaUrl: url, mediaKind: 'image' } })
      const sourceNode = sourceNodes.get(url)
      if (sourceNode) edges.push({ id: `reference:${sourceNode}:${id}`, source: sourceNode, target: id, sourceHandle: 'right', targetHandle: 'left', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.2 } })
    })
    const shots = [...episode.shots].sort((a, b) => a.order - b.order)
    const shotX = sources.length && subjects.length ? 720 : sources.length || subjects.length ? 390 : 0
    shots.forEach((shot, index) => {
      const id = `shot:${shot.id}`
      const video = stableMediaUrl(shot.videoUrl)
      const image = stableMediaUrl(shot.storyboardImageUrl)
      nodes.push({ id, type: 'composition', position: { x: shotX, y: index * 280 }, data: { title: `${String(index + 1).padStart(2, '0')} · ${shot.title}`, subtitle: `${shot.duration} 秒 · ${video ? '已采用视频' : image ? '已采用分镜' : '尚无采用版本'}`, kind: 'shot', mediaUrl: video || image, mediaKind: video ? 'video' : 'image', poster: image || undefined, selected: shot.id === selectedShotId, onSelect: () => onSelectShot(shot.id) } })
      for (const asset of shotAssets(project, shot)) {
        const source = subjectNodes.get(asset.id)
        if (source) edges.push({ id: `binding:${source}:${id}`, source, target: id, sourceHandle: 'right', targetHandle: 'left', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.2 } })
      }
      for (const source of sources.filter((asset) => asset.type === 'image' && stableMediaUrl(asset.serverUrl || asset.remoteUrl))) edges.push({ id: `global:${source.id}:${id}`, source: `source:${source.id}`, target: id, sourceHandle: 'right', targetHandle: 'left', style: { stroke: 'var(--muted-foreground)', opacity: 0.4, strokeDasharray: '4 4' } })
      if (index > 0) edges.push({ id: `sequence:${shots[index - 1].id}:${shot.id}`, source: `shot:${shots[index - 1].id}`, target: id, sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--foreground)' }, style: { stroke: 'var(--foreground)', strokeWidth: 1.6 } })
    })
    return { nodes, edges }
  }, [project, episode, selectedShotId, onSelectShot])

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="项目关系画布">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-base font-semibold">同一作品的关系画布</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">查看参考、主体与镜头的连接；点击镜头即可切换当前编辑对象。</p></div><p className="text-xs leading-5 text-muted-foreground">实线：主体关联与镜头顺序 · 虚线：项目参考</p></div>
      {nodes.length ? <div className="studio-flow h-[min(70dvh,760px)] min-h-[400px] min-w-0 overflow-hidden rounded-lg border border-border bg-background"><ReactFlow key={`${project.id}:${episode.id}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={state.theme} fitView fitViewOptions={fitOptions} minZoom={0.12} maxZoom={1.7} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} deleteKeyCode={null} zoomOnDoubleClick={false} aria-label="参考与镜头关系图"><Background color="var(--border)" gap={22} size={1} /><Controls showInteractive={false} fitViewOptions={fitOptions} aria-label="画布缩放与全览" /></ReactFlow></div> : <div className="rounded-lg border border-dashed border-border px-5 py-16 text-center text-sm text-muted-foreground">添加参考或镜头后，作品的连接关系会出现在这里。</div>}
      <p className="text-xs leading-5 text-muted-foreground">画布展示项目当前采用的版本。位置按关系自动排列，素材和镜头修改会同步到这里。</p>
    </section>
  )
}
