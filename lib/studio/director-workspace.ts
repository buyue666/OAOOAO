import type { AssistantContext } from './director-context'
import { buildAssistantPrompt } from './director-context'
import { promptReferenceMentions, referenceMentionLabel } from './prompt-references'

export const directorScenes = [
  { id: 'general', label: '通用创作', title: '从一个想法，开始创作。', description: '说出目标，一起整理成可确认、可继续的创作步骤。', placeholder: '描述你想创作什么，也可以添加素材、选择技能……', guidance: '' },
  { id: 'story', label: '短片分镜', title: '让故事，有画面。', description: '先理清叙事、节奏和镜头，再进入制作。', placeholder: '描述故事、片长、人物和你想要的风格……', guidance: '优先梳理故事结构、人物、镜头顺序与时长；信息不足时在方案中说明，不擅自补充事实。' },
  { id: 'commerce', label: '电商商品', title: '让商品，有自己的场景。', description: '从产品特点出发，规划画面与展示方式。', placeholder: '描述产品、目标人群与需要的展示画面……', guidance: '优先明确商品卖点、目标人群、展示场景和构图；有产品参考图时将其作为生成参考，保持外观一致。' },
  { id: 'character', label: '角色设定', title: '让角色，逐渐清晰。', description: '统一外观与造型，建立可复用的角色参考。', placeholder: '描述角色身份、外观、服饰与用途……', guidance: '优先整理人物外观、服饰、性格和所需视图；相关画面应尽量保持角色一致。' },
  { id: 'ad', label: '营销广告', title: '让卖点，成为好创意。', description: '先想清楚对谁说什么，再决定如何呈现。', placeholder: '描述推广对象、受众、投放平台与目标……', guidance: '优先明确传播目标、受众、投放平台、核心卖点和内容结构，再规划制作步骤。' },
] as const
export type DirectorScene = typeof directorScenes[number]['id']

export const directorStarters = [
  { scene: 'story', title: '把故事变成分镜', description: '先理清人物、节奏与镜头', prompt: '帮我把“一个普通上班族在下班路上遇见未来的自己”整理成 30 秒短片分镜。先梳理故事与镜头方案，再让我确认制作步骤。' },
  { scene: 'commerce', title: '为商品设计一组场景', description: '从产品特点到画面方案', prompt: '为一款白色无线耳机规划 3 张电商场景图：通勤、运动、居家。保持产品外观一致，先列出构图、光线和场景方案。' },
  { scene: 'character', title: '建立一个角色设定', description: '整理外观、服饰与参考视图', prompt: '设计一位普通身材的亚洲男性角色，穿日常休闲服装。先整理人物设定，再规划正面、侧面和背面参考图。' },
] as const

export type DirectorPromptReference = { id: string; title: string }

/** Resolve visible mentions to stable owned IDs before the planner sees them. */
export function directorRequestPrompt(value: string, context: AssistantContext, scene: DirectorScene, references: readonly DirectorPromptReference[]) {
  const manifest = references.map((reference, index) => ({ label: referenceMentionLabel(references.map(() => ({ type: 'image' })), index), assetId: reference.id, title: reference.title.slice(0, 250) }))
  let text = '', end = 0
  for (const mention of promptReferenceMentions(value, references.map(() => ({ type: 'image' })))) {
    text += value.slice(end, mention.start) + `${manifest[mention.index].label}（素材 ID：${manifest[mention.index].assetId}）`
    end = mention.end
  }
  const selectedScene = directorScenes.find(item => item.id === scene) ?? directorScenes[0]
  return `${buildAssistantPrompt(text + value.slice(end), context)}${selectedScene.guidance ? `\n\n创作场景：${selectedScene.label}\n${selectedScene.guidance}` : ''}${manifest.length ? `\n\n本次选择的参考素材（名称不是视觉内容，不代表已看图）：\n${JSON.stringify(manifest)}` : ''}`
}

/** Removing/reordering attachments must never silently point a mention to another image. */
export function remapDirectorReferences(value: string, previous: readonly DirectorPromptReference[], next: readonly DirectorPromptReference[]) {
  let text = '', end = 0
  for (const mention of promptReferenceMentions(value, previous.map(() => ({ type: 'image' })))) {
    const reference = previous[mention.index]
    const index = next.findIndex(item => item.id === reference.id)
    text += value.slice(end, mention.start) + (index < 0 ? `（已移除：${reference.title}）` : referenceMentionLabel(next.map(() => ({ type: 'image' })), index))
    end = mention.end
  }
  return text + value.slice(end)
}

export function agentPlanCosts(run: { pointsCost?: number; planningPoints?: number; planApproval?: { totalPoints: number; executionEstimatedPoints?: number; approvedAt?: number; steps: Array<{ estimatedPoints?: number }> } }) {
  const plan = run.planApproval
  const stepTotal = plan?.steps.reduce((total, step) => total + Number(step.estimatedPoints || 0), 0) ?? 0
  return {
    planning: Math.max(0, run.planningPoints ?? (plan ? plan.totalPoints - stepTotal : run.pointsCost ?? 0)),
    execution: Math.max(0, plan?.executionEstimatedPoints ?? stepTotal),
  }
}
