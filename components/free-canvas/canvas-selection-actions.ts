import type { LibraryAssetView, createLibraryAsset } from '@/lib/studio/account-api'
import { absoluteNodePositions, selectionNodes } from './canvas-selection'
import type { FreeCanvasEdge, FreeCanvasNode } from './types'

export type SelectionResult = {
  id: string; title: string; kind: 'image' | 'video' | 'audio' | 'text'; url?: string; text?: string
  skipped?: string; key?: string; status: 'pending' | 'saving' | 'saved' | 'failed' | 'unknown'; error?: string
}
export type SelectionReceipt = { status: 'saved' | 'unknown'; assetId?: string }
export type SelectionAssetInput = Parameters<typeof createLibraryAsset>[0]

/** Select real output only; prompts and Agent plans are not generated results. */
export function selectionResults(nodes: readonly FreeCanvasNode[], ids?: readonly string[]): SelectionResult[] {
  const output: SelectionResult[] = [], seen = new Map<string, number>()
  const add = (value: Omit<SelectionResult, 'status'>) => {
    const identity = `${value.kind}:${value.url ?? value.text}`
    const index = seen.get(identity)
    if (index !== undefined) {
      // A library-backed occurrence proves this output is already owned, even
      // when its original generation node appeared first in the selection.
      if (value.skipped && !output[index].skipped) output[index] = { ...value, status: 'pending' }
      return
    }
    seen.set(identity, output.length); output.push({ ...value, status: 'pending' })
  }
  for (const node of selectionNodes(nodes, ids)) {
    if (node.type === 'media' && node.data.media) {
      const media = node.data.media
      add({ id: `${node.id}:media`, title: node.data.title, kind: media.mediaKind, url: media.url,
        skipped: media.libraryAssetId ? '已是资产库素材，无需重复保存' : !safeSelectionMediaUrl(media.url) ? '地址暂不可保存，请先完成上传' : undefined })
    }
    if (node.type !== 'generation') continue
    const already = Boolean(node.data.resultSource?.assetId)
    for (const [index, result] of node.data.results.entries()) add({ id: `${node.id}:result:${index}`, title: `${node.data.title} ${index + 1}`, kind: result.mediaKind, url: result.url,
      skipped: already ? '已来自资产库，无需重复保存' : !safeSelectionMediaUrl(result.url) ? '结果地址暂不可保存' : undefined })
    if (node.data.text.trim()) add({ id: `${node.id}:text`, title: node.data.title, kind: 'text', text: node.data.text,
      skipped: already ? '已来自资产库，无需重复保存' : undefined })
  }
  return output
}

export function safeSelectionMediaUrl(value: string): boolean {
  if (!value || /[\\\u0000-\u0020\u007f-\u009f]/u.test(value)) return false
  try {
    const url = new URL(value, 'https://canvas.invalid')
    if (value.startsWith('/')) return value.startsWith('/media/') && url.pathname.startsWith('/media/')
    return /^https?:\/\//i.test(value) && Boolean(url.hostname) && !url.username && !url.password
  } catch { return false }
}

export function selectionAssetInput(row: SelectionResult): SelectionAssetInput {
  if (!row.key || row.skipped) throw new Error('结果尚未准备好')
  return { kind: row.kind, title: (row.title.trim() || '画布结果').slice(0, 120), source: 'canvas-selection', tags: ['画布结果'],
    ...(row.kind === 'image' ? { coverUrl: row.url } : {}),
    data: row.kind === 'text' ? { text: row.text, assetRole: 'general' } : { serverUrl: row.url, ...(row.kind === 'image' ? { dataUrl: row.url } : { url: row.url }), mediaKind: row.kind, assetRole: 'general' },
    metadata: { selectionSaveKey: row.key } }
}

/** Unknown writes are quarantined before POST, including if the page disappears. */
export async function saveSelectionBatch(rows: readonly SelectionResult[], options: {
  current: () => boolean; verifyOwner: () => Promise<boolean>
  receipt: (key: string, value?: SelectionReceipt | null) => SelectionReceipt | null
  create: (input: SelectionAssetInput) => Promise<LibraryAssetView>
  update: (id: string, patch: Partial<SelectionResult>) => void
  lock: <T>(key: string, action: () => Promise<T>) => Promise<T>
}) {
  for (const row of rows) {
    if (!options.current()) return
    if (row.skipped || !row.key || !['pending', 'failed'].includes(row.status)) continue
    await options.lock(row.key, async () => {
      if (!options.current()) return
      const receipt = options.receipt(row.key!)
      if (receipt) { options.update(row.id, { status: receipt.status }); return }
      const owner = await options.verifyOwner()
      if (!options.current()) return
      if (!owner) throw new Error('账号状态已变化，请关闭弹窗并重新打开画布。')
      // Storage failure aborts before POST; do not silently lose the no-retry marker.
      options.receipt(row.key!, { status: 'unknown' })
      options.update(row.id, { status: 'saving', error: undefined })
      try {
        const asset = await options.create(selectionAssetInput(row))
        options.receipt(row.key!, { status: 'saved', assetId: asset.id })
        if (options.current()) options.update(row.id, { status: 'saved' })
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
        const rejected = status >= 400 && status < 500 && status !== 408 && status !== 429
        if (rejected) options.receipt(row.key!, null)
        if (options.current()) options.update(row.id, { status: rejected ? 'failed' : 'unknown', error: rejected ? '本项未保存，可重试；也可关闭后检查账号权限与素材。' : '保存结果尚未确认，请到资产库核对；此项不会重复提交。' })
      }
    })
  }
}

