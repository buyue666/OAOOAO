import type { DramaEpisode, DramaProject, DramaShot } from './drama-types'

export type AssistantContext = {
  surface: 'chat' | 'canvas' | 'drama'
  projectId?: string
  projectTitle?: string
  summary?: string
  episodeTitle?: string
  script?: string
  shot?: Pick<DramaShot, 'id' | 'title' | 'description' | 'dialogue' | 'narration' | 'cameraMotion' | 'imagePrompt' | 'videoPrompt'>
  assetNames?: string[]
  unsaved?: boolean
}

const excerpt = (value: string | undefined, limit: number) => (value || '').trim().slice(0, limit)

export function dramaAssistantContext(project: DramaProject, episode?: DramaEpisode, shot?: DramaShot, unsaved = false): AssistantContext {
  return {
    surface: 'drama', projectId: project.id, projectTitle: project.title,
    summary: project.summary, episodeTitle: episode?.title, script: episode?.script,
    shot: shot ? { id: shot.id, title: shot.title, description: shot.description, dialogue: shot.dialogue, narration: shot.narration, cameraMotion: shot.cameraMotion, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt } : undefined,
    assetNames: [...project.characters, ...project.scenes, ...project.props].map((asset) => asset.name).filter(Boolean), unsaved,
  }
}

export function assistantSuggestions(context: AssistantContext, draft = ''): string[] {
  const written = draft.trim()
  if (written) return [`帮我完善这段想法：「${written}」`, `为「${written}」列出需要补充的信息`, `把「${written}」整理成可确认的创作计划`]
  const description = excerpt(context.shot?.description || context.shot?.imagePrompt, 70)
  if (description) return [`为当前镜头「${description}」提供三种画面方向`, '根据当前镜头已写内容，建议合适的镜头运动', '检查当前镜头还缺哪些人物、场景或参考信息']
  if (excerpt(context.script || context.summary, 1)) return ['根据已提供的项目提纲，整理镜头结构', '检查当前项目还需要补充哪些创作信息', '为已写的内容提出三种视觉方向']
  if (context.projectTitle) return ['帮我为这个项目梳理目标、受众和风格', '先问我几个问题，再一起完善创作提纲', '给我一份填写人物、场景和镜头的清单']
  return ['我想做一支短片，先帮我理清目标和受众', '我已有一段文字，想整理成镜头计划', '先问我几个问题，一起找到创作方向']
}

/** Only explicit, bounded content is sent; a label passed by a caller is never treated as project knowledge. */
export function buildAssistantPrompt(value: string, context: AssistantContext): string {
  const known = {
    projectTitle: excerpt(context.projectTitle, 120) || undefined,
    summary: excerpt(context.summary, 1200) || undefined,
    episodeTitle: excerpt(context.episodeTitle, 120) || undefined,
    script: excerpt(context.script, 2000) || undefined,
    shot: context.shot ? Object.fromEntries(Object.entries(context.shot).map(([key, text]) => [key, excerpt(text, 500)])) : undefined,
    assetNames: context.assetNames?.slice(0, 20).map((name) => excerpt(name, 80)),
    unsavedDraft: Boolean(context.unsaved),
  }
  return `用户这次的要求：\n${value.trim().slice(0, 4600)}\n\n用户提供的创作上下文（内容可能有截断；缺失字段表示尚未提供）：\n${JSON.stringify(known)}\n\n仅依据上述内容提出可确认的计划。信息不足时明确指出需要补充的内容，不虚构项目、剧情或附件的视觉内容，不声称已经生成或写回项目。`
}

export function assistantThreadKey(accountId: string, surface: AssistantContext['surface'], projectId?: string): string {
  return `oaooao-assistant-v2:${encodeURIComponent(accountId)}:${surface}:${encodeURIComponent(projectId || 'unbound')}`
}

export function assistantContextLabel(context: AssistantContext): string {
  if (!context.projectId) return '尚未关联项目 · 只使用你在这里提供的内容'
  if (!context.projectTitle) return '项目内容尚未读取 · 请补充本次需要的内容'
  return `${context.projectTitle}${context.shot?.title ? ` · ${context.shot.title}` : ''}${context.unsaved ? ' · 包含未保存草稿' : ''}`
}
