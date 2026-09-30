'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight, Bot, Clapperboard, FileText, ImageIcon, Languages, LayoutPanelTop, Menu, Sparkles, Video, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import styles from './landing-page.module.css'
import { SiteAnnouncementBar } from './site-announcement-bar'
import { useStudio } from '@/lib/studio/store'
import { useLocale } from '@/lib/studio/i18n'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const navigation = [
  { key: 'landingCreate', href: '#create' },
  { key: 'landingWorks', href: '#gallery' },
  { key: 'landingModels', href: '#models' },
  { key: 'landingAbout', href: '#about' },
] as const
const scenes = [
  { src: '/media/generated/hero-film-v2.png', alt: '片场里的镜头与光线', title: '镜头先于答案' },
  { src: '/media/generated/scene-storyboard-v2.png', alt: '从分镜草图展开的故事', title: '把故事拆成画面' },
  { src: '/media/generated/video-aurora-poster-v2.png', alt: '视频创作中的极光画面', title: '让静止的画面流动' },
  { src: '/media/generated/studio-still-life-v2.png', alt: '桌面上的分镜与创作素材', title: '把素材留在同一处' },
]

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function useProgress(ref: RefObject<HTMLElement | null>, reveal = false) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const element = ref.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const height = window.innerHeight
      const next = reveal ? clamp((height * 0.9 - rect.top) / (height * 0.6)) : clamp(-rect.top / Math.max(1, rect.height - height))
      setProgress((previous) => Math.abs(previous - next) < 0.0001 ? previous : next)
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    if (ref.current) observer.observe(ref.current)
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [ref, reveal])
  return progress
}

function Header() {
  const { locale, t, toggleLocale } = useLocale()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 50)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 260)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); toggle.current?.focus() } }
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false) }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', outside)
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', outside)
      desktop.removeEventListener('change', closeOnDesktop)
    }
  }, [open])
  return <header ref={ref} className={styles.header} data-ready={ready} data-scrolled={scrolled} data-open={open}>
    <div className={styles.headerRow}>
      <a href="#hero" className={styles.logo} aria-label="OAO 首页" onClick={() => setOpen(false)}><Image src="/media/brand/oao-logo-transparent.png" alt="OAO" width={92} height={22} className={styles.brandLogo} /></a>
      <nav className={styles.desktopNav} aria-label="首页导航">{navigation.map((item) => <a key={item.href} href={item.href}>{t(item.key)}</a>)}</nav>
      <div className={styles.headerActions}><button type="button" className={styles.localeToggle} onClick={toggleLocale} aria-label={locale === 'zh-CN' ? t('switchToEnglish') : t('switchToChinese')} title={locale === 'zh-CN' ? t('switchToEnglish') : t('switchToChinese')}><Languages size={15} /></button><Link href="/studio" className={styles.headerCta}>{t('enterCreation')}</Link></div>
      <button ref={toggle} type="button" className={styles.menuToggle} aria-label={open ? '关闭菜单' : '打开菜单'} aria-expanded={open} aria-controls="landing-mobile-menu" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
    {open && <nav id="landing-mobile-menu" className={styles.mobileNav} aria-label="移动端首页导航">{navigation.map((item) => <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{t(item.key)}</a>)}<Link href="/studio" onClick={() => setOpen(false)}>{t('enterCreation')} <ArrowRight size={18} /></Link></nav>}
  </header>
}