/** Export and Agent context use an explicit data allowlist, never runtime objects. */
export function selectionDocument(nodes: readonly FreeCanvasNode[], edges: readonly FreeCanvasEdge[], ids?: readonly string[]) {
  const selected = selectionNodes(nodes, ids), map = new Map(selected.map((node, index) => [node.id, `node-${index + 1}`]))
  const positions = absoluteNodePositions(nodes)
  const privateIds = selected.flatMap(node => node.type === 'generation'
    ? [node.data.task?.id, node.data.task?.clientRequestId, node.data.resultSource?.runId, node.data.resultSource?.assetId]
    : node.type === 'agent' ? [node.data.runId, node.data.clientRequestId, node.data.deliveredRunId, ...node.data.steps.map(step => step.id)] : [])
    .filter((value): value is string => Boolean(value))
  const privateUrls = selected.flatMap(node => node.type === 'generation'
    ? [...node.data.results.flatMap(result => [result.url, result.poster]), ...node.data.references.map(reference => reference.url)]
    : node.type === 'media' ? [node.data.media?.url] : []).filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length)
  const clean = (value: string) => {
    let text = value
    for (const url of privateUrls) text = text.split(url).join('[素材地址已省略]')
    text = text.replace(/(?:https?:\/\/|blob:|data:|\/\/)[^\s<>"']+|\/media\/[^\s<>"']+/gi, '[素材地址已省略]')
    for (const id of privateIds) text = text.split(id).join('[任务标识已省略]')
    return text
  }
  return { format: 'oaooao-selection-v1', note: '选区结构与创作文本；媒体文件、地址和运行状态未导出。',
    nodes: selected.map(node => ({ id: map.get(node.id)!, type: node.type,
      position: node.parentId && map.has(node.parentId) ? node.position : positions.get(node.id),
      ...(node.parentId && map.has(node.parentId) ? { parentId: map.get(node.parentId) } : {}),
      data: { kind: node.data.kind, title: clean(node.data.title),
        ...(node.type === 'generation' ? { prompt: clean(node.data.prompt), text: clean(node.data.text), model: clean(node.data.model), ratio: clean(node.data.ratio), quality: clean(node.data.quality), seconds: node.data.seconds, count: node.data.count, voice: clean(node.data.voice), format: clean(node.data.format) } : {}),
        ...(node.type === 'agent' ? { prompt: clean(node.data.prompt) } : {}),
        ...(node.type === 'media' && node.data.media ? { mediaKind: node.data.media.mediaKind } : {}) } })),
    connections: edges.filter(edge => map.has(edge.source) && map.has(edge.target)).map((edge, index) => ({ id: `edge-${index + 1}`, source: map.get(edge.source), target: map.get(edge.target) })) }
}

export function selectionAgentPrompt(nodes: readonly FreeCanvasNode[], edges: readonly FreeCanvasEdge[], ids?: readonly string[]) {
  const document = selectionDocument(nodes, edges, ids)
  const kinds = { image: '图片生成', video: '视频生成', text: '文本生成', audio: '音频生成', reference: '参考素材', asset: '素材', agent: 'Agent 任务', group: '分组' }
  const mediaKinds = { image: '图片', video: '视频', audio: '音频' }
  const names = new Map(document.nodes.map((node, index) => [node.id, `节点 ${index + 1}（${node.data.title.trim().replace(/\s+/gu, ' ') || '未命名'}）`]))
  const descriptions = document.nodes.map(node => {
    const data = node.data
    const paragraphs = [`${names.get(node.id)}｜${kinds[data.kind]}`]
    if (node.parentId) paragraphs.push(`所属分组：${names.get(node.parentId)}`)
    if (data.prompt?.trim()) paragraphs.push(`创作要求：\n${data.prompt}`)
    if (data.text?.trim()) paragraphs.push(`已有生成文本：\n${data.text}`)
    if (node.type === 'generation') {
      const parameters: string[] = []
      if (data.model?.trim()) parameters.push(`模型：${data.model}`)
      if (data.kind === 'image' || data.kind === 'video') {
        if (data.ratio?.trim()) parameters.push(`画面比例：${data.ratio}`)
        if (data.quality?.trim()) parameters.push(`质量：${data.quality}`)
      }
      if (data.kind === 'image' && Number.isFinite(data.count) && data.count! > 0) parameters.push(`数量：${data.count} 张`)
      if (data.kind === 'video' && Number.isFinite(data.seconds) && data.seconds! > 0) parameters.push(`时长：${data.seconds} 秒`)
      if (data.kind === 'audio') {
        if (data.voice?.trim()) parameters.push(`音色：${data.voice}`)
        if (data.format?.trim()) parameters.push(`格式：${data.format}`)
      }
      if (parameters.length) paragraphs.push(`当前生成参数：${parameters.join('；')}`)
    }
    if (data.mediaKind) paragraphs.push(`素材类型：${mediaKinds[data.mediaKind]}。素材地址已省略，请结合画布中的素材确认用途。`)
    return paragraphs.join('\n\n')
  })
  const connections = document.connections.length
    ? document.connections.map(edge => `${names.get(edge.source!)} → ${names.get(edge.target!)}`).join('\n')
    : '所选节点之间没有连线。'
  return [
    '请根据以下选区内容整理下一步创作任务。请先说明计划，由我确认后再生成。',
    `选区摘要（${document.nodes.length} 个节点）：`,
    ...descriptions,
    `选区内部关联：\n${connections}\n以上连线仅说明已有内容之间的关联，请先确认后续步骤。`,
    '此摘要用于表达创作意图；运行仍会结合整个画布，选区不是执行范围隔离。',
  ].join('\n\n')
}
