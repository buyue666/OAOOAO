'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight, Menu, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import styles from './landing-page.module.css'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const navigation = [
  { label: '创作', href: '#create' },
  { label: '作品', href: '#gallery' },
  { label: '模型', href: '#models' },
  { label: '关于', href: '#about' },
]
const scenes = [
  { src: '/media/generated/hero-film-v2.png', alt: '片场里的镜头与光线' },
  { src: '/media/generated/scene-storyboard-v2.png', alt: '从分镜草图展开的故事' },
  { src: '/media/generated/video-aurora-poster-v2.png', alt: '视频创作中的极光画面' },
  { src: '/media/generated/studio-still-life-v2.png', alt: '桌面上的分镜与创作素材' },
]
const sketches = [
  ['scene-storyboard-v2.png', 'large'],
  ['action-reference-v2.png', 'small'],
  ['scene-product-v2.png', 'small'],
  ['scene-character-v2.png', 'tall'],
  ['shot-forest-path-v2.png', 'small'],
  ['shot-aurora-sky-v2.png', 'wide'],
  ['studio-still-life-v2.png', 'small'],
  ['video-aurora-poster-v2.png', 'tall'],
  ['hero-film-v2.png', 'wide'],
  ['work-city-night-v2.png', 'small'],
] as const

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
      // Text must reveal while entering the viewport, not after leaving its top.
      const next = reveal
        ? clamp((height * 0.9 - rect.top) / (height * 0.6))
        : clamp(-rect.top / Math.max(1, rect.height - height))
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
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus() }
    }
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
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
  return (
    <header ref={ref} className={styles.header} data-ready={ready} data-scrolled={scrolled} data-open={open}>
      <div className={styles.headerRow}>
        <a href="#hero" className={styles.logo} aria-label="OAO 首页" onClick={() => setOpen(false)}><Image src="/media/brand/oao-logo-transparent.png" alt="OAO" width={92} height={22} className={styles.brandLogo} /></a>
        <nav className={styles.desktopNav} aria-label="首页导航">
          {navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
        <Link href="/studio" className={styles.headerCta}>进入创作</Link>
        <button ref={toggle} type="button" className={styles.menuToggle} aria-label={open ? '关闭菜单' : '打开菜单'} aria-expanded={open} aria-controls="landing-mobile-menu" onClick={() => setOpen(!open)}>
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && <nav id="landing-mobile-menu" className={styles.mobileNav} aria-label="移动端首页导航">
        {navigation.map((item) => <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}
        <Link href="/studio" onClick={() => setOpen(false)}>进入创作 <ArrowRight size={18} /></Link>
      </nav>}
    </header>
  )
}

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const progress = useProgress(ref)
  const reduced = useReducedMotion()
  const imageProgress = reduced ? 0 : clamp((progress - 0.2) / 0.8)
  const textOpacity = reduced ? 1 : clamp(1 - (progress - 0.08) / 0.24)
  return (
    <section id="hero" ref={ref} className={styles.hero} aria-label="OAO 创作平台">
      <div className={styles.heroStage}>
        <div className={styles.heroStrip} style={{ gap: imageProgress * 8 }}>
          {(['left', 'center', 'right'] as const).map((side) => side === 'center' ? (
            <div key={side} className={styles.heroCenter} style={{ width: (100 - imageProgress * 80) + '%' }}>
              <Image src="/media/generated/ai-creative-hero-background-clean-v1.png" alt="" aria-hidden="true" fill preload sizes="100vw" className={styles.heroBackground} />
              <div className={styles.wordmark} style={{ opacity: textOpacity }}>
                <Image
                  src="/media/brand/oao-logo-transparent.png"
                  alt="OAO"
                  data-hero-brandmark
                  width={1409}
                  height={335}
                  preload
                  sizes="(max-width: 767px) 86vw, min(78vw, 1120px)"
                />
              </div>
              <Image src="/media/generated/ai-creative-hero-user-v3.png" alt="旷野中进行绘画与影像记录的 OAO 创作现场" data-hero-foreground width={1536} height={1024} preload sizes="100vw" className={styles.heroForeground} />
            </div>
          ) : (
            <div key={side} className={styles.heroSides} style={{
              width: imageProgress * 40 + '%', gap: imageProgress * 8, opacity: imageProgress,
              transform: 'translate(' + (side === 'left' ? -100 + imageProgress * 100 : 100 - imageProgress * 100) + '%, ' + (-imageProgress * 15) + '%)',
            }}>
              {(side === 'left' ? [1, 2] : [3, 4]).map((number) => <div key={number} className={styles.heroPanel}>
                <Image
                  src={(side === 'left' ? ['/media/generated/hero-film-v2.png', '/media/generated/scene-character-v2.png'] : ['/media/generated/scene-product-v2.png', '/media/generated/video-aurora-poster-v2.png'])[number - (side === 'left' ? 1 : 3)]}
                  alt={['片场镜头参考', '角色设计参考', '故事道具参考', '极光影像参考'][number - 1]}
                  fill
                  sizes="20vw"
                  className={styles.cover}
                />
              </div>)}
            </div>
          ))}
        </div>
        <div className={styles.heroCaption} style={{ opacity: textOpacity }}>
          <p>灵感，自由生长。<br />从一帧画面，到完整故事。</p>
          <a href="#create" aria-label="探索创作" tabIndex={textOpacity < 0.1 ? -1 : 0}><ArrowDown size={18} /></a>
        </div>
      </div>
    </section>
  )
}