function Hero() {
  const { t } = useLocale()
  const ref = useRef<HTMLElement>(null)
  const progress = useProgress(ref)
  const reduced = useReducedMotion()
  const imageProgress = reduced ? 0 : clamp((progress - 0.2) / 0.8)
  const parallaxProgress = reduced ? 0 : clamp(progress / 0.8)
  const textOpacity = reduced ? 1 : clamp(1 - (progress - 0.08) / 0.24)
  const backgroundShift = parallaxProgress * -1.5
  const brandmarkShift = parallaxProgress * -7
  const foregroundShift = parallaxProgress * -12
  return <section id="hero" ref={ref} className={styles.hero} aria-label="OAO AI 创作平台"><div className={styles.heroStage}><div className={styles.heroStrip} style={{ gap: imageProgress * 8 }}>
    {(['left', 'center', 'right'] as const).map((side) => side === 'center' ? <div key={side} className={styles.heroCenter} style={{ width: (100 - imageProgress * 80) + '%' }}>
      <Image src="/media/generated/ai-creative-hero-background-platform-v1.png" alt="" aria-hidden="true" fill preload sizes="100vw" className={styles.heroBackground} style={{ transform: `scale(1.06) translateY(${backgroundShift}%)` }} />
      <Image src="/media/brand/oao-logo-transparent.png" alt="" aria-hidden="true" data-hero-brandmark width={1221} height={292} preload sizes="min(82vw, 1120px)" className={styles.brandmark} style={{ opacity: textOpacity * 0.18, transform: `translate(-50%, ${brandmarkShift}%)` }} />
      <Image src="/media/generated/ai-creative-hero-user-v3.png" alt="旷野中进行绘画与影像记录的 OAO 创作现场" data-hero-foreground width={1536} height={1024} preload sizes="100vw" className={styles.heroForeground} style={{ transform: `translate(-50%, ${foregroundShift}%)` }} />
      <div className={styles.heroMessage} style={{ opacity: textOpacity }}><span className={styles.heroEyebrow}>{t('heroEyebrow')}</span><h1>{t('heroCaption').split('\n').map((line) => <span key={line}>{line}<br /></span>)}</h1><p>{t('heroDescription')}</p><div className={styles.heroActions}><Link href="/studio" className={styles.heroPrimary}>{t('heroPrimary')} <ArrowRight size={17} /></Link><a href="#create" className={styles.heroSecondary}>{t('heroSecondary')}</a></div></div>
    </div> : <div key={side} className={styles.heroSides} style={{ width: imageProgress * 40 + '%', gap: imageProgress * 8, opacity: imageProgress, transform: 'translate(' + (side === 'left' ? -100 + imageProgress * 100 : 100 - imageProgress * 100) + '%, ' + (-imageProgress * 15) + '%)' }}>
      {(side === 'left' ? [1, 2] : [3, 4]).map((number) => <div key={number} className={styles.heroPanel}><Image src={(side === 'left' ? ['/media/generated/hero-film-v2.png', '/media/generated/scene-character-v2.png'] : ['/media/generated/scene-product-v2.png', '/media/generated/video-aurora-poster-v2.png'])[number - (side === 'left' ? 1 : 3)]} alt={['片场镜头参考', '角色设计参考', '故事道具参考', '极光影像参考'][number - 1]} fill sizes="20vw" className={styles.cover} /></div>)}
    </div>)}
  </div><div className={styles.heroScrollHint} style={{ opacity: textOpacity }}><span>{t('exploreCreation')}</span><ArrowDown size={17} /></div></div></section>
}

function PlatformIntro() {
  const { t } = useLocale()
  const capabilities = [{ number: '01', icon: ImageIcon, title: t('platformImage') }, { number: '02', icon: Video, title: t('platformVideo') }, { number: '03', icon: FileText, title: t('platformStory') }, { number: '04', icon: Bot, title: t('platformAgent') }]
  return <section id="create" className={styles.platformIntro} aria-label="OAO 平台能力"><div className={styles.introCopy}><span className={styles.sectionEyebrow}>{t('platformLabel')}</span><h2>{t('platformTitle').split('\n').map((line) => <span key={line}>{line}<br /></span>)}</h2><p>{t('platformDescription')}</p><Link href="/studio" className={styles.textLink}>{t('openWorkbench')} <ArrowRight size={17} /></Link></div><div className={styles.capabilityList}>{capabilities.map(({ number, icon: Icon, title }) => <div className={styles.capabilityRow} key={number}><span>{number}</span><Icon size={20} strokeWidth={1.7} /><strong>{title}</strong><ArrowRight size={17} /></div>)}</div></section>
}

