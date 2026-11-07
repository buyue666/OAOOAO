'use client'

import { useEffect, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { RefreshCw, Sparkles, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { request } from '@/lib/studio/api'
import { newClientRequestId, normalizeTaskResult } from '@/lib/studio/generation-api'
import type { GenerationTask } from '@/lib/studio/generation-types'
import { useStudio } from '@/lib/studio/store'
import { availableTeamModels, readPendingTeamGeneration, teamSubmissionUncertain, type PendingTeamGeneration } from '@/lib/studio/team-generation'
import { selectableVideoDurations } from '@/lib/studio/video-policy'
import { useTeamAction, useTeamQuery } from '@/lib/studio/team-api'
import { isTeamManager, teamNumber, type TeamAsset, type TeamProject, type TeamSummary } from '@/lib/studio/team-types'
import { TeamError, TeamLoading } from './team-feedback'

type TeamTask = GenerationTask & { prompt: string; createdAt: number; updatedAt: number; actorId?: string }
type Kind = 'image' | 'video' | 'audio' | 'text'
const kinds: Record<Kind, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }
const statusLabels: Record<string, string> = { pending: '排队中', running: '生成中', paused: '已暂停', success: '已完成', error: '失败', cancelled: '已取消' }
const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring'

export function TeamProjectGeneration({ team, project, references, onReferencesChange }: { team: TeamSummary; project: TeamProject; references: TeamAsset[]; onReferencesChange: (items: TeamAsset[]) => void }) {
  const { state } = useStudio()
  const root = `/api/teams/${team.id}/projects/${project.id}/generations`
  const tasks = useTeamQuery<{ tasks: TeamTask[] }>(root, 5000)
  const action = useTeamAction()
  return <div className="flex flex-col gap-6">
    {team.role !== 'reviewer' && <TeamGenerationForm team={team} project={project} references={references} onReferencesChange={onReferencesChange} />}
    <section className="flex flex-col gap-4" aria-labelledby="team-task-history"><div className="flex items-center justify-between gap-3"><h2 id="team-task-history" className="text-lg font-semibold">项目生成任务</h2><Button variant="outline" size="sm" onClick={() => void tasks.mutate()}><RefreshCw className="size-4" />刷新</Button></div><TeamError error={tasks.error || action.error} />
      {tasks.isLoading ? <TeamLoading /> : tasks.data && (tasks.data.tasks.length ? <div className="grid gap-4 lg:grid-cols-2">{tasks.data.tasks.map(task => {
        const output = normalizeTaskResult(task.kind, task.result)
        return <Card key={task.id} className="min-w-0"><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>{kinds[task.kind as Kind] || '创作'}任务</CardTitle><span className="text-xs text-muted-foreground">{statusLabels[task.status] || task.status}</span></div><p className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleString('zh-CN')} · {teamNumber(task.pointsCost ?? 0)} 积分</p></CardHeader><CardContent className="flex flex-col gap-3"><p className="whitespace-pre-wrap break-words text-sm">{task.prompt}</p>{task.error && <p role="alert" className="break-words text-sm text-destructive">{task.error}</p>}{task.needsReview && <p className="text-sm text-muted-foreground">任务结果待人工核实，请联系管理员。</p>}
          {!!output.media.length && <div className="grid grid-cols-2 gap-3">{output.media.map(media => <div key={media.url} className="min-w-0 rounded-lg border border-border bg-muted/30 p-2">{media.kind === 'image' ? <a href={media.url} target="_blank" rel="noreferrer" aria-label="预览生成图片"><img src={media.url} alt="团队生成图片" loading="lazy" className="aspect-square w-full object-contain" /></a> : media.kind === 'video' ? <video src={media.url} controls preload="metadata" className="aspect-square w-full object-contain" /> : <audio src={media.url} controls preload="none" className="w-full" />}{team.canDownload && <a className="mt-2 inline-flex min-h-11 items-center text-xs underline" href={`${media.url}?download=1`}>下载结果</a>}</div>)}</div>}
          {output.text && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm">{output.text}</pre>}
          {team.role !== 'reviewer' && ['pending', 'running', 'paused'].includes(task.status) && (isTeamManager(team.role) || task.actorId === state.user.id) && <Button variant="outline" className="w-fit" disabled={action.pending || task.cancelRequested} onClick={() => void action.run(`${root}/${task.id}/cancel`)}>{task.cancelRequested ? '已申请取消，等待上游确认' : '取消任务'}</Button>}
        </CardContent></Card>
      })}</div> : <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">还没有生成任务。</p>)}
    </section>
  </div>
}

function TeamGenerationForm({ team, project, references, onReferencesChange }: { team: TeamSummary; project: TeamProject; references: TeamAsset[]; onReferencesChange: (items: TeamAsset[]) => void }) {
  const { state } = useStudio()
  const { mutate } = useSWRConfig()
  const [kind, setKind] = useState<Kind>('image')
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('')
  const [resolution, setResolution] = useState('')
  const [quality, setQuality] = useState('')
  const [seconds, setSeconds] = useState('')
  const [count, setCount] = useState(1)
  const [roles, setRoles] = useState<Record<string, string>>({})
  const [voice, setVoice] = useState('alloy')
  const [format, setFormat] = useState('mp3')
  const [pending, setPending] = useState(false)
  const [recovery, setRecovery] = useState<PendingTeamGeneration | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [quote, setQuote] = useState<{ fingerprint: string; points: number; requestId: string } | null>(null)
  const busy = useRef(false)
  const root = `/api/teams/${team.id}/projects/${project.id}/generations`
  const recoveryKey = `oao-team-generation:${state.user.id}:${team.id}:${project.id}`
  useEffect(() => {
    try { setRecovery(readPendingTeamGeneration(sessionStorage.getItem(recoveryKey))) } catch { /* Memory recovery still works when storage is unavailable. */ }
  }, [recoveryKey])
  const models = availableTeamModels(state.liveModels, team.modelIds || [], state.sessionSettings).filter(model => model.capability === kind)
  const model = models.find(item => item.id === modelId)
  const caps = model?.capabilities
  const ratios = caps?.ratios ?? []
  const resolutions = (kind === 'video' ? caps?.qualities : caps?.resolutions) ?? []
  const qualities = caps?.qualities ?? []
  const chosenRatio = ratios.includes(ratio) ? ratio : ratios[0]
  const chosenResolution = resolutions.includes(resolution) ? resolution : resolutions[0]
  const videoMode = references.some(asset => roles[asset.id] === 'last_frame') ? 'ends' : references.some(asset => roles[asset.id] === 'first_frame') ? 'first' : references.length ? 'references' : 'text'
  const durations = kind === 'video' ? selectableVideoDurations(model, chosenResolution || '', videoMode) : []
  const chosenSeconds = durations.includes(seconds) ? seconds : durations[0]
  const chosenQuality = qualities.includes(quality) ? quality : qualities[0]
  const payload = { kind, prompt: prompt.trim(), config: { model: modelId, ...(kind === 'image' ? { n: count, size: chosenRatio, resolution: chosenResolution, quality: chosenQuality } : kind === 'video' ? { size: chosenRatio, vquality: chosenResolution, videoSeconds: Number.parseInt(chosenSeconds) || 4 } : kind === 'audio' ? { voice, format } : {}) }, references: references.map(asset => ({ url: asset.url, type: asset.kind, name: asset.title, role: kind === 'video' ? roles[asset.id] || 'reference' : 'reference' })) }
  const fingerprint = JSON.stringify(payload)
  const current = useRef(fingerprint)
  current.current = fingerprint
  const quoted = quote?.fingerprint === fingerprint ? quote : null
  const active = !!team.subscriptionExpiresAt && Date.parse(team.subscriptionExpiresAt) > Date.now()
  const invalidReferences = (kind === 'audio' || kind === 'text') && references.length > 0 || kind === 'image' && references.some(asset => asset.kind !== 'image')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy.current || (!recovery && (!model || !payload.prompt || !active || invalidReferences))) return
    busy.current = true; setPending(true); setError(''); setNotice('')
    const submission = recovery || (quoted ? { requestId: quoted.requestId, points: quoted.points, payload } : null)
    try {
      if (!submission) {
        const result = await request<{ points: number }>(`${root}/quote`, { method: 'POST', body: fingerprint })
        if (!Number.isFinite(result.points) || result.points < 0) throw new Error('服务器报价无效，请重新获取。')
        if (current.current === fingerprint) setQuote({ fingerprint, points: result.points, requestId: newClientRequestId('team') })
      } else {
        setRecovery(submission)
        try { sessionStorage.setItem(recoveryKey, JSON.stringify(submission)) } catch { /* Keep the same operation in memory. */ }
        const result = await request<{ task: TeamTask }>(root, { method: 'POST', headers: { 'idempotency-key': submission.requestId }, body: JSON.stringify({ ...submission.payload, approvedCost: submission.points }) })
        if (!result.task?.id) throw new Error('提交响应不完整，请沿用原提交标识重新确认。')
        setRecovery(null); setQuote(null); setNotice(`任务已提交，预计消耗 ${teamNumber(submission.points)} 团队积分。`)
        try { sessionStorage.removeItem(recoveryKey) } catch { /* Repeating this operation remains idempotent. */ }
        await mutate(key => Array.isArray(key) && key[0] === 'team' && key[1] === state.user.id).catch(() => undefined)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作未完成。')
      if (submission && !teamSubmissionUncertain(reason)) { setRecovery(null); setQuote(null); try { sessionStorage.removeItem(recoveryKey) } catch { /* Server rejection is shown above. */ } }
    } finally { busy.current = false; setPending(false) }
  }
  return <Card><CardHeader><CardTitle>团队创作</CardTitle><p className="text-sm text-muted-foreground">从团队积分池结算，结果保存在当前项目。报价通过后再确认提交。</p></CardHeader><CardContent>
    {!active && <Alert className="mb-5"><AlertTitle>团队套餐尚未开通或已到期</AlertTitle><AlertDescription>请联系管理员开通团队权益，现有作品仍可按权限查看。</AlertDescription></Alert>}
    <form onSubmit={submit} className="flex flex-col gap-5"><fieldset disabled={pending || !!recovery} className="flex min-w-0 flex-col gap-5 disabled:opacity-70"><FieldGroup className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="team-generation-kind">生成类型</FieldLabel><select id="team-generation-kind" className={selectClass} value={kind} onChange={event => { setKind(event.target.value as Kind); setModelId(''); setQuote(null); setRoles({}); setCount(1) }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field><FieldLabel htmlFor="team-generation-model">选择模型</FieldLabel><select id="team-generation-model" className={selectClass} value={modelId} required onChange={event => { setModelId(event.target.value); setQuote(null); setRoles({}); setCount(1) }}><option value="">{models.length ? '请选择模型' : '当前没有可用模型'}</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      {(kind === 'image' || kind === 'video') && <>{!!ratios.length && <Field><FieldLabel htmlFor="team-generation-ratio">画幅比例</FieldLabel><select id="team-generation-ratio" className={selectClass} value={chosenRatio} onChange={event => setRatio(event.target.value)}>{ratios.map(value => <option key={value}>{value}</option>)}</select></Field>}{!!resolutions.length && <Field><FieldLabel htmlFor="team-generation-resolution">清晰度</FieldLabel><select id="team-generation-resolution" className={selectClass} value={chosenResolution} onChange={event => setResolution(event.target.value)}>{resolutions.map(value => <option key={value}>{value}</option>)}</select></Field>}</>}
      {kind === 'image' && <>{!!qualities.length && <Field><FieldLabel htmlFor="team-generation-quality">图片质量</FieldLabel><select id="team-generation-quality" className={selectClass} value={chosenQuality} onChange={event => setQuality(event.target.value)}>{qualities.map(value => <option key={value} value={value}>{caps?.qualityLabels?.[value] || value}</option>)}</select></Field>}<Field><FieldLabel htmlFor="team-generation-count">生成数量</FieldLabel><Input id="team-generation-count" type="number" min={1} max={caps?.maxBatchSize || 1} required value={count} onChange={event => setCount(Number(event.target.value))} /></Field></>}
      {kind === 'video' && !!durations.length && <Field className="sm:col-span-2"><FieldLabel htmlFor="team-generation-seconds">视频时长 · {chosenSeconds}</FieldLabel><input id="team-generation-seconds" type="range" min={0} max={Math.max(0, durations.length - 1)} value={Math.max(0, durations.indexOf(chosenSeconds))} onChange={event => setSeconds(durations[Number(event.target.value)])} className="h-11 w-full accent-primary" /></Field>}
      {kind === 'audio' && <><Field><FieldLabel htmlFor="team-generation-voice">音色</FieldLabel><Input id="team-generation-voice" value={voice} onChange={event => setVoice(event.target.value)} required /></Field><Field><FieldLabel htmlFor="team-generation-format">音频格式</FieldLabel><select id="team-generation-format" className={selectClass} value={format} onChange={event => setFormat(event.target.value)}>{['mp3', 'wav', 'aac', 'flac', 'opus'].map(value => <option key={value}>{value}</option>)}</select></Field></>}
    </FieldGroup><Field><FieldLabel htmlFor="team-generation-prompt">告诉 AI 你想创作什么</FieldLabel><Textarea id="team-generation-prompt" required maxLength={64000} rows={5} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述画面、动作或生成要求…" /></Field>
    {!!references.length && <section aria-label="团队参考素材" className="flex flex-col gap-2"><p className="text-sm font-medium">参考素材 · {references.length}</p>{references.map(asset => <div key={asset.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"><span className="min-w-0 flex-1 break-words text-sm">{asset.title}</span>{kind === 'video' && asset.kind === 'image' && caps?.firstFrame && <select aria-label={`${asset.title} 的用途`} className={selectClass + ' max-w-36'} value={roles[asset.id] || 'reference'} onChange={event => setRoles({ ...roles, [asset.id]: event.target.value })}><option value="reference">参考图片</option><option value="first_frame">首帧</option>{caps.lastFrame && <option value="last_frame">尾帧</option>}</select>}<Button type="button" variant="ghost" size="icon" aria-label={`移除参考 ${asset.title}`} onClick={() => onReferencesChange(references.filter(item => item.id !== asset.id))}><X className="size-4" /></Button></div>)}</section>}
    </fieldset>
    {invalidReferences && <p role="alert" className="text-sm text-destructive">{kind === 'image' ? '图片生成仅支持图片参考，请移除其他素材。' : '此生成类型暂不支持参考素材，请先移除。'}</p>}
    {recovery && <Alert><AlertTitle>任务提交状态尚未确认</AlertTitle><AlertDescription>待确认内容：{recovery.payload.prompt}。请重试确认，系统将沿用原提交标识核对任务，避免重复扣费。</AlertDescription></Alert>}
    <TeamError error={error} />{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-sm text-muted-foreground">{recovery || quoted ? `预计消耗 ${teamNumber((recovery || quoted)!.points)} 团队积分` : '先获取当前参数的准确报价'}</p><Button type="submit" disabled={pending || (!recovery && (!model || !prompt.trim() || !active || !!invalidReferences))}><Sparkles className="size-4" />{pending ? '正在处理…' : recovery ? '重试确认任务' : quoted ? '确认并开始生成' : '获取积分报价'}</Button></div>
    </form>
  </CardContent></Card>
}
