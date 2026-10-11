'use client'

import type { CSSProperties, PointerEvent } from 'react'
import { ImageIcon, Plus, Save, Video, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { defaultFormats, defaultVoices, filterModelsByCapability } from '@/lib/studio/studio-models'
import { useStudio } from '@/lib/studio/store'
import { useCanvasActions } from '../canvas-context'
import { useCanvasStore } from '../canvas-store'
import type { GenerationKind, NodeReference, NodeSkill, SettingsPlacement } from '../types'
import { COUNTER_SCALE, SETTINGS_POPOVER_WIDTH } from './node-kit'

const RATIO_FALLBACK = ['1:1', '4:5', '16:9', '9:16']
const VIDEO_RATIO_FALLBACK = ['16:9', '9:16', '1:1']
const IMAGE_QUALITY_FALLBACK = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高清' },
]
const VIDEO_QUALITY_FALLBACK = [
  { value: '480', label: '480p' },
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
]
const VIDEO_SECONDS_FALLBACK = ['4', '5', '8', '10']
const IMAGE_COUNTS = ['1', '2', '3', '4']
const SETTINGS_SIDE_GAP = 16

const CAPABILITY: Record<GenerationKind, 'image' | 'video' | 'text' | 'audio'> = { image: 'image', video: 'video', text: 'text', audio: 'audio' }

const SECTION_TITLE = 'text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500'