function Capabilities() {
  const { locale, t } = useLocale()
  const isChinese = locale === 'zh-CN'
  const items = [
    { name: t('imageCreation'), description: isChinese ? '从一句提示词到一组可用画面。' : 'Turn one prompt into a set of usable frames.', image: '/media/generated/studio-still-life-v2.png', href: '/image', Icon: ImageIcon, accent: 'image' },
    { name: t('videoCreation'), description: isChinese ? '让画面拥有节奏、镜头与时间。' : 'Give an image rhythm, shots and time.', image: '/media/generated/video-aurora-poster-v2.png', href: '/video', Icon: Video, accent: 'video' },
    { name: t('directorCreation'), description: isChinese ? '让 Agent 帮你梳理创意与下一步。' : 'Let Agent help shape the idea and next step.', image: '/media/generated/scene-storyboard-v2.png', href: '/agent', Icon: Bot, accent: 'agent' },
    { name: t('canvasCreation'), description: isChinese ? '把素材、节点与想法放在一张画布上。' : 'Keep references, nodes and ideas on one canvas.', image: '/media/generated/action-reference-v2.png', href: '/canvas', Icon: LayoutPanelTop, accent: 'canvas' },
    { name: t('dramaCreation'), description: isChinese ? '从人物、场景到镜头，组织完整短剧。' : 'Shape characters, scenes and shots into a short drama.', image: '/media/generated/scene-character-v2.png', href: '/drama', Icon: Clapperboard, accent: 'drama' },
  ]
  return <section id="models" className={styles.capabilities} aria-label="创作能力"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>{t('landingModels')}</span><h2>{t('capabilityTitle')}</h2><p>{t('capabilityDescription')}</p></div><Link href="/studio" className={styles.outlineLink}>{t('viewAllCreation')} <ArrowRight size={17} /></Link></div><div className={styles.capabilityGrid}>{items.map(({ name, description, image, href, Icon, accent }) => <Link href={href} key={href} className={styles.capabilityCard} data-accent={accent}><div className={styles.capabilityImage}><Image src={image} alt={name} fill sizes="(max-width: 767px) 84vw, 30vw" className={styles.cover} /></div><div className={styles.capabilityMeta}><div className={styles.capabilityTitle}><Icon size={18} /><h3>{name}</h3></div><p>{description}</p><ArrowRight size={18} aria-hidden="true" /></div></Link>)}</div></section>
}

function Workflow() {
  const { t } = useLocale()
  const steps = [{ number: '01', title: t('workflowIdea'), description: t('workflowIdeaDescription'), Icon: Sparkles }, { number: '02', title: t('workflowShape'), description: t('workflowShapeDescription'), Icon: LayoutPanelTop }, { number: '03', title: t('workflowFinish'), description: t('workflowFinishDescription'), Icon: ArrowRight }]
  return <section className={styles.workflow} aria-label="创作流程"><div className={styles.workflowIntro}><span className={styles.sectionEyebrow}>{t('startWithIdea')}</span><h2>{t('workflowTitle')}</h2><p>{t('workflowDescription')}</p></div><div className={styles.workflowSteps}>{steps.map(({ number, title, description, Icon }) => <div className={styles.workflowStep} key={number}><div className={styles.stepTop}><span>{number}</span><Icon size={20} /></div><h3>{title}</h3><p>{description}</p></div>)}</div></section>
}

function Gallery() {
  const { t } = useLocale()
  const ref = useRef<HTMLElement>(null)
  const progress = useProgress(ref)
  const reduced = useReducedMotion()
  const stack = reduced ? 1 : clamp(progress * scenes.length)
  return <section id="gallery" ref={ref} className={styles.gallery} aria-label="OAO 作品展示"><div className={styles.galleryIntro}><span className={styles.sectionEyebrow}>{t('landingWorks')}</span><h2>{t('worksTitle')}</h2><p>{t('worksDescription')}</p></div><div className={styles.galleryStage}><div className={styles.galleryStack}>{scenes.map((scene, index) => { const visible = clamp(stack - index); return <figure key={scene.src} className={styles.galleryFrame} style={{ zIndex: scenes.length - index, opacity: reduced || index === 0 ? 1 : visible, transform: reduced ? `rotate(${(index - 1.5) * 2}deg)` : `translateY(${(1 - visible) * 80}%) rotate(${(index - 1.5) * 2}deg)` }}><Image src={scene.src} alt={scene.alt} fill sizes="(max-width: 767px) 92vw, 48vw" className={styles.cover} /><figcaption><span>0{index + 1}</span>{scene.title}</figcaption></figure> })}</div></div></section>
}

function CreationRoutes() {
  const { t } = useLocale()
  const items = [[t('imageCreation'), '01', '/image'], [t('videoCreation'), '02', '/video'], [t('canvasCreation'), '03', '/canvas'], [t('dramaCreation'), '04', '/drama']]
  return <section className={styles.routes} aria-label="创作入口"><div className={styles.routesHeader}><span className={styles.sectionEyebrow}>{t('ecosystemTitle')}</span><p>{t('ecosystemDescription')}</p></div><div className={styles.routeList}>{items.map(([title, number, href]) => <Link href={href} key={href} className={styles.routeRow}><span>{number}</span><h3>{title}</h3><ArrowRight size={22} /></Link>)}</div></section>
}

