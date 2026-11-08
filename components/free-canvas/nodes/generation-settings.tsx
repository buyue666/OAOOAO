'use client'

import type { ReactNode } from 'react'
import { AudioLines, ImageIcon, Link2, Plus, SlidersHorizontal, X } from 'lucide-react'
import { defaultFormats, defaultModelFor, defaultVoices, filterModelsByCapability, imageQualityOptions, qualityLabel } from '@/lib/studio/studio-models'
import { availableTeamModels } from '@/lib/studio/team-generation'
import { selectableVideoDurations } from '@/lib/studio/video-policy'
import { referenceMentionLabel } from '@/lib/studio/prompt-references'
import { useStudio } from '@/lib/studio/store'
import { ModelNote } from '@/components/studio/ui'
import { useCanvasActions } from '../canvas-context'
import { useCanvasStore } from '../canvas-store'
import { canvasReferences, canvasVideoMode, remapCanvasMentions } from '../canvas-generation-policy'
import type { NodeReference, SettingsPlacement } from '../types'

const FIELD = 'h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-foreground disabled:opacity-100'

export function videoDurationOptions(values: readonly string[]) {
  return [...new Set(values.map(value => {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*$/i.exec(value)
    return match ? Number(match[1]) : NaN
  }).filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b).map(seconds => ({ value: String(seconds), label: `${seconds} 秒` }))
}

/** A screen-space inspector stays readable at every canvas zoom level. */
export function GenerationSettings({ nodeId }: { nodeId: string; placement?: SettingsPlacement }) {
  const node = useCanvasStore(store => store.nodes.find(item => item.id === nodeId))
  const revision = useCanvasStore(store => store.revision)
  const workspace = useCanvasStore(store => store.workspace)
  const update = useCanvasStore(store => store.updateNodeData)
  const { state } = useStudio()
  const actions = useCanvasActions()
  if (!node || node.type !== 'generation') return null
  const data = node.data, store = useCanvasStore.getState()
  void revision
  const references = canvasReferences(nodeId, data, store.nodes, store.edges)
  const models = filterModelsByCapability(workspace ? availableTeamModels(state.models, workspace.modelIds, state.sessionSettings) : state.models, data.kind)
  const effectiveId = data.model || defaultModelFor(data.kind, state.sessionSettings, models)
  const model = models.find(item => item.id === effectiveId), caps = model?.capabilities
  const busy = Boolean(workspace?.readOnly || data.task?.phase === 'queued' || data.task?.phase === 'running' || data.task?.unconfirmed)
  const qualities = data.kind === 'image' ? imageQualityOptions(model, data.resolution) : caps?.qualities ?? []
  const durations = videoDurationOptions(selectableVideoDurations(model, data.quality, canvasVideoMode(references)))
  const secondsIndex = durations.findIndex(item => Number(item.value) === data.seconds)
  const patch = (value: Record<string, unknown>) => update(nodeId, value, { history: true })
  const changeModel = (id: string) => {
    const next = models.find(item => item.id === (id || defaultModelFor(data.kind, state.sessionSettings, models)))
    if (!next) return patch({ model: id })
    const policy = next.capabilities
    const resolution = policy.resolutions.includes(data.resolution) ? data.resolution : policy.resolutions[0] || data.resolution
    const options = data.kind === 'image' ? imageQualityOptions(next, resolution) : policy.qualities
    const quality = options.includes(data.quality) ? data.quality : options[0] || data.quality
    const times = videoDurationOptions(selectableVideoDurations(next, quality, canvasVideoMode(references)))
    patch({ model: id, resolution, quality, ratio: policy.ratios.includes(data.ratio) ? data.ratio : policy.ratios[0] || data.ratio, seconds: times.some(item => Number(item.value) === data.seconds) ? data.seconds : Number(times[0]?.value || data.seconds) })
  }
  const changeQuality = (quality: string) => {
    const times = videoDurationOptions(selectableVideoDurations(model, quality, canvasVideoMode(references)))
    patch({ quality, ...(data.kind === 'video' ? { seconds: times.some(item => Number(item.value) === data.seconds) ? data.seconds : Number(times[0]?.value || data.seconds) } : {}) })
  }
  const setRole = (reference: NodeReference, role: NodeReference['role']) => {
    const refs = data.references.some(item => item.url === reference.url)
      ? data.references.map(item => item.url === reference.url ? { ...item, role } : item)
      : [...data.references, { ...reference, role }]
    const next = canvasReferences(nodeId, { ...data, references: refs }, store.nodes, store.edges)
    patch({ references: refs, prompt: remapCanvasMentions(data.prompt, references, next) })
  }
  const removeReference = (reference: NodeReference) => {
    const edges = store.edges.filter(edge => {
      if (edge.target !== nodeId) return false
      const source = store.nodes.find(item => item.id === edge.source)
      return (source?.type === 'media' ? source.data.media?.url : source?.type === 'generation' ? source.data.results[0]?.url : undefined) === reference.url
    })
    const next = references.filter(item => item.url !== reference.url)
    patch({ references: data.references.filter(item => item.url !== reference.url), prompt: remapCanvasMentions(data.prompt, references, next) })
    if (edges.length) store.onEdgesChange(edges.map(edge => ({ type: 'remove', id: edge.id })))
  }
  return <aside aria-label="节点配置" className="nowheel nodrag absolute top-36 right-3 bottom-36 sm:inset-y-20 z-30 flex w-[min(360px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl">
    <header className="flex items-center gap-3 border-b border-border px-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"><SlidersHorizontal className="size-4" /></span>
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">参数与素材</h2><p className="truncate text-xs text-muted-foreground" title={data.title}>{data.title}</p></div>
      <button type="button" aria-label="关闭节点配置" onClick={() => store.openSettings(null)} className="flex size-11 items-center justify-center rounded-xl hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /></button>
    </header>
    <div className="flex-1 space-y-5 overflow-y-auto p-4">
      {busy && <p role="status" className="rounded-xl bg-muted p-3 text-xs leading-5 text-muted-foreground">{workspace?.readOnly ? '审阅模式，可查看配置与生成结果。' : '任务进行中或提交尚未确认，参数暂时锁定。'}</p>}
      <fieldset disabled={busy} className="space-y-5">
        <Field label={<span className="flex items-center gap-1.5">生成模型{model?.note && <ModelNote note={model.note} />}</span>}>
          <select aria-label="生成模型" value={data.model} onChange={event => changeModel(event.target.value)} className={FIELD}>
            <option value="">使用我的默认模型{model ? ` · ${model.shortName || model.name}` : ''}</option>
            {models.map(item => <option key={item.id} value={item.id}>{item.shortName || item.name}</option>)}
          </select>
          {!models.length && <p className="text-xs text-muted-foreground">当前空间没有可用的{data.kind === 'image' ? '图片' : data.kind === 'video' ? '视频' : data.kind === 'audio' ? '音频' : '文本'}模型。</p>}
        </Field>
        {(data.kind === 'image' || data.kind === 'video') && <div className="grid grid-cols-2 gap-3">
          <Field label="画面比例"><select aria-label="画面比例" value={data.ratio} onChange={event => patch({ ratio: event.target.value })} className={FIELD}>{!caps?.ratios.includes(data.ratio) && <option value={data.ratio}>{data.ratio || '请选择比例'}</option>}{caps?.ratios.map(value => <option key={value}>{value}</option>)}</select></Field>
          <Field label="清晰度"><select aria-label="清晰度" value={data.kind === 'image' ? data.resolution : data.quality} onChange={event => data.kind === 'image' ? patch({ resolution: event.target.value, quality: imageQualityOptions(model, event.target.value).includes(data.quality) ? data.quality : imageQualityOptions(model, event.target.value)[0] }) : changeQuality(event.target.value)} className={FIELD}>{(data.kind === 'image' ? caps?.resolutions ?? [] : qualities).map(value => <option key={value} value={value}>{data.kind === 'image' ? value : qualityLabel(value, caps?.qualityLabels)}</option>)}</select></Field>
        </div>}
        {data.kind === 'image' && <Field label="图片质量"><select aria-label="图片质量" value={data.quality} onChange={event => patch({ quality: event.target.value })} className={FIELD}>{qualities.map(value => <option key={value} value={value}>{qualityLabel(value, caps?.qualityLabels)}</option>)}</select></Field>}
        {data.kind === 'video' && <Field label={<span className="flex items-center justify-between">视频时长<strong className="font-mono text-sm text-foreground">{data.seconds} 秒</strong></span>}>
          <input aria-label="视频时长" aria-valuetext={`${data.seconds} 秒`} type="range" min={0} max={Math.max(0, durations.length - 1)} step={1} value={Math.max(0, secondsIndex)} disabled={!durations.length || busy} onChange={event => patch({ seconds: Number(durations[Number(event.target.value)]?.value || data.seconds) })} className="h-11 w-full accent-primary" />
          {durations.length ? <div className="flex justify-between text-xs text-muted-foreground"><span>{durations[0].label}</span><span>{durations.at(-1)?.label}</span></div> : <p className="text-xs text-muted-foreground">{caps?.durations.length ? '当前清晰度与素材模式没有可用时长。' : `模型未提供可选时长，沿用 ${data.seconds} 秒；提交前会核价。`}</p>}
          {durations.length > 0 && secondsIndex < 0 && <button type="button" onClick={() => patch({ seconds: Number(durations[0].value) })} className="min-h-11 text-xs text-destructive underline">当前时长不可用，恢复为 {durations[0].label}</button>}
        </Field>}
        {data.kind === 'audio' && <div className="grid grid-cols-2 gap-3"><Field label="音色"><select aria-label="音色" value={data.voice} onChange={event => patch({ voice: event.target.value })} className={FIELD}>{defaultVoices().map(value => <option key={value}>{value}</option>)}</select></Field><Field label="格式"><select aria-label="音频格式" value={data.format} onChange={event => patch({ format: event.target.value })} className={FIELD}>{defaultFormats().map(value => <option key={value}>{value}</option>)}</select></Field></div>}
        {(data.kind === 'image' || data.kind === 'video') && <section className="space-y-3 border-t border-border pt-4" aria-label="参考素材">
          <div className="flex items-center justify-between"><h3 className="text-xs font-medium">参考素材</h3><span className={references.length > (caps?.maxReferences ?? 0) ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{references.length} / {caps?.maxReferences ?? 0}</span></div>
          <p className="text-xs leading-5 text-muted-foreground">在提示词中输入 @ 选择素材。连线上游的首个结果也会作为参考。</p>
          <ul className="space-y-2">{references.map((reference, index) => <li key={reference.url} className="rounded-xl border border-border bg-background p-2">
            <div className="flex items-center gap-2"><span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">{reference.mediaKind === 'image' ? <img src={reference.url} alt="" loading="lazy" className="size-full object-cover" /> : reference.mediaKind === 'audio' ? <AudioLines className="size-4" /> : <ImageIcon className="size-4" />}</span><div className="min-w-0 flex-1"><span className="prompt-reference-mention text-xs font-medium">{referenceMentionLabel(references.map(ref => ({ type: ref.mediaKind })), index)}</span><p className="truncate text-xs" title={reference.title}>{reference.title}</p></div><button type="button" aria-label={`移除参考 ${reference.title}`} title="移除参考；连线素材会同时断开连线" onClick={() => removeReference(reference)} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button></div>
            {data.kind === 'video' && reference.mediaKind === 'image' && (caps?.firstFrame || caps?.lastFrame) && <select aria-label={`${reference.title}的用途`} value={reference.role || 'reference'} onChange={event => setRole(reference, event.target.value as NodeReference['role'])} className={`${FIELD} mt-2`}><option value="reference">参考图片</option>{caps.firstFrame && <option value="first_frame">首帧</option>}{caps.lastFrame && <option value="last_frame">尾帧</option>}</select>}
          </li>)}</ul>
          <button type="button" onClick={() => store.setAssetPanel(true, nodeId)} disabled={!caps || references.length >= caps.maxReferences} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs hover:bg-muted disabled:opacity-40"><Plus className="size-4" />{workspace ? '从项目素材添加' : '从创作资产添加'}</button>
          {data.kind === 'video' && <p className="flex gap-1.5 text-xs leading-5 text-muted-foreground"><Link2 className="mt-0.5 size-3.5 shrink-0" />首尾帧可搭配模型支持的图片、音频参考；不能搭配参考视频。</p>}
        </section>}
        {!workspace && <details className="border-t border-border pt-4"><summary className="min-h-11 cursor-pointer text-xs font-medium">可复用技能{data.skills.length ? ` · ${data.skills.length}` : ''}</summary><div className="space-y-2">{data.skills.map(skill => <div key={skill.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted pl-3 text-xs"><span className="truncate" title={skill.title}>{skill.title}</span><button type="button" aria-label={`移除技能 ${skill.title}`} onClick={() => patch({ skills: data.skills.filter(item => item.id !== skill.id) })} className="flex size-11 items-center justify-center"><X className="size-3.5" /></button></div>)}<button type="button" onClick={() => actions.selectSkills(nodeId)} className={`${FIELD} text-left`}>选择技能</button><button type="button" onClick={() => void actions.saveSkillFromNode(nodeId)} className={`${FIELD} text-left`}>将提示词存为技能</button></div></details>}
      </fieldset>
    </div>
    <footer className="border-t border-border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">{workspace ? '使用团队积分，结果自动保存到项目素材。' : '结果与参数会自动保存到当前画布。'}{data.kind === 'video' || workspace ? '生成前会确认费用。' : `预计 ${actions.estimateNode(data)} 积分。`}</footer>
  </aside>
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-2"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
}
