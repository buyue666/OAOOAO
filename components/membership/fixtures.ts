import type {
  BillingOption,
  CampaignBannerConfig,
  FaqItem,
  GenerationColumn,
  GenerationRow,
  MembershipPlan,
  MembershipTier,
} from './types'

const annualTier = (
  id: string,
  credits: number,
  priceInCents?: number,
  originalPriceInCents?: number,
  generationSummary?: string,
): MembershipTier => ({
  id,
  label: `${credits.toLocaleString('zh-CN')} 积分/月`,
  credits,
  generationSummary,
  pricing: {
    annual: {
      priceInCents,
      originalPriceInCents,
      renewalText: priceInCents ? '演示价格，续费规则待配置' : undefined,
      equivalentText: priceInCents ? '连续包年折合月价' : undefined,
    },
  },
})

const sharedPromotions = [
  { title: 'Wan 3.0 Prime 限时优惠', note: '活动规则待配置' },
  { title: 'Happy Horse 1.1 限时优惠', note: '活动规则待配置' },
]

const sharedBaseBenefits = [
  '去除品牌水印，商用范围待配置',
  '会员专享加速权益',
  '登录赠送积分规则待配置',
  '训练专属权益',
]

const createPlan = (
  id: string,
  name: string,
  tone: MembershipPlan['tone'],
  tiers: MembershipTier[],
  storage: string,
  concurrency: string,
  promotionLabel?: string,
  installmentLabel?: string,
): MembershipPlan => ({
  id,
  name,
  audience: 'creator',
  tone,
  tiers,
  promotionLabel,
  installmentLabel,
  promotionBenefits: sharedPromotions,
  baseBenefits: [`${concurrency}并发任务`, `云端存储空间 ${storage}`, ...sharedBaseBenefits],
  exclusiveBenefits: ['全能视频 Agent', '3D 创作台'],
  extraBenefits: ['优先体验新模型', '专属任务队列', '更多权益规则待配置'],
})

export const campaignBanner: CampaignBannerConfig = {
  imageSrc: '/membership-speed-banner.png',
  imageAlt: '高速飞行器划过深色太空的活动视觉',
  title: '年会员 Seedance 2.5 生成限时折扣',
  subtitle: '年会员低至 4.5 折｜Seedance 2.5 低至 0.39 元/秒',
}

export const billingOptions: BillingOption[] = [
  { value: 'annual', label: '连续包年', discountLabel: '限时 4.5 折', priceSuffix: '月' },
  { value: 'quarterly', label: '连续包季', discountLabel: '7.6 折', priceSuffix: '季' },
  { value: 'monthly', label: '连续包月', discountLabel: '8.8 折', priceSuffix: '月' },
]

export const membershipProducts: MembershipPlan[] = [
  createPlan('standard', '标准版', 'standard', [annualTier('standard-1500', 1500, 5900, 6600, '图片 6,000 张｜视频 187 个')], '60GB', '8 个'),
  createPlan('advanced', '进阶版', 'advanced', [annualTier('advanced-4600', 4600, 19900, undefined, '图片 18,400 张｜视频 575 个')], '100GB', '12 个'),
  createPlan('premium', '高级版', 'premium', [
    annualTier('premium-11700', 11700, 64900, 66900, '图片 65,200 张｜视频 2,037 个'),
    annualTier('premium-16300', 16300, undefined, undefined, '图片 81,500 张｜视频 2,038 个'),
  ], '300GB', '20 个'),
  createPlan('luxury', '豪华版', 'luxury', [annualTier('luxury-32800', 32800, 119900, 129900, '图片 131,200 张｜视频 4,100 个')], '500GB', '无限', '限时 92 折'),
  createPlan('ultimate', '至尊版', 'ultimate', [
    annualTier('ultimate-50500', 50500, 229900, 259900, '图片 264,000 张｜视频 8,250 个'),
    annualTier('ultimate-66000', 66000, undefined, undefined, '图片 330,000 张｜视频 8,250 个'),
  ], '1000GB', '无限', '限时 88 折', '分期免息'),
]

export const generationColumns: GenerationColumn[] = [
  { id: 'standard-1500', label: '标准版 1.5k', planId: 'standard', tierId: 'standard-1500' },
  { id: 'advanced-4600', label: '进阶版 4.6k', planId: 'advanced', tierId: 'advanced-4600' },
  { id: 'premium-11700', label: '高级版 11.7k', planId: 'premium', tierId: 'premium-11700' },
  { id: 'premium-16300', label: '高级版 16.3k', planId: 'premium', tierId: 'premium-16300' },
  { id: 'luxury-32800', label: '豪华版 32.8k', planId: 'luxury', tierId: 'luxury-32800' },
  { id: 'ultimate-50500', label: '至尊版 50.5k', planId: 'ultimate', tierId: 'ultimate-50500' },
  { id: 'ultimate-66000', label: '至尊版 66k', planId: 'ultimate', tierId: 'ultimate-66000' },
]

export const generationRows: GenerationRow[] = [
  { group: 'video', name: 'Seedance 2.5（720P）', unit: '秒', values: { 'standard-1500': 33, 'advanced-4600': 100, 'premium-11700': 254, 'premium-16300': 354, 'luxury-32800': 713, 'ultimate-50500': 1098, 'ultimate-66000': 1435 } },
  { group: 'video', name: 'Seedance 2.0（720P）', unit: '秒', values: { 'standard-1500': 56, 'advanced-4600': 170, 'premium-11700': 433, 'premium-16300': 604, 'luxury-32800': 1215, 'ultimate-50500': 1870, 'ultimate-66000': 2444 } },
  { group: 'video', name: 'Happy Horse 1.0（720P）', unit: '秒', values: { 'standard-1500': 63, 'advanced-4600': 192, 'premium-11700': 488, 'premium-16300': 679, 'luxury-32800': 1367, 'ultimate-50500': 2104, 'ultimate-66000': 2750 } },
  { group: 'video', name: 'Kling 3.0（720P）', unit: '秒', values: { 'standard-1500': 188, 'advanced-4600': 575, 'premium-11700': 1463, 'premium-16300': 2038, 'luxury-32800': 4100, 'ultimate-50500': 6313, 'ultimate-66000': 8250 } },
  { group: 'image', name: 'Lib Image', unit: '张', values: { 'standard-1500': 750, 'advanced-4600': 2300, 'premium-11700': 5850, 'premium-16300': 8150, 'luxury-32800': 16400, 'ultimate-50500': 25250, 'ultimate-66000': 33000 } },
  { group: 'image', name: 'General Image Pro', unit: '张', values: { 'standard-1500': 107, 'advanced-4600': 329, 'premium-11700': 836, 'premium-16300': 1164, 'luxury-32800': 2343, 'ultimate-50500': 3607, 'ultimate-66000': 4714 } },
]

export const faqItems: FaqItem[] = [
  { question: '积分有效期规则' },
  { question: '会员积分退款规则' },
  { question: '积分返还规则' },
  { question: '积分消耗顺序' },
  { question: '如何获取更多积分' },
  { question: '关于分期支付' },
  { question: '发票申请与联系方式' },
  { question: '会员权益保障说明' },
  { question: '联系客服' },
]
