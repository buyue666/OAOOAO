/** Human-readable names for persisted API identifiers. Keep identifiers intact in requests. */
export const adminValueLabels: Record<string, string> = {
  admin: '管理员', user: '普通用户', manual: '人工收款', epay: '易支付', alipay: '支付宝', wechat: '微信支付', stripe: 'Stripe',
  text: '文本', image: '图片', video: '视频', audio: '音频', render: '成片合成',
  chat: '对话', agent: '创作助手', canvas: '自由画布', drama: '分镜项目', workbench: '创作工作台',
  registered: '已注册', qualified: '已达标', pending: '待处理', cooling: '冷静期中', cooling_off: '冷静期中',
  settled: '已结算', frozen: '已冻结', reversed: '已撤销', cancelled: '已取消', canceled: '已取消', rejected: '已驳回',
  open: '待处理', resolved: '已处理', report: '用户举报', appeal: '用户申诉', takedown: '下架复核',
  uphold: '维持原处理', dismiss: '驳回案件',
};

export function adminValueLabel(value?: string | null): string {
  return value ? adminValueLabels[value] || value : '—';
}

export const currentAuditActionLabels: Record<string, string> = {
  'auth.login': '账号登录', 'auth.register': '注册账号', 'auth.profile': '修改个人资料',
  'auth.password': '修改密码', 'auth.password.reset': '重置密码', 'administrator.bootstrap': '初始化管理员',
  'auth.wechat.bind': '绑定微信', 'auth.wechat.register': '微信注册', 'auth.wechat.login': '微信登录',
  'user.create': '新增用户', 'user.update': '修改用户', 'settings.update': '修改系统设置',
  'mail.test': '测试邮件服务', 'storage.update': '修改对象存储', 'storage.test': '测试对象存储',
  'announcement.create': '新增公告', 'announcement.update': '修改公告', 'announcement.delete': '删除公告',
  'site_popup.create': '新增推广弹窗', 'site_popup.update': '修改推广弹窗', 'site_popup.delete': '删除推广弹窗',
  'account.check_in': '每日签到', 'watermark.preference': '修改水印偏好',
  'billing.product.create': '新增商品', 'billing.product.update': '修改商品', 'billing.provider.update': '修改支付方式',
  'billing.order.closed': '关闭订单', 'billing.order.expired': '订单过期', 'billing.order.canceled': '取消订单',
  'billing.order.confirm_external_payment': '确认人工付款', 'billing.order.provider_settled': '支付平台确认到账',
  'billing.order.prepare_external_refund': '准备退款', 'billing.order.cancel_external_refund': '取消退款准备',
  'billing.order.confirm_external_refund': '确认退款', 'billing.promotion.save': '保存促销活动',
  'billing.promotion.delete': '删除促销活动', 'billing.coupon_template.save': '保存优惠券模板',
  'billing.coupon.grant': '发放优惠券', 'referrals.program.update': '修改邀请奖励',
  'work.submit': '提交作品', 'work.review': '审核作品', 'work.take_down': '下架作品',
  'work.delete': '删除作品', 'work.feature': '修改作品推荐', 'work.case.open': '创建治理案件',
  'work.case.resolve': '处理治理案件', 'generation.cancel': '取消生成任务',
  'generation.review.confirm_failed': '确认生成失败', 'generation.review.resume_upstream': '恢复上游任务',
  'generation.review.provide_result': '补录生成结果',
  'agent.cancel': '取消创作助手任务', 'agent.pause': '暂停创作助手任务', 'agent.resume': '继续创作助手任务',
  'agent.approve': '确认创作计划', 'agent.retry': '重试创作助手任务',
};