function RevealText({ text, dark = false }: { text: string; dark?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const progress = useProgress(ref, true)
  const reduced = useReducedMotion()
  const pieces = text.match(/[^，。！？]+[，。！？]?/g) || [text]
  return <p ref={ref} className={styles.revealText} data-dark={dark} aria-label={text}>
    {pieces.map((piece, index) => {
      const visible = reduced ? 1 : clamp(progress * (pieces.length + 1) - index)
      return <span key={index} aria-hidden="true" style={{ opacity: 0.12 + visible * 0.88, filter: 'blur(' + (1 - visible) * 8 + 'px)' }}>{piece}</span>
    })}
  </p>
}

function Philosophy() {
  const ref = useRef<HTMLDivElement>(null)
  const progress = useProgress(ref)
  const reduced = useReducedMotion()
  const titles = ['一个想法，无限可能。', '让灵感，成为画面。', '把故事，交给想象。']
  const active = Math.min(titles.length - 1, Math.floor(progress * titles.length))
  const phase = progress * titles.length - active
  return <section id="create" className={styles.philosophy} aria-label="创作理念">
    <div ref={ref} className={styles.philosophyScroll}>
      <div className={styles.philosophyStage}>
        <div className={styles.rotatingTitles}>
          {titles.map((title, index) => {
            const visible = reduced ? index === 0 : index === active
            const entering = index > 0 && phase < 0.25
            const exiting = index < titles.length - 1 && phase > 0.8
            const opacity = entering ? phase / 0.25 : exiting ? (1 - phase) / 0.2 : 1
            const rotation = entering ? (1 - phase / 0.25) * 75 : exiting ? -(phase - 0.8) / 0.2 * 75 : 0
            return <h2 key={title} aria-hidden={!visible} style={{ opacity: visible ? reduced ? 1 : opacity : 0, transform: 'rotateX(' + (reduced ? 0 : rotation) + 'deg)' }}>{title}</h2>
          })}
        </div>
      </div>
    </div>
    <div className={styles.philosophyDescription}>
      <RevealText text="从一张参考图出发，让角色、场景与镜头在同一片画布中生长。用图片描绘想象，用视频延续瞬间，让零散的灵感，成为完整的故事。" />
    </div>
  </section>
}

function Sketches() {
  return <section className={styles.sketches} aria-label="创意草图">
    <div className={styles.sketchGrid}>
      {sketches.map(([file, shape], index) => <div key={file} className={styles.sketch} data-shape={shape}>
        <Image src={'/media/generated/' + file} alt={'OAO 建筑创作素材 ' + (index + 1)} fill sizes="(max-width: 767px) 90vw, 45vw" className={styles.cover} />
      </div>)}
    </div>
  </section>
}

function Technology() {
  const ref = useRef<HTMLDivElement>(null)
  const progress = useProgress(ref)
  const reduced = useReducedMotion()
  const movement = reduced ? 0 : clamp((progress - 0.2) / 0.8)
  const titles = ['定格你的想象。', '让每一帧动起来。', '把镜头连成故事。']
  const cycle = Math.min(2, Math.floor(progress * 3))
  const phase = progress * 3 - cycle
  const opacity = reduced ? 1 : clamp(phase / 0.15) * (cycle === 2 ? 1 : clamp((1 - phase) / 0.15))
  const titleVisibility = progress < 0.04 ? 1 : opacity
  return <section className={styles.technology} aria-label="画面与镜头">
    <div ref={ref} className={styles.technologyScroll}>
      <div className={styles.technologyStage}>
        <div className={styles.technologyStrip} style={{ gap: movement * 16, padding: movement * 16 }}>
          <div className={styles.technologySide} style={{ width: movement * 22 + '%', opacity: movement, transform: 'translateX(' + (-100 + movement * 100) + '%)' }}>
            <Image src="/media/generated/action-reference-v2.png" alt="动作参考中的光影与姿态" fill sizes="22vw" className={styles.cover} />
          </div>
          <div className={styles.technologyCenter} style={{ width: 100 - movement * 58 + '%' }}>
            {scenes.map((scene, index) => <Image key={scene.src} src={scene.src} alt={scene.alt} fill sizes="100vw" className={styles.cover}
              style={{ opacity: index === 0 ? 1 : reduced ? 0 : clamp((progress - [0, 0.1, 0.4, 0.7][index]) / 0.2) }} />)}
            <div className={styles.sceneShade} />
            <div className={styles.sceneTitle}><h2 style={{ opacity: titleVisibility, filter: 'blur(' + (1 - titleVisibility) * 8 + 'px)' }}>{titles[reduced ? 0 : cycle]}</h2></div>
          </div>
          <div className={styles.technologySide} style={{ width: movement * 22 + '%', opacity: movement, transform: 'translateX(' + (100 - movement * 100) + '%)' }}>
            <Image src="/media/generated/shot-forest-path-v2.png" alt="影像中的森林路径与自然光" fill sizes="22vw" className={styles.cover} />
          </div>
        </div>
      </div>
    </div>
    <div className={styles.technologyDescription}><RevealText dark text="同一个世界，不同的光影。从画面的质感，到镜头的节奏，再到故事的情绪。在 OAO，让每一步创作都延续最初的灵感。" /></div>
  </section>
}

function Gallery() {
  const ref = useRef<HTMLElement>(null)
  const progress = useProgress(ref)
  const reduced = useReducedMotion()
  const fullscreen = 1 - Math.pow(1 - clamp((progress - 0.6) / 0.4), 3)
  return <section id="gallery" ref={ref} className={styles.gallery} aria-label="作品集">
    <div className={styles.galleryStage}>
      <div className={styles.galleryStack}>
        {scenes.map((scene, index) => {
          const stack = clamp(progress * scenes.length - index)
          const base = 0.8 + stack * 0.2
          const scale = index === scenes.length - 1 ? base + clamp((stack - 0.8) * 5) * (1 + fullscreen * 0.8 - base) : base
          return <div key={scene.src} className={styles.galleryFrame} style={{
            zIndex: index, opacity: reduced || index === 0 ? 1 : stack,
            transform: reduced ? 'none' : 'translateY(' + (index === 0 ? 0 : (1 - stack) * 100) + '%) scale(' + (index === 0 ? 1 : scale) + ')',
            borderRadius: index === scenes.length - 1 ? (1 - fullscreen) * 8 : 8,
          }}><Image src={scene.src} alt={scene.alt} fill sizes="(max-width: 767px) 100vw, 1200px" className={styles.cover} /></div>
        })}
      </div>
    </div>
  </section>
}

function Collection() {
  const items = [
    { name: '图片创作', description: '从灵感、材质到光线，构建心中的画面。', image: '/media/generated/studio-still-life-v2.png', href: '/image' },
    { name: '视频创作', description: '从第一帧到运镜，让静止的画面开始流动。', image: '/media/generated/video-aurora-poster-v2.png', href: '/video' },
    { name: '智能导演', description: '梳理灵感与镜头，把片段组织成完整故事。', image: '/media/generated/scene-storyboard-v2.png', href: '/agent' },
  ]
  return <section id="models" className={styles.collection}>
    <div className={styles.sectionHeading}><h2>选择你的创作方式</h2><Link href="/studio">进入工作台 <ArrowRight size={17} /></Link></div>
    <div className={styles.collectionGrid}>
      {items.map((item) => <Link href={item.href} key={item.href} className={styles.collectionItem}>
        <div className={styles.collectionImage}><Image src={item.image} alt={item.name} fill className={styles.cover} sizes="(max-width: 767px) 80vw, 33vw" /></div>
        <div className={styles.collectionText}><div><h3>{item.name}</h3><p>{item.description}</p></div><ArrowRight size={22} aria-hidden="true" /></div>
      </Link>)}
    </div>
  </section>
}

function Editorial() {
  const ref = useRef<HTMLDivElement>(null)
  const progress = useProgress(ref, true)
  return <section className={styles.editorial} aria-label="创作影像">
    <div ref={ref} className={styles.editorialMedia}>
      <Image src="/media/generated/hero-film-v2.png" alt="OAO 创作影像中的片场与镜头" fill sizes="100vw" className={styles.cover} style={{ transform: 'scale(1.08) translateY(' + (progress - 0.5) * 30 + 'px)' }} />
    </div>
    <div className={styles.specs}>
      {[['一张图片', '定格灵感'], ['一段视频', '延续瞬间'], ['一片画布', '自由构想'], ['一个故事', '完整表达']].map(([label, value]) => <div key={label}><p>{label}</p><h3>{value}</h3></div>)}
    </div>
  </section>
}

function About() {
  return <section id="about" className={styles.about}>
    <Image src="/media/generated/studio-still-life-v2.png" alt="OAO 创作桌面上的分镜与素材" fill sizes="100vw" className={styles.cover} />
    <div className={styles.aboutShade} />
    <div className={styles.aboutText}><p>让创作回到想象本身。<br />从第一张草图，到最后一个镜头。<br />在 OAO，完成属于你的作品。</p></div>
  </section>
}

function Footer() {
  const columns = [
    { title: '探索', items: [{ label: '创作理念', href: '#create' }, { label: '作品集', href: '#gallery' }, { label: '创作方式', href: '#models' }, { label: '关于 OAO', href: '#about' }] },
    { title: '开始创作', items: [{ label: '图片创作', href: '/image' }, { label: '视频创作', href: '/video' }, { label: '智能导演', href: '/agent' }, { label: '无限画布', href: '/canvas' }] },
    { title: '我的 OAO', items: [{ label: '工作台', href: '/studio' }, { label: '我的项目', href: '/projects' }, { label: '订阅套餐', href: '/plans' }, { label: '登录账户', href: '/login' }] },
  ]
  return <footer className={styles.footer}>
    <div className={styles.footerGrid}>
      <div className={styles.footerBrand}><a href="#hero" aria-label="OAO 首页"><Image src="/media/brand/oao-logo-transparent.png" alt="OAO" width={126} height={30} className={styles.footerLogo} /></a><p>把想法变成画面、镜头与故事。<br />为下一次灵感，留一片自由的空间。</p></div>
      {columns.map((column) => <div key={column.title}><h3>{column.title}</h3><ul>{column.items.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul></div>)}
    </div>
    <div className={styles.footerBottom}><p>© 2026 OAO。保留所有权利。</p><a href="#hero">返回顶部 <ArrowDown size={14} className={styles.up} /></a></div>
  </footer>
}

export function LandingPage() {
  return <main className={styles.landing} data-landing-version="oao-zh-v8-landscape-layered">
    <Header />
    <Hero />
    <Philosophy />
    <Sketches />
    <Technology />
    <Gallery />
    <Collection />
    <Editorial />
    <About />
    <Footer />
  </main>
}