function Editorial() {
  const { locale, t } = useLocale()
  const specs = locale === 'zh-CN'
    ? [[t('platformImage'), '一张图片'], [t('platformVideo'), '一段视频'], [t('canvasCreation'), '一片画布'], [t('dramaCreation'), '一个故事']]
    : [[t('platformImage'), 'One image'], [t('platformVideo'), 'One video'], [t('canvasCreation'), 'One canvas'], [t('dramaCreation'), 'One story']]
  return <section className={styles.editorial} aria-label="OAO 创作方式"><div className={styles.editorialMedia}><Image src="/media/generated/hero-film-v2.png" alt="OAO 创作影像中的片场与镜头" fill sizes="100vw" className={styles.cover} /></div><div className={styles.specs}>{specs.map(([label, value]) => <div key={label}><p>{label}</p><h3>{value}</h3></div>)}</div></section>
}

function About() {
  const { t } = useLocale()
  return <section id="about" className={styles.about}><Image src="/media/generated/studio-still-life-v2.png" alt="OAO 创作桌面上的分镜与素材" fill sizes="100vw" className={styles.cover} /><div className={styles.aboutShade} /><div className={styles.aboutText}><span className={styles.sectionEyebrow}>{t('enterStudio')}</span><h2>{t('platformTitle').split('\n')[0]}</h2><Link href="/studio" className={styles.aboutCta}>{t('enterStudio')} <ArrowRight size={18} /></Link></div></section>
}

function Footer() {
  const { locale, t } = useLocale()
  const columns = locale === 'zh-CN'
    ? [{ title: '探索', items: [{ label: '创作能力', href: '#models' }, { label: '作品展示', href: '#gallery' }, { label: '关于 OAO', href: '#about' }] }, { title: '开始创作', items: [{ label: t('imageCreation'), href: '/image' }, { label: t('videoCreation'), href: '/video' }, { label: t('canvasCreation'), href: '/canvas' }, { label: t('dramaCreation'), href: '/drama' }] }, { title: '我的 OAO', items: [{ label: '工作台', href: '/studio' }, { label: '我的作品', href: '/works' }, { label: '订阅套餐', href: '/plans' }, { label: '登录账户', href: '/login' }] }]
    : [{ title: 'Explore', items: [{ label: 'Capabilities', href: '#models' }, { label: 'Works', href: '#gallery' }, { label: 'About OAO', href: '#about' }] }, { title: 'Create', items: [{ label: t('imageCreation'), href: '/image' }, { label: t('videoCreation'), href: '/video' }, { label: t('canvasCreation'), href: '/canvas' }, { label: t('dramaCreation'), href: '/drama' }] }, { title: 'My OAO', items: [{ label: 'Workspace', href: '/studio' }, { label: 'My works', href: '/works' }, { label: 'Plans', href: '/plans' }, { label: 'Sign in', href: '/login' }] }]
  return <footer className={styles.footer}><div className={styles.footerGrid}><div className={styles.footerBrand}><a href="#hero" aria-label="OAO 首页"><Image src="/media/brand/oao-logo-transparent.png" alt="OAO" width={126} height={30} className={styles.footerLogo} /></a><p>{t('footerDescription')}</p></div>{columns.map((column) => <div key={column.title}><h3>{column.title}</h3><ul>{column.items.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul></div>)}</div><div className={styles.footerBottom}><p>{locale === 'zh-CN' ? '© 2026 OAO。保留所有权利。' : '© 2026 OAO. All rights reserved.'}</p><a href="#hero">{locale === 'zh-CN' ? '返回顶部' : 'Back to top'} <ArrowDown size={14} className={styles.up} /></a></div></footer>
}

export function LandingPage() {
  const { state } = useStudio()
  const announcement = state.sessionSettings?.site?.announcementBar
  const hasAnnouncement = announcement?.enabled === true && Boolean(announcement.text?.trim())
  return <main className={styles.landing} data-landing-version="oao-zh-v9-ai-platform" data-announcement={hasAnnouncement ? 'true' : 'false'}><SiteAnnouncementBar announcement={announcement} placement="landing" /><Header /><Hero /><PlatformIntro /><Capabilities /><Workflow /><Gallery /><CreationRoutes /><Editorial /><About /><Footer /></main>
}
