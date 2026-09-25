import { media, models } from './mock-data'
import type { AgentPlan, AgentStep, GenerationSettings, ModelConfig, Task, TaskType, Work } from './types'

export function getModel(modelId: string, modelList: ModelConfig[] = models) {
  return modelList.find((model) => model.id === modelId) ?? modelList[0]
}

export function estimateCredits(modelId: string, settings: Partial<GenerationSettings> = {}, modelList: ModelConfig[] = models) {
  const model = getModel(modelId, modelList)
  const count = settings.count ?? 1
  const duration = Number.parseInt(settings.duration ?? '5', 10) || 5
  const durationMultiplier = model.kind === 'video' ? Math.max(1, Math.ceil(duration / 5)) : 1
  const qualityMultiplier = settings.quality === '超清' ? 1.6 : settings.quality === '高清' ? 1.25 : 1
  return Math.ceil(model.creditCost * count * durationMultiplier * qualityMultiplier)
}

export function createDemoTask(input: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
  const now = Date.now()
  const id = `task-${now}-${Math.random().toString(36).slice(2, 7)}`
  return {
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
  }
}

export function createAgentPlan(context: string, title = '导演 Agent 计划'): AgentPlan {
  const steps: AgentStep[] = [
    { id: 'step-01', label: '理解当前素材', detail: '读取项目、镜头与参考素材关系', status: 'pending' },
    { id: 'step-02', label: '整理生成参数', detail: '根据模型能力选择比例与时长', status: 'pending' },
    { id: 'step-03', label: '执行候选生成', detail: '创建演示任务，不会调用真实供应商', status: 'pending' },
    { id: 'step-04', label: '回写项目结果', detail: '保留已完成候选，避免重复添加', status: 'pending' },
  ]
  return {
    id: `agent-${Date.now()}`,
    title,
    context,
    model: 'Motion 03',
    credits: 96,
    scope: '当前项目 · 选中镜头',
    status: 'draft',
    steps,
    createdAt: Date.now(),
  }
}

export function getTaskLabel(status: Task['status']) {
  return {
    queued: '排队中',
    processing: '生成中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status]
}

export function getTaskTone(status: Task['status']) {
  const tones = {
    queued: 'neutral',
    processing: 'accent',
    completed: 'success',
    failed: 'warning',
    cancelled: 'muted',
  } as const
  return tones[status]
}

export function demoResultForTask(task: Task) {
  return {
    id: `work-${task.id}`,
    title: task.title.replace('候选', '结果'),
    kind: (task.type === 'video' ? 'video' : 'image') as Work['kind'],
    src: task.type === 'video' ? media.video : media.auroraCover,
    poster: task.type === 'video' ? media.videoPoster : undefined,
    fallback: '演示生成结果',
    projectId: task.projectId,
    status: '草稿' as const,
    updatedAt: '刚刚',
    ratio: task.settings.ratio,
    model: getModel(task.settings.modelId).name,
  }
}
