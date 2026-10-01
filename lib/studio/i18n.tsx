'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type Locale = 'zh-CN' | 'en-US'

const messages = {
  'zh-CN': {
    switchToEnglish: '切换到英文',
    switchToChinese: '切换到中文',
    authLoginDescription: '登录 OAO，继续你的创作。',
    authRegisterDescription: '验证邮箱，创建你的 OAO 账户。',
    authResetDescription: '验证邮箱后，设置新密码。',
    authEmailCodeRequested: '验证码请求已提交，请查看邮箱。',
    authReferralPlaceholder: '请输入邀请码',
    authWechatUnlinked: '该微信尚未关联账户，请使用账号密码登录。',
    authMfaHelp: '请输入验证器应用中的 6 位动态验证码。',
    landingCreate: '创作',
    landingWorks: '作品',
    landingModels: '能力',
    landingAbout: '关于',
    enterCreation: '进入创作',
    startWithIdea: '从一个想法开始',
    heroCaption: '把一个想法，变成完整作品。\n从一帧画面，到一段故事。',
    heroEyebrow: 'OAO AI 创作平台',
    heroDescription: '图片、视频、文本、Agent 与自由画布，在一个工作台里完成从灵感到交付。',
    heroPrimary: '开始创作',
    heroSecondary: '看看 OAO 能做什么',
    exploreCreation: '探索创作',
    chooseCreation: '为每一种灵感，准备一种入口',
    openWorkbench: '进入工作台',
    imageCreation: '图片创作',
    videoCreation: '视频创作',
    directorCreation: '智能导演',
    canvasCreation: '自由画布',
    dramaCreation: '短剧制作',
    homePlaceholder: '描述你想创作的画面、镜头或故事……',
    platformTitle: '从一个念头开始，\n把创作往前推进。',
    platformDescription: 'OAO 把模型、素材、镜头和故事放到同一个创作语境里。你可以从一句话开始，也可以从一张参考图开始，随时切换方式，不必反复搬运灵感。',
    platformLabel: '一个创作平台',
    platformImage: '图片与视觉',
    platformVideo: '视频与镜头',
    platformStory: '文本与故事',
    platformAgent: 'Agent 协作',
    capabilityTitle: '你想做什么，就从这里开始',
    capabilityDescription: '清晰的入口，连接到真正的创作能力。',
    viewAllCreation: '查看全部创作方式',
    workflowTitle: '让灵感自然流动',
    workflowDescription: '不需要先想清楚全部答案。先留下一个方向，OAO 会陪你把它变成可继续的画面、镜头和作品。',
    workflowIdea: '留下想法',
    workflowIdeaDescription: '一句描述、一张参考图，或一个还没完成的故事。',
    workflowShape: '塑造画面',
    workflowShapeDescription: '选择模型、比例、素材与风格，让方向逐渐清晰。',
    workflowFinish: '完成作品',
    workflowFinishDescription: '在工作台继续整理、生成、协作，并留下下一次创作的入口。',
    worksTitle: '正在发生的创作',
    worksDescription: '图片可以成为视频的第一帧，文字可以长成一个世界。',
    ecosystemTitle: '一套工具，覆盖完整表达',
    ecosystemDescription: '从单张图片到连续镜头，从灵感草稿到完整短剧，选择适合当下的创作方式。',
    enterStudio: '进入 OAO 工作台',
    footerDescription: '把想法变成画面、镜头与故事。为下一次灵感，留一片自由的空间。',
  },
  'en-US': {
    switchToEnglish: 'Switch to English',
    switchToChinese: '切换到中文',
    authLoginDescription: 'Sign in to OAO to continue creating.',
    authRegisterDescription: 'Verify your email to create your OAO account.',
    authResetDescription: 'Verify your email, then set a new password.',
    authEmailCodeRequested: 'Verification code requested. Please check your inbox.',
    authReferralPlaceholder: 'Enter an invitation code',
    authWechatUnlinked: 'This WeChat account is not linked. Please sign in with your username and password.',
    authMfaHelp: 'Enter the 6-digit code from your authenticator app.',
    landingCreate: 'Create',
    landingWorks: 'Works',
    landingModels: 'Capabilities',
    landingAbout: 'About',
    enterCreation: 'Start creating',
    startWithIdea: 'Start with an idea',
    heroCaption: 'Turn one idea into a complete work.\nFrom one frame to a moving story.',
    heroEyebrow: 'OAO AI CREATIVE PLATFORM',
    heroDescription: 'Images, video, text, Agent collaboration and an open canvas, brought together in one workspace.',
    heroPrimary: 'Start creating',
    heroSecondary: 'Explore OAO',
    exploreCreation: 'Explore creation',
    chooseCreation: 'One entrance for every kind of idea',
    openWorkbench: 'Open workspace',
    imageCreation: 'Image creation',
    videoCreation: 'Video creation',
    directorCreation: 'Director Agent',
    canvasCreation: 'Open canvas',
    dramaCreation: 'Short drama',
    homePlaceholder: 'Describe the image, shot, or story you want to create…',
    platformTitle: 'Start with a thought.\nMove the work forward.',
    platformDescription: 'OAO brings models, references, shots and stories into one creative context. Start with a sentence or an image, switch modes whenever the idea changes, and keep the work together.',
    platformLabel: 'One creative platform',
    platformImage: 'Images & visuals',
    platformVideo: 'Video & shots',
    platformStory: 'Text & stories',
    platformAgent: 'Agent collaboration',
    capabilityTitle: 'Start with what you want to make',
    capabilityDescription: 'Clear entrances to real creative capability.',
    viewAllCreation: 'See all creative modes',
    workflowTitle: 'Let the idea keep moving',
    workflowDescription: 'You do not need every answer before you begin. Leave a direction, and OAO helps turn it into images, shots and work you can keep shaping.',
    workflowIdea: 'Leave a direction',
    workflowIdeaDescription: 'A sentence, a reference image, or a story that is still taking shape.',
    workflowShape: 'Shape the frame',
    workflowShapeDescription: 'Choose models, ratios, references and style as the direction becomes clear.',
    workflowFinish: 'Finish the work',
    workflowFinishDescription: 'Organize, generate and collaborate in the workspace, with a clear next step.',
    worksTitle: 'Work in motion',
    worksDescription: 'An image can become the first frame of a video. A line of text can become a world.',
    ecosystemTitle: 'One toolkit for complete expression',
    ecosystemDescription: 'Move from a single image to connected shots, from a rough idea to a finished short drama.',
    enterStudio: 'Open the OAO workspace',
    footerDescription: 'Turn ideas into images, shots and stories. Leave room for the next spark.',
  },
} as const

type TranslationKey = keyof typeof messages['zh-CN']
type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; toggleLocale: () => void; t: (key: TranslationKey) => string }
const LocaleContext = createContext<LocaleContextValue | null>(null)
const storageKey = 'oaooao-locale'

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh-CN')

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved === 'en-US' || saved === 'zh-CN') setLocaleState(saved)
    } catch { /* 不能使用本地存储时使用中文默认值 */ }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try { window.localStorage.setItem(storageKey, next) } catch { /* 忽略存储失败，当前页面仍可切换 */ }
  }, [])
  const toggleLocale = useCallback(() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN'), [locale, setLocale])
  const value = useMemo(() => ({ locale, setLocale, toggleLocale, t: (key: TranslationKey) => messages[locale][key] }), [locale, setLocale, toggleLocale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useLocale 必须在 LocaleProvider 内使用')
  return value
}
