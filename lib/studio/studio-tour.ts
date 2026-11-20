export type TourRect = { top: number; left: number; width: number; height: number }
export const STUDIO_TOUR_EVENT = 'oao:show-studio-tour'
export const studioTourKey = (account: string, kind: 'studio' | 'tryon') => `oao:tour:v1:${encodeURIComponent(account)}:${kind}`

export function studioTourSteps(kind: 'studio' | 'tryon', english = false) {
  const definitions = [
    ['[data-tour="tools"], [data-tour="mobile-menu"]', '创作工具', '图片、视频和项目从左侧进入；其他工具可以在功能中心直接选择使用。手机端先点左上角打开导航。', 'Creative tools', 'Use the navigation for images, videos and projects. Choose more tools directly in the Feature Center. On mobile, open the top-left navigation first.'],
    ['[data-tour="creator"]', '从这里开始创作', '选择图片或视频，输入描述或添加参考即可开始。有完整想法时，也可以先与创作助手讨论方向，再确认生成计划。', 'Start creating here', 'Choose images or videos, add a description or reference, and start creating. The assistant can help develop an idea before you approve its generation plan.'],
    ['[data-tour="assets"], [data-tour="mobile-menu"]', '素材与生成记录', '创作资产保存可重复引用的素材，生成记录可以查看任务和结果。个人与团队空间分别管理素材、容量和积分。', 'Assets and generation history', 'Keep reusable references in Creative Assets and find tasks and results in Generation History. Personal and team spaces manage their own assets, capacity and credits.'],
    ['[data-tour="account"]', '我的账户', '点击头像可查看签到、账户与套餐、主题设置，并切换个人或团队空间。选择“新手引导”可再次查看操作说明。', 'Your account', 'Open the avatar menu for check-in, your account, plans, theme and personal or team spaces. Choose Getting started to replay the tour.'],
  ]
  return definitions.map(([selector, title, description, enTitle, enDescription]) => ({ selector, title: english ? enTitle : title, description: english ? enDescription : description }))
}

/** Clamp the guide to the current viewport, including narrow and short windows. */
export function studioTourPlacement(target: TourRect | null, viewport: { width: number; height: number }, card: { width: number; height: number }) {
  const gap = 16, gutter = 12
  const width = Math.min(card.width, Math.max(0, viewport.width - gutter * 2))
  const height = Math.min(card.height, Math.max(0, viewport.height - gutter * 2))
  const clampX = (value: number) => Math.max(gutter, Math.min(value, viewport.width - width - gutter))
  const clampY = (value: number) => Math.max(gutter, Math.min(value, viewport.height - height - gutter))
  if (!target) return { left: clampX((viewport.width - width) / 2), top: clampY((viewport.height - height) / 2), width }
  if (viewport.width < 640) return { left: gutter, top: clampY(viewport.height - height - gutter), width }
  if (target.left + target.width + gap + width <= viewport.width - gutter) return { left: target.left + target.width + gap, top: clampY(target.top), width }
  if (target.top + target.height + gap + height <= viewport.height - gutter) return { left: clampX(target.left), top: target.top + target.height + gap, width }
  if (target.left - gap - width >= gutter) return { left: target.left - gap - width, top: clampY(target.top), width }
  return { left: clampX(target.left + target.width - width), top: clampY(target.top - gap - height), width }
}
