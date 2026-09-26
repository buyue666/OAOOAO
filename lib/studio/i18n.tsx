'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type Locale = 'zh-CN' | 'en-US'

const messages = {
  'zh-CN': {
    switchToEnglish: '切换到英文',
    switchToChinese: '切换到中文',
    landingCreate: '创作',
    landingWorks: '作品',
    landingModels: '模型',
    landingAbout: '关于',
    enterCreation: '进入创作',
    startWithIdea: '从一个想法开始',
    heroCaption: '灵感，自由生长。\n从一帧画面，到完整故事。',
    exploreCreation: '探索创作',
    chooseCreation: '选择你的创作方式',
    openWorkbench: '进入工作台',
    imageCreation: '图片创作',
    videoCreation: '视频创作',
    directorCreation: '智能导演',
    homePlaceholder: '描述你想创作的画面、镜头或故事……',
  },
  'en-US': {
    switchToEnglish: 'Switch to English',
    switchToChinese: '切换到中文',
    landingCreate: 'Create',
    landingWorks: 'Works',
    landingModels: 'Models',
    landingAbout: 'About',
    enterCreation: 'Start creating',
    startWithIdea: 'Start with an idea',
    heroCaption: 'Let inspiration grow freely.\nFrom one frame to a complete story.',
    exploreCreation: 'Explore creation',
    chooseCreation: 'Choose your way to create',
    openWorkbench: 'Open workspace',
    imageCreation: 'Image creation',
    videoCreation: 'Video creation',
    directorCreation: 'Director Agent',
    homePlaceholder: 'Describe the image, shot, or story you want to create…',
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