export function GenerationSettings({ nodeId, placement }: { nodeId: string; placement: SettingsPlacement }) {
  const node = useCanvasStore((store) => store.nodes.find((item) => item.id === nodeId))
  const incomingCount = useCanvasStore((store) => store.edges.filter((edge) => edge.target === nodeId).length)
  const updateNodeData = useCanvasStore((store) => store.updateNodeData)
  const openSettings = useCanvasStore((store) => store.openSettings)
  const setAssetPanel = useCanvasStore((store) => store.setAssetPanel)
  const { state } = useStudio()
  const actions = useCanvasActions()

  if (!node || node.type !== 'generation') return null
  const data = node.data
  const capability = CAPABILITY[data.kind]
  const models = filterModelsByCapability(state.models, capability)
  const selectedModel = models.find((model) => model.id === data.model)
  const caps = selectedModel?.capabilities
  const ratios = caps?.ratios.length ? caps.ratios : data.kind === 'video' ? VIDEO_RATIO_FALLBACK : RATIO_FALLBACK
  const qualities = caps?.qualities.length
    ? caps.qualities.map((value) => ({ value, label: value }))
    : data.kind === 'video' ? VIDEO_QUALITY_FALLBACK : IMAGE_QUALITY_FALLBACK
  const durations = caps?.durations.length ? caps.durations : VIDEO_SECONDS_FALLBACK
  const maxReferences = caps?.maxReferences && caps.maxReferences > 0 ? caps.maxReferences : 4
  const estimate = actions.estimateNode(data)
  const stop = (event: PointerEvent) => event.stopPropagation()

  const { side, offset } = placement
  const style: CSSProperties = {
    position: 'absolute',
    top: offset.y,
    width: SETTINGS_POPOVER_WIDTH,
    transform: COUNTER_SCALE,
    transformOrigin: side === 'right' ? 'top left' : 'top right',
    ...(side === 'right'
      ? { left: '100%', marginLeft: SETTINGS_SIDE_GAP + offset.x }
      : { right: '100%', marginRight: SETTINGS_SIDE_GAP - offset.x }),
  }

  return (
    <section
      role="dialog"
      aria-label="节点配置"
      className="nowheel nodrag z-50 flex max-h-[min(460px,70vh)] flex-col gap-4 overflow-y-auto rounded-2xl border border-white/20 bg-neutral-950 p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.8)]"
      style={style}
      onPointerDown={stop}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">节点配置</h3>
        <button type="button" aria-label="关闭节点配置" onClick={() => openSettings(null)} className="flex size-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white">
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <label className="flex flex-col gap-1.5">
        <span className={SECTION_TITLE}>模型</span>
        <select
          value={data.model}
          onChange={(event) => updateNodeData(nodeId, { model: event.target.value }, { history: true })}
          className="h-9 rounded-lg border border-white/15 bg-black px-2.5 text-sm text-white focus-visible:outline-2 focus-visible:outline-white"
        >
          <option value="">自动（默认模型）</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>{model.shortName || model.name}</option>
          ))}
        </select>
      </label>

      {data.kind === 'image' || data.kind === 'video' ? (
        <Segmented label="比例" value={data.ratio} options={ratios.map((value) => ({ value, label: value }))} onChange={(value) => updateNodeData(nodeId, { ratio: value }, { history: true })} />
      ) : null}

      {data.kind === 'image' || data.kind === 'video' ? (
        <Segmented label="清晰度" value={data.quality} options={qualities} onChange={(value) => updateNodeData(nodeId, { quality: value }, { history: true })} />
      ) : null}

      {data.kind === 'video' ? (
        <Segmented label="时长" value={String(data.seconds)} options={durations.map((value) => ({ value: String(value), label: `${value} 秒` }))} onChange={(value) => updateNodeData(nodeId, { seconds: Number(value) }, { history: true })} />
      ) : null}

      {data.kind === 'image' ? (
        <Segmented label="数量" value={String(data.count)} options={IMAGE_COUNTS.map((value) => ({ value, label: `${value} 张` }))} onChange={(value) => updateNodeData(nodeId, { count: Number(value) }, { history: true })} />
      ) : null}

      {data.kind === 'audio' ? (
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1.5">
            <span className={SECTION_TITLE}>音色</span>
            <select value={data.voice} onChange={(event) => updateNodeData(nodeId, { voice: event.target.value }, { history: true })} className="h-9 rounded-lg border border-white/15 bg-black px-2 text-sm text-white">
              {defaultVoices().map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={SECTION_TITLE}>格式</span>
            <select value={data.format} onChange={(event) => updateNodeData(nodeId, { format: event.target.value }, { history: true })} className="h-9 rounded-lg border border-white/15 bg-black px-2 text-sm text-white">
              {defaultFormats().map((format) => (
                <option key={format} value={format}>{format}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {data.kind === 'image' || data.kind === 'video' ? (
        <section aria-label="参考素材" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className={SECTION_TITLE}>参考素材</span>
            <span className="text-[11px] text-neutral-500">{data.references.length}/{maxReferences}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {incomingCount ? `已连线 ${incomingCount} 个上游节点，会自动作为参考。` : '连线的上游节点会自动作为参考。'}
          </p>
          <ReferenceChips references={data.references} onRemove={(id) => updateNodeData(nodeId, { references: data.references.filter((item) => item.id !== id) }, { history: true })} />
          <button
            type="button"
            onClick={() => setAssetPanel(true, nodeId)}
            disabled={data.references.length >= maxReferences}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/15 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            从资产库添加
          </button>
        </section>
      ) : null}

      <section aria-label="技能" className="flex flex-col gap-2">
        <span className={SECTION_TITLE}>技能</span>
        <SkillChips skills={data.skills} onRemove={(id) => updateNodeData(nodeId, { skills: data.skills.filter((item) => item.id !== id) }, { history: true })} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setAssetPanel(true, nodeId)} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/15 text-xs text-neutral-200 hover:bg-white/10">
            <Plus className="size-3.5" aria-hidden="true" />
            选择技能
          </button>
          <button type="button" onClick={() => void actions.saveSkillFromNode(nodeId)} disabled={!data.prompt.trim()} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/15 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40">
            <Save className="size-3.5" aria-hidden="true" />
            存为技能
          </button>
        </div>
      </section>

      <p className="border-t border-white/10 pt-3 text-xs text-neutral-400">
        {estimate > 0 ? `预计消耗 ${estimate} 积分` : '积分以任务实际结算为准'}
      </p>
    </section>
  )
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={SECTION_TITLE}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-8 min-w-12 rounded-lg border px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-white',
                active ? 'border-white bg-white text-black' : 'border-white/15 text-neutral-300 hover:border-white/40 hover:text-white',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ReferenceChips({ references, onRemove }: { references: NodeReference[]; onRemove: (id: string) => void }) {
  if (!references.length) return null
  return (
    <ul className="flex flex-col gap-1.5">
      {references.map((reference) => (
        <li key={reference.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black">
            {reference.mediaKind === 'image' ? (
              <img src={reference.url} alt="" loading="lazy" className="size-full object-cover" />
            ) : reference.mediaKind === 'video' ? (
              <Video className="size-4 text-neutral-400" aria-hidden="true" />
            ) : (
              <ImageIcon className="size-4 text-neutral-400" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-neutral-200">{reference.title}</span>
          <button type="button" aria-label={`移除参考 ${reference.title}`} onClick={() => onRemove(reference.id)} className="flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-white">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function SkillChips({ skills, onRemove }: { skills: NodeSkill[]; onRemove: (id: string) => void }) {
  if (!skills.length) return <p className="text-[11px] text-neutral-500">未引用技能。技能是资产库中的文本提示词，会追加到生成内容中。</p>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <li key={skill.id} className="flex max-w-full items-center gap-1 rounded-full border border-white/20 py-1 pr-1 pl-2.5 text-xs text-neutral-200">
          <span className="min-w-0 truncate">{skill.title}</span>
          <button type="button" aria-label={`移除技能 ${skill.title}`} onClick={() => onRemove(skill.id)} className="flex size-5 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white">
            <X className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}
