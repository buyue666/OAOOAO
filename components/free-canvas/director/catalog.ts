export type FigureModel = 'male' | 'female'
export type PoseId = 'stand' | 'walk' | 'run' | 'sit' | 'crouch' | 'point' | 'armsCrossed' | 'wave' | 'talk' | 'raiseHand' | 'lookBack' | 'lying'

export const FIGURE_LABELS: Record<FigureModel, string> = { male: '男性人台', female: '女性人台' }
export const POSE_LABELS: Record<PoseId, string> = {
  stand: '站立', walk: '行走', run: '奔跑', sit: '坐姿', crouch: '蹲下', point: '单手指向',
  armsCrossed: '双手抱胸', wave: '挥手', talk: '对话', raiseHand: '举手', lookBack: '回头', lying: '倒地',
}
export const isFigureModel = (value: unknown): value is FigureModel => value === 'male' || value === 'female'
export const isPoseId = (value: unknown): value is PoseId => typeof value === 'string' && Object.hasOwn(POSE_LABELS, value)
export const DIRECTOR_LIMITS = { actors: 8, cameras: 6, keys: 120 } as const
