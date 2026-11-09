'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinnedModel } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { Camera, Check, Clapperboard, Crosshair, Grid3X3, Maximize2, Move3d, Plus, Rotate3d, ScanLine, Search, SlidersHorizontal, Trash2, UserRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStudio } from '@/lib/studio/store'
import { CanvasThemeButton } from './canvas-controls'
import { directorObjectIdentity, isDirectorPick, type DirectorSelection } from './director-selection'
import { useCanvasStore } from './canvas-store'
import { flushCanvasSave } from './canvas-persistence'
import { DIRECTOR_LIMITS, FIGURE_LABELS, POSE_LABELS, type FigureModel } from './director/catalog'
import { DirectorTimeline } from './director/timeline-panel'
import { ACTOR_KEY_FIELDS, CAMERA_KEY_FIELDS, applyCameraMotion, directorDuration, recordActorKey, recordCameraKey, resizeDirectorDuration, sampleDirectorScene } from './director/timeline'
import { DirectorFigureLibrary, DirectorPoseLibrary } from './director/figure-library'
import { loadFigureModel } from './director/figure'
import { actorPoseId, createActorFigure, updateActorFigure } from './director/figure-adapter'
import { DEFAULT_DIRECTOR_SCENE } from './node-factory'
import { DEFAULT_DIRECTOR_POSE_CONTROLS, type DirectorActor, type DirectorCamera, type DirectorPoseControls, type DirectorSceneData } from './types'

type Props = { nodeId: string; onClose: () => void }

const ASPECT_LABEL: Record<DirectorSceneData['aspect'], string> = { '16:9': '横屏 16:9', '9:16': '竖屏 9:16', '1:1': '方形 1:1' }
const DEFAULT_MODEL_URL = '/assets/director/quaternius-superhero.glb'

const POSE_PRESETS: Array<{ id: string; label: string; pose: DirectorActor['pose']; controls: Partial<DirectorPoseControls> }> = [
  { id: 'stand', label: '站立', pose: 'idle', controls: {} },
  { id: 't-pose', label: 'T 型', pose: 'hero', controls: { leftShoulderRoll: -230, rightShoulderRoll: 230 } },
  { id: 'walk', label: '行走', pose: 'walk', controls: { torsoPitch: -6, headPitch: -2, leftShoulderPitch: -35, rightShoulderPitch: 35, leftShoulderYaw: 55, rightShoulderYaw: 55, leftElbow: -34, rightElbow: -34, leftHip: -30, rightHip: 30, leftKnee: 20, rightKnee: -12, leftAnkle: 5, rightAnkle: -5 } },
  { id: 'run', label: '跑步', pose: 'walk', controls: { torsoPitch: -18, headPitch: -5, leftShoulderPitch: 0, rightShoulderPitch: 0, leftShoulderYaw: 70, rightShoulderYaw: 70, leftElbow: -58, rightElbow: -58, leftHip: 22, rightHip: -24, leftKnee: 58, rightKnee: -18, leftAnkle: -8, rightAnkle: 6 } },
  { id: 'sit', label: '坐姿', pose: 'idle', controls: { torsoPitch: -12, leftHip: -58, rightHip: -58, leftKnee: 96, rightKnee: 96, leftAnkle: -20, rightAnkle: -20 } },
  { id: 'squat', label: '蹲下', pose: 'idle', controls: { torsoPitch: -20, leftHip: -22, rightHip: -22, leftKnee: 84, rightKnee: 84, leftAnkle: -18, rightAnkle: -18 } },
  { id: 'single-jump', label: '单腿跳', pose: 'walk', controls: { torsoPitch: -8, leftShoulderPitch: 28, rightShoulderPitch: 28, leftElbow: -28, rightElbow: -28, leftHip: -24, rightHip: 28, leftKnee: 58, rightKnee: 78, leftAnkle: -12, rightAnkle: 18 } },
  { id: 'double-jump', label: '双腿跳', pose: 'walk', controls: { torsoPitch: -10, leftShoulderPitch: 34, rightShoulderPitch: 34, leftElbow: -32, rightElbow: -32, leftHip: 0, rightHip: 0, leftKnee: 66, rightKnee: 66, leftAnkle: -18, rightAnkle: -18 } },
  { id: 'akimbo', label: '叉腰', pose: 'hero', controls: { torsoPitch: -4, leftShoulderPitch: 58, rightShoulderPitch: 58, leftShoulderRoll: -20, rightShoulderRoll: 20, leftElbow: -98, rightElbow: -98, leftWrist: 18, rightWrist: -18 } },
  { id: 'lean', label: '俯靠', pose: 'idle', controls: { torsoPitch: -34, torsoRoll: -18, headPitch: -16, leftShoulderPitch: 28, rightShoulderPitch: 28, leftElbow: -28, rightElbow: -28 } },
  { id: 'turn', label: '翻身', pose: 'idle', controls: { torsoYaw: 88, headYaw: 55, leftShoulderYaw: -52, rightShoulderYaw: 52, leftHip: -18, rightHip: 18 } },
  { id: 'think', label: '思考', pose: 'idle', controls: { torsoYaw: -24, torsoPitch: -12, headPitch: -34, headYaw: 32, headRoll: -12, leftShoulderPitch: 52, leftShoulderRoll: -28, leftElbow: -118, leftWrist: 44 } },
  { id: 'fight', label: '格斗', pose: 'hero', controls: { torsoPitch: -10, torsoYaw: -18, torsoRoll: -6, leftShoulderPitch: 34, rightShoulderPitch: 34, leftShoulderRoll: -24, rightShoulderRoll: 24, leftElbow: -82, rightElbow: -82, leftHip: -22, rightHip: 22, leftKnee: 22, rightKnee: 12 } },
  { id: 'dodge', label: '躲球', pose: 'idle', controls: { torsoPitch: -16, torsoRoll: -34, headRoll: -18, leftShoulderPitch: -42, rightShoulderPitch: -42, leftHip: -35, rightHip: 24, leftKnee: 24, rightKnee: 24 } },
  { id: 'throw', label: '投球', pose: 'hero', controls: { torsoYaw: -34, torsoPitch: -8, rightShoulderPitch: -88, rightShoulderRoll: 58, rightElbow: -28, leftShoulderPitch: 30, leftShoulderRoll: -22, leftElbow: -52 } },
  { id: 'push', label: '推进', pose: 'hero', controls: { torsoPitch: 18, leftShoulderPitch: -58, rightShoulderPitch: -58, leftShoulderRoll: -22, rightShoulderRoll: 22, leftElbow: -18, rightElbow: -18, leftHip: -22, rightHip: -22 } },
  { id: 'wave', label: '招手', pose: 'hero', controls: { rightShoulderPitch: 80, rightShoulderRoll: 160, rightElbow: -50, rightWrist: 20, leftShoulderRoll: -18 } },
  { id: 'reach', label: '伸手', pose: 'hero', controls: { torsoPitch: -8, rightShoulderPitch: -52, rightShoulderRoll: 24, rightElbow: -8, rightWrist: 0, leftShoulderRoll: -20 } },
  { id: 'raise', label: '抬臂', pose: 'hero', controls: { leftShoulderRoll: -110, rightShoulderRoll: 180, leftShoulderPitch: 0, rightShoulderPitch: 0, leftElbow: -18, rightElbow: -18 } },
  { id: 'phone', label: '看手机', pose: 'idle', controls: { headPitch: -28, torsoPitch: -14, torsoYaw: 12, rightShoulderPitch: 150, rightShoulderRoll: 0, rightElbow: -100, rightWrist: -12, leftShoulderPitch: 18, leftElbow: -54 } },
]

const POSE_CONTROL_SECTIONS: Array<{ title: string; items: Array<{ key: keyof DirectorPoseControls; label: string }> }> = [
  { title: '躯干与头部', items: [
    { key: 'torsoPitch', label: '身体 · 前倾' }, { key: 'torsoRoll', label: '身体 · 侧倾' }, { key: 'torsoYaw', label: '躯干 · 扭转' },
    { key: 'headPitch', label: '头部 · 前倾' }, { key: 'headYaw', label: '头部 · 左右' }, { key: 'headRoll', label: '头部 · 侧倾' },
  ] },
  { title: '左臂', items: [
    { key: 'leftShoulderPitch', label: '肩部 · 前抬' }, { key: 'leftShoulderRoll', label: '肩部 · 外展' }, { key: 'leftShoulderYaw', label: '肩部 · 扭转' },
    { key: 'leftElbow', label: '手臂 · 弯曲' }, { key: 'leftWrist', label: '手腕 · 扭转' },
  ] },
  { title: '右臂', items: [
    { key: 'rightShoulderPitch', label: '肩部 · 前抬' }, { key: 'rightShoulderRoll', label: '肩部 · 外展' }, { key: 'rightShoulderYaw', label: '肩部 · 扭转' },
    { key: 'rightElbow', label: '手臂 · 弯曲' }, { key: 'rightWrist', label: '手腕 · 扭转' },
  ] },
  { title: '双腿', items: [
    { key: 'leftHip', label: '左腿 · 髋部' }, { key: 'leftKnee', label: '左腿 · 膝盖' }, { key: 'leftAnkle', label: '左脚 · 脚踝' },
    { key: 'rightHip', label: '右腿 · 髋部' }, { key: 'rightKnee', label: '右腿 · 膝盖' }, { key: 'rightAnkle', label: '右脚 · 脚踝' },
  ] },
]

function copyScene(scene: DirectorSceneData): DirectorSceneData {
  return JSON.parse(JSON.stringify(scene)) as DirectorSceneData
}

export function DirectorDesk({ nodeId, onClose }: Props) {
  const node = useCanvasStore((store) => store.nodes.find(item => item.id === nodeId && item.type === 'director'))
  const updateNodeData = useCanvasStore((store) => store.updateNodeData)
  const [scene, setScene] = useState<DirectorSceneData>(() => node?.type === 'director' ? copyScene(node.data.scene) : copyScene(DEFAULT_DIRECTOR_SCENE))
  const [selectedActor, setSelectedActor] = useState<string | null>(null)
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [objectSearch, setObjectSearch] = useState('')
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'pose'>('properties')
  const [viewMode, setViewMode] = useState<'director' | 'camera'>('director')
  const [transformMode, setTransformMode] = useState<'select' | 'translate' | 'rotate' | 'scale'>('select')
  const [focusRequest, setFocusRequest] = useState(0)
  const [saved, setSaved] = useState(true)
  const [saving, setSaving] = useState(false)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timeRef = useRef(time)
  timeRef.current = time
  const sampled = useMemo(() => sampleDirectorScene(scene, time), [scene, time])
  const duration = directorDuration(scene)
  useEffect(() => {
    if (!playing) return
    const start = performance.now(), offset = timeRef.current >= duration ? 0 : timeRef.current
    let frame = 0, last = -1
    const tick = (now: number) => {
      const current = Math.min(duration, offset + (now - start) / 1000)
      const renderFrame = Math.floor(current * 24)
      if (renderFrame !== last) { setTime(current); last = renderFrame }
      if (current >= duration) { setPlaying(false); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration])
  const deskRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    deskRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  useEffect(() => {
    if (node?.type === 'director') setScene(copyScene(node.data.scene))
  }, [nodeId])

  const commit = useCallback((next: DirectorSceneData, history = true) => {
    setScene(next)
    setSaved(false)
    updateNodeData(nodeId, { scene: next }, { history })
  }, [nodeId, updateNodeData])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      if (node?.type === 'director') updateNodeData(nodeId, { scene, lastCaptureAt: node.data.lastCaptureAt }, { history: true })
      await flushCanvasSave()
      const store = useCanvasStore.getState()
      if (store.revision !== store.savedRevision) throw new Error(store.saveError || '场景尚未保存，请重试')
      setSaved(true)
      store.setNotice('3D 导演台已保存到画布')
    } catch (error) {
      setSaved(false)
      useCanvasStore.getState().setNotice(error instanceof Error ? error.message : '场景保存失败，请重试')
    } finally { setSaving(false) }
  }, [node, nodeId, scene, updateNodeData])

  const capture = useCallback(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-director-viewport]')
    if (!canvas) return
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = `${node?.type === 'director' ? node.data.title : '导演台'}.png`
    link.click()
    updateNodeData(nodeId, { lastCaptureAt: Date.now() }, { history: true })
    useCanvasStore.getState().setNotice('已导出导演台预览图；如需用于生图，可将图片拖入画布')
  }, [node, nodeId, updateNodeData])

  if (!node || node.type !== 'director') return null

  const addActor = (figureModel: FigureModel = 'male') => {
    if (scene.actors.length >= DIRECTOR_LIMITS.actors) return useCanvasStore.getState().setNotice('每个场景最多支持 8 个角色')
    const index = scene.actors.length + 1
    const next = copyScene(scene)
    next.actors.push({ id: `actor-${Date.now()}`, name: `角色 ${index}`, x: (index % 3 - 1) * 1.4, y: 0, z: (index % 2) * -0.45, color: index % 2 ? '#74b9ff' : '#ff9f8a', scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, pose: 'idle', figureModel, posePreset: 'stand' })
    commit(next)
    setSelectedActor(next.actors.at(-1)!.id); setSelectedCamera(null); setInspectorTab('pose')
  }
  const addCamera = () => {
    if (scene.cameras.length >= DIRECTOR_LIMITS.cameras) return useCanvasStore.getState().setNotice('每个场景最多支持 6 个机位')
    const index = scene.cameras.length + 1
    const id = `camera-${Date.now()}`
    const next = copyScene(scene)
    next.cameras.push({ id, name: `机位 ${index}`, x: 0, y: 2.3, z: 6.5 + index, targetX: 0, targetY: 1, targetZ: 0, fov: 42, rotationX: 0, rotationY: 0, rotationZ: 0 })
    next.activeCameraId = id
    commit(next)
  }
  const setActor = (id: string, patch: Partial<DirectorActor>) => {
    setPlaying(false)
    commit({ ...scene, actors: scene.actors.map(actor => {
      if (actor.id !== id) return actor
      if (actor.keys?.length && ACTOR_KEY_FIELDS.some(field => field in patch)) return { ...recordActorKey(actor, time, patch), ...Object.fromEntries(Object.entries(patch).filter(([key]) => !(ACTOR_KEY_FIELDS as readonly string[]).includes(key))) }
      return { ...actor, ...patch }
    }) }, false)
  }
  const setCamera = (id: string, patch: Partial<DirectorCamera>) => {
    setPlaying(false)
    commit({ ...scene, cameras: scene.cameras.map(camera => camera.id === id ? camera.keys?.length && CAMERA_KEY_FIELDS.some(field => field in patch) ? { ...recordCameraKey(camera, time, patch), ...Object.fromEntries(Object.entries(patch).filter(([key]) => !(CAMERA_KEY_FIELDS as readonly string[]).includes(key))) } : { ...camera, ...patch } : camera) }, false)
  }
  const recordKey = () => {
    if (!selectedActor && !selectedCamera) return useCanvasStore.getState().setNotice('请先选择角色或机位')
    const item = scene.actors.find(actor => actor.id === selectedActor) ?? scene.cameras.find(camera => camera.id === selectedCamera)
    if ((item?.keys?.length ?? 0) >= DIRECTOR_LIMITS.keys && !item?.keys?.some(key => Math.abs(key.t - time) < .01)) return useCanvasStore.getState().setNotice('单个对象最多支持 120 个关键帧')
    setPlaying(false)
    commit({ ...scene, actors: scene.actors.map(actor => actor.id === selectedActor ? recordActorKey(actor, time) : actor), cameras: scene.cameras.map(camera => camera.id === selectedCamera ? recordCameraKey(camera, time) : camera) })
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input,textarea,select'))) return
      if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) setPlaying(value => !value) }
      if (event.code === 'KeyK') { event.preventDefault(); recordKey() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  })
  const removeActor = (id: string) => {
    // Removing the currently inspected actor must also clear its selection.
    // Otherwise the inspector keeps the stale id, `find()` returns undefined,
    // and the director desk crashes while rendering the deleted actor.
    if (selectedActor === id) setSelectedActor(null)
    commit({ ...scene, actors: scene.actors.filter(actor => actor.id !== id) })
  }
  const removeCamera = (id: string) => {
    if (scene.cameras.length <= 1) return
    const cameras = scene.cameras.filter(camera => camera.id !== id)
    if (selectedCamera === id) setSelectedCamera(null)
    commit({ ...scene, cameras, activeCameraId: scene.activeCameraId === id ? cameras[0].id : scene.activeCameraId })
  }

  const search = objectSearch.trim().toLocaleLowerCase()
  const visibleActors = scene.actors.filter((actor) => !search || actor.name.toLocaleLowerCase().includes(search))
  const visibleCameras = scene.cameras.filter((camera) => !search || camera.name.toLocaleLowerCase().includes(search))
  const selectedObject = selectedActor ? sampled.actors.find((actor) => actor.id === selectedActor) : selectedCamera ? sampled.cameras.find((camera) => camera.id === selectedCamera) : null
  const focusSelected = () => {
    if (!selectedObject) {
      useCanvasStore.getState().setNotice('请先选择一个角色或机位')
      return
    }
    setFocusRequest((value) => value + 1)
    useCanvasStore.getState().setNotice(`已将视图聚焦到${selectedObject.name}`)
  }

  return (
    <div ref={deskRef} data-director-desk role="dialog" aria-modal="true" aria-label="3D 导演台" className="pointer-events-auto fixed inset-0 z-[100] flex flex-col bg-background text-foreground" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(item => item.getClientRects().length > 0)
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-studio-accent/10 text-studio-accent"><ScanLine className="size-4" /></span>
        <CanvasThemeButton />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{node.data.title}</h2><p className="text-[10px] tracking-[0.12em] text-muted-foreground">3D 导演台 · 实时角色预演</p></div>
        <div className="hidden items-center rounded-lg border border-border bg-muted/50 p-0.5 text-[11px] sm:flex" role="group" aria-label="视角模式">
          <button type="button" aria-pressed={viewMode === 'director'} className={cn('rounded-md px-3 py-1.5 transition-colors', viewMode === 'director' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')} onClick={() => setViewMode('director')}><Move3d className="mr-1.5 inline size-3.5" />导演视角</button>
          <button type="button" aria-pressed={viewMode === 'camera'} className={cn('rounded-md px-3 py-1.5 transition-colors', viewMode === 'camera' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')} onClick={() => setViewMode('camera')}><Camera className="mr-1.5 inline size-3.5" />机位视角</button>
        </div>
        <button type="button" className="hidden items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-muted sm:flex" onClick={capture}><Maximize2 className="size-3.5" />导出预览图</button>
        <button type="button" className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={saved || saving} onClick={() => void save()}><Check className="size-3.5" />{saving ? '保存中…' : saved ? '已保存' : '保存到画布'}</button>
        <button type="button" aria-label="关闭导演台" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose}><X className="size-4" /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 flex max-h-[40vh] w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-card p-3 lg:order-1 lg:max-h-none lg:w-64 lg:border-t-0 lg:border-r">
          <DirectorFigureLibrary onAdd={addActor} disabled={scene.actors.length >= DIRECTOR_LIMITS.actors} />
          <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">场景对象</span><span className="text-[10px] text-muted-foreground">{scene.actors.length} 角色 · {scene.cameras.length} 机位</span></div>
          <label className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 text-xs text-muted-foreground"><Search className="size-3.5" /><input value={objectSearch} onChange={(event) => setObjectSearch(event.target.value)} placeholder="搜索资源" className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" aria-label="搜索导演台资源" /></label>
          <div className="mb-2 flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">角色</span><button type="button" className="inline-flex items-center gap-1 text-[11px] text-studio-accent hover:text-studio-accent" onClick={() => addActor()}><Plus className="size-3" />添加</button></div>
          <div className="flex flex-col gap-1.5">{visibleActors.map(actor => <div key={actor.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', selectedActor === actor.id ? 'border-studio-accent/60 bg-studio-accent/10' : 'border-border bg-muted/20')}><button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-foreground" onClick={() => { setSelectedActor(actor.id); setSelectedCamera(null); setInspectorTab('properties') }}><UserRound className="mr-1.5 inline size-3.5 text-muted-foreground" />{actor.name}</button><button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`删除${actor.name}`} onClick={() => removeActor(actor.id)}><Trash2 className="size-3.5" /></button></div>)}</div>
          <div className="my-4 h-px bg-muted" />
          <div className="mb-2 flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">摄像机</span><button type="button" className="inline-flex items-center gap-1 text-[11px] text-studio-accent hover:text-studio-accent" onClick={addCamera}><Plus className="size-3" />添加</button></div>
          <div className="flex flex-col gap-1.5">{visibleCameras.map(camera => <div key={camera.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', selectedCamera === camera.id ? 'border-studio-accent/60 bg-studio-accent/10' : 'border-border bg-muted/20')}><button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-foreground" onClick={() => { setSelectedCamera(camera.id); setSelectedActor(null); setInspectorTab('properties'); commit({ ...scene, activeCameraId: camera.id }, false) }}><CameraIcon />{camera.name}{scene.activeCameraId === camera.id && <span className="ml-1.5 text-[9px] text-muted-foreground">当前机位</span>}</button><button type="button" className="text-muted-foreground hover:text-destructive disabled:opacity-30" disabled={scene.cameras.length <= 1} aria-label={`删除${camera.name}`} onClick={() => removeCamera(camera.id)}><Trash2 className="size-3.5" /></button></div>)}</div>
          {!visibleActors.length && !visibleCameras.length && <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">没有匹配的场景对象</p>}
        </aside>
        <section className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs"><span className="text-muted-foreground">画幅</span>{(Object.keys(ASPECT_LABEL) as DirectorSceneData['aspect'][]).map(aspect => <button key={aspect} type="button" className={cn('rounded-md px-2.5 py-1.5', scene.aspect === aspect ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')} onClick={() => commit({ ...scene, aspect })}>{ASPECT_LABEL[aspect]}</button>)}<label className="ml-auto flex cursor-pointer items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={scene.grid} onChange={event => commit({ ...scene, grid: event.target.checked }, false)} /><Grid3X3 className="size-3.5" />网格</label></div>
          <div className="relative min-h-[320px] flex-1"><DirectorViewport scene={sampled} viewMode={viewMode} focusTarget={selectedObject} focusRequest={focusRequest} selectedActorId={selectedActor} selectedCameraId={selectedCamera} transformMode={transformMode} onSelect={selection => { setSelectedActor(selection?.kind === 'actor' ? selection.id : null); setSelectedCamera(selection?.kind === 'camera' ? selection.id : null); setInspectorTab('properties') }} onActorTransform={(id, patch) => setActor(id, patch)} onCameraTransform={(id, patch) => setCamera(id, patch)} /><div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[10px] text-muted-foreground">点击选择 · 拖动旋转 · 滚轮缩放 · 右键平移</div><div className="absolute bottom-4 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card/95 p-1.5 shadow-2xl backdrop-blur"><button type="button" aria-label="选择工具" title="选择工具" aria-pressed={transformMode === 'select'} onClick={() => setTransformMode('select')} className={cn('flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', transformMode === 'select' && 'bg-studio-accent/15 text-studio-accent')}><Crosshair className="size-4" /></button><button type="button" aria-label="移动工具" title="移动工具" aria-pressed={transformMode === 'translate'} className={cn('flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', transformMode === 'translate' && 'bg-studio-accent/15 text-studio-accent')} onClick={() => setTransformMode('translate')}><Move3d className="size-4" /></button><button type="button" aria-label="旋转工具" title="旋转工具" aria-pressed={transformMode === 'rotate'} className={cn('flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', transformMode === 'rotate' && 'bg-studio-accent/15 text-studio-accent')} onClick={() => setTransformMode('rotate')}><Rotate3d className="size-4" /></button><button type="button" aria-label="缩放工具" title="缩放工具" aria-pressed={transformMode === 'scale'} className={cn('flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', transformMode === 'scale' && 'bg-studio-accent/15 text-studio-accent')} onClick={() => setTransformMode('scale')}><Maximize2 className="size-4" /></button><button type="button" aria-label="聚焦当前对象" title="聚焦当前对象" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" onClick={focusSelected}><ScanLine className="size-4" /></button><button type="button" aria-label="切换网格" title="切换网格" aria-pressed={scene.grid} className={cn('flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', scene.grid && 'bg-studio-accent/15 text-studio-accent')} onClick={() => commit({ ...scene, grid: !scene.grid }, false)}><Grid3X3 className="size-4" /></button><button type="button" aria-label="切换姿态面板" title="切换姿态面板" aria-pressed={inspectorTab === 'pose'} className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setInspectorTab('pose')}><Rotate3d className="size-4" /></button></div></div>
        </section>
        <aside className="order-3 max-h-[42vh] w-full shrink-0 overflow-y-auto border-t border-border bg-card p-3 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
          {selectedObject && <div className="mb-3 flex items-center gap-1 rounded-lg bg-muted/50 p-1 text-[11px]" role="tablist" aria-label="对象属性"><button type="button" role="tab" aria-selected={inspectorTab === 'properties'} className={cn('flex-1 rounded-md px-2 py-1.5', inspectorTab === 'properties' ? 'bg-muted text-foreground' : 'text-muted-foreground')} onClick={() => setInspectorTab('properties')}><SlidersHorizontal className="mr-1 inline size-3.5" />属性</button><button type="button" role="tab" aria-selected={inspectorTab === 'pose'} className={cn('flex-1 rounded-md px-2 py-1.5', inspectorTab === 'pose' ? 'bg-muted text-foreground' : 'text-muted-foreground')} onClick={() => setInspectorTab('pose')}><Rotate3d className="mr-1 inline size-3.5" />姿态</button></div>}
          {selectedActor && scene.actors.find(actor => actor.id === selectedActor) ? <ActorInspector actor={sampled.actors.find(actor => actor.id === selectedActor)!} tab={inspectorTab} onChange={patch => setActor(selectedActor, patch)} /> : selectedCamera && scene.cameras.find(camera => camera.id === selectedCamera) ? <CameraInspector actors={scene.actors} camera={sampled.cameras.find(camera => camera.id === selectedCamera)!} onChange={patch => setCamera(selectedCamera, patch)} /> : <div className="flex h-full min-h-24 flex-col items-center justify-center text-center text-xs text-muted-foreground"><Clapperboard className="mb-2 size-5 text-muted-foreground" /><p>选择角色或机位<br />编辑位置、姿态与镜头参数</p></div>}
          <label className="mt-4 block text-[11px] text-muted-foreground">导演备注<textarea value={scene.notes} onChange={event => commit({ ...scene, notes: event.target.value }, false)} rows={3} placeholder="记录调度、镜头意图或对白提示" className="mt-1.5 w-full resize-none rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none focus:border-studio-accent/60" /></label>
        </aside>
      </div>
      <DirectorTimeline scene={scene} time={time} playing={playing} selectedId={selectedActor || selectedCamera} onTime={setTime} onPlaying={setPlaying} onDuration={value => { setPlaying(false); setTime(current => Math.min(current, value)); commit(resizeDirectorDuration(scene, value)) }} onRecord={recordKey} onDelete={() => { setPlaying(false); commit({ ...scene, actors: scene.actors.map(actor => actor.id === selectedActor ? { ...actor, keys: actor.keys?.filter(key => Math.abs(key.t - time) >= .03) } : actor), cameras: scene.cameras.map(camera => camera.id === selectedCamera ? { ...camera, keys: camera.keys?.filter(key => Math.abs(key.t - time) >= .03) } : camera) }) }} onMotion={motion => { if (!selectedCamera) return; setPlaying(false); setTime(0); commit(applyCameraMotion(scene, selectedCamera, motion, selectedActor ?? undefined)); setViewMode('camera') }} onSelect={(id, kind) => { setSelectedActor(kind === 'actor' ? id : null); setSelectedCamera(kind === 'camera' ? id : null); if (kind === 'camera') commit({ ...scene, activeCameraId: id }, false) }} />
    </div>
  )
}

function CameraIcon() { return <Camera className="mr-1.5 inline size-3.5 text-studio-accent" aria-hidden="true" /> }

function ActorInspector({ actor, tab = 'properties', onChange }: { actor: DirectorActor; tab?: 'properties' | 'pose'; onChange: (patch: Partial<DirectorActor>) => void }) {
  const controls = { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...(actor.poseControls ?? {}) }
  const setPoseControls = (patch: Partial<DirectorPoseControls>) => onChange({ poseControls: { ...controls, ...patch } })
  const applyPreset = (preset: typeof POSE_PRESETS[number]) => onChange({ pose: preset.pose, poseControls: { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...preset.controls } })
  if (tab === 'pose') return <PoseInspector actor={actor} controls={controls} setPoseControls={setPoseControls} applyPreset={applyPreset} onChange={onChange} />
  return <Inspector title={actor.name} subtitle="角色"><Field label="名称"><input className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/50 px-2 text-xs text-foreground" value={actor.name} onChange={event => onChange({ name: event.target.value })} /></Field>{tab === 'properties' ? <><Field label="模型"><select className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/50 px-2 text-xs text-foreground" value={actor.figureModel ? `figure:${actor.figureModel}` : (actor.modelUrl || DEFAULT_MODEL_URL)} onChange={event => onChange(event.target.value.startsWith('figure:') ? { figureModel: event.target.value.slice(7) as FigureModel, modelUrl: undefined, posePreset: actor.posePreset ?? 'stand', poseControls: { ...DEFAULT_DIRECTOR_POSE_CONTROLS } } : { figureModel: undefined, posePreset: undefined, modelUrl: event.target.value })}><option value="figure:male">男性人台</option><option value="figure:female">女性人台</option><option value={DEFAULT_MODEL_URL}>经典角色（旧版）</option><option value="builtin:whitebox">简化白盒</option></select></Field><Field label="颜色"><input type="color" value={actor.color} onChange={event => onChange({ color: event.target.value })} /></Field><Field label="位置"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={actor.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={actor.y} onChange={(value) => onChange({ y: value })} /><NumberField label="Z" value={actor.z} onChange={(value) => onChange({ z: value })} /></div></Field><Field label="旋转（度）"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={actor.rotationX} onChange={(value) => onChange({ rotationX: value })} /><NumberField label="Y" value={actor.rotationY} onChange={(value) => onChange({ rotationY: value })} /><NumberField label="Z" value={actor.rotationZ} onChange={(value) => onChange({ rotationZ: value })} /></div></Field><Field label="统一缩放"><input className="min-w-0 accent-studio-accent" type="range" min="0.5" max="2" step="0.05" value={actor.scale} onChange={event => onChange({ scale: Number(event.target.value) })} /><span className="min-w-7 text-right text-[10px] text-muted-foreground">{actor.scale.toFixed(2)}</span></Field></> : <><Field label="姿态"><select value={actor.pose} onChange={event => onChange({ pose: event.target.value as DirectorActor['pose'] })}><option value="idle">待机</option><option value="hero">英雄站姿</option><option value="walk">行走</option></select></Field><div className="grid grid-cols-3 gap-2"><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'idle' ? 'border-studio-accent/60 bg-studio-accent/10 text-studio-accent' : 'border-border text-muted-foreground')} onClick={() => onChange({ pose: 'idle' })}>待机</button><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'hero' ? 'border-studio-accent/60 bg-studio-accent/10 text-studio-accent' : 'border-border text-muted-foreground')} onClick={() => onChange({ pose: 'hero' })}>英雄</button><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'walk' ? 'border-studio-accent/60 bg-studio-accent/10 text-studio-accent' : 'border-border text-muted-foreground')} onClick={() => onChange({ pose: 'walk' })}>行走</button></div><p className="text-[11px] leading-5 text-muted-foreground">姿态会同步影响角色的骨骼关节，方便预演动作与构图。</p></>}</Inspector>
}

function isPosePresetActive(actor: DirectorActor, controls: DirectorPoseControls, preset: typeof POSE_PRESETS[number]) {
  if (actor.pose !== preset.pose) return false
  const expected = { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...preset.controls }
  return (Object.keys(DEFAULT_DIRECTOR_POSE_CONTROLS) as (keyof DirectorPoseControls)[]).every(key => controls[key] === expected[key])
}

function PoseInspector({ actor, controls, setPoseControls, applyPreset, onChange }: { onChange: (patch: Partial<DirectorActor>) => void; actor: DirectorActor; controls: DirectorPoseControls; setPoseControls: (patch: Partial<DirectorPoseControls>) => void; applyPreset: (preset: typeof POSE_PRESETS[number]) => void }) {
  const activePreset = POSE_PRESETS.find(preset => isPosePresetActive(actor, controls, preset))
  return <Inspector title={actor.name} subtitle="姿态">
    <Field label="人物模型"><select aria-label="姿态人物模型" className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/50 px-2 text-xs text-foreground" value={actor.figureModel ?? 'legacy'} onChange={event => onChange({ figureModel: event.target.value as FigureModel, modelUrl: undefined, posePreset: 'stand', poseControls: { ...DEFAULT_DIRECTOR_POSE_CONTROLS } })}>{!actor.figureModel && <option value="legacy" disabled>当前角色</option>}<option value="male">男性人台</option><option value="female">女性人台</option></select></Field>
    {actor.figureModel ? <DirectorPoseLibrary model={actor.figureModel} value={actorPoseId(actor)} onSelect={posePreset => onChange({ posePreset, poseControls: { ...DEFAULT_DIRECTOR_POSE_CONTROLS } })} /> : <>
    <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-[11px] text-muted-foreground">姿势预设</span>{activePreset ? <span className="inline-flex items-center gap-1 rounded-full border border-studio-accent/50 bg-studio-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-studio-accent"><Check className="size-2.5" />当前：{activePreset.label}</span> : <span className="rounded-full border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] text-muted-foreground">自定义姿态</span>}</div><button type="button" className="text-[10px] text-studio-accent hover:text-studio-accent" onClick={() => setPoseControls(DEFAULT_DIRECTOR_POSE_CONTROLS)}>重置关节</button></div>
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="姿态预设">{POSE_PRESETS.map(preset => { const selected = isPosePresetActive(actor, controls, preset); return <button key={preset.id} type="button" aria-pressed={selected} aria-label={`${preset.label}姿态${selected ? '（当前）' : ''}`} className={cn('relative rounded-md border px-1.5 py-2 text-[10px] transition-colors', selected ? 'border-studio-accent bg-studio-accent/15 font-medium text-studio-accent ring-1 ring-studio-accent/40' : 'border-border text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground')} onClick={() => applyPreset(preset)}>{selected && <Check aria-hidden="true" className="absolute right-1 top-1 size-2.5 text-studio-accent" />}{preset.label}</button> })}</div>
    </>}
    <button type="button" className="min-h-9 w-full rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setPoseControls(DEFAULT_DIRECTOR_POSE_CONTROLS)}>重置关节微调</button>
    <p className="text-[10px] leading-5 text-muted-foreground">先选姿势，再用下方滑杆微调关节；角度会保存到当前角色。</p>
    <div className="flex flex-col gap-4">{POSE_CONTROL_SECTIONS.map(section => <section key={section.title}><h4 className="mb-2 border-b border-border pb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground">{section.title}</h4><div className="flex flex-col gap-2.5">{section.items.map(item => <PoseSlider key={item.key} label={item.label} value={controls[item.key]} onChange={value => setPoseControls({ [item.key]: value })} />)}</div></section>)}</div>
  </Inspector>
}

function PoseSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="block text-[10px] text-muted-foreground"><span className="mb-1 flex items-center justify-between gap-2"><span>{label}</span><output className="rounded bg-muted/70 px-1.5 py-0.5 tabular-nums text-[9px] text-muted-foreground">{Math.round(value)}°</output></span><input aria-label={label} type="range" min="-240" max="240" step="1" value={value} onChange={event => onChange(Number(event.target.value))} className="h-1.5 w-full accent-studio-accent" /></label>
}

function CameraInspector({ camera, onChange, actors }: { actors: DirectorActor[]; camera: DirectorCamera; onChange: (patch: Partial<DirectorCamera>) => void }) {
  return <Inspector title={camera.name} subtitle="机位"><Field label="运镜目标"><select aria-label="运镜目标人物" className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/50 px-2 text-xs text-foreground" value={camera.lookAtActorId ?? ''} onChange={event => onChange({ lookAtActorId: event.target.value || undefined })}><option value="">自动选择角色</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></Field><Field label="名称"><input className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/50 px-2 text-xs text-foreground" value={camera.name} onChange={event => onChange({ name: event.target.value })} /></Field><Field label="位置"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={camera.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={camera.y} onChange={(value) => onChange({ y: value })} /><NumberField label="Z" value={camera.z} onChange={(value) => onChange({ z: value })} /></div></Field><Field label="旋转（度）"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={camera.rotationX} onChange={(value) => onChange({ rotationX: value })} /><NumberField label="Y" value={camera.rotationY} onChange={(value) => onChange({ rotationY: value })} /><NumberField label="Z" value={camera.rotationZ} onChange={(value) => onChange({ rotationZ: value })} /></div></Field><Field label="焦距 / FOV"><input className="min-w-0 accent-studio-accent" type="range" min="20" max="90" value={camera.fov} onChange={event => onChange({ fov: Number(event.target.value) })} /><span className="text-[10px] text-muted-foreground">{camera.fov}°</span></Field><p className="text-[11px] leading-5 text-muted-foreground">机位位置、旋转和焦距会实时影响镜头；切换到“机位视角”可预览当前镜头。</p></Inspector>
}

function Inspector({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <div><div className="mb-3 flex items-center justify-between gap-2"><h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>{subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}</div><div className="flex flex-col gap-3">{children}</div></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-[11px] text-muted-foreground"><span className="mb-1.5 block">{label}</span><span className="flex items-center gap-2">{children}</span></label> }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="block text-[10px] text-muted-foreground"><span className="mb-1 block">{label}</span><input type="number" step="0.1" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value) || 0)} className="h-8 w-full rounded-md border border-border bg-muted/50 px-2 text-xs text-foreground outline-none focus:border-studio-accent/60" /></label> }

function disposeObject(root: THREE.Object3D, options?: { skipGeometry?: boolean }) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (!options?.skipGeometry && !child.userData.sharedFigureGeometry) child.geometry.dispose()
    if (child instanceof THREE.SkinnedMesh) child.skeleton.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach(material => material.dispose())
  })
}

function tintModel(root: THREE.Object3D, color: string) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    const isMaterialArray = Array.isArray(child.material)
    const materials = (isMaterialArray ? child.material : [child.material]) as THREE.Material[]
    const tinted = materials.map(material => {
      const next = material.clone()
      // Keep the face readable after applying the actor's chosen color. The
      // bundled model separates the body, eyes and eyebrows into named meshes.
      const accent = child.name === 'Eyes' ? '#f8fafc' : child.name === 'Eyebrows' ? '#1f2937' : color
      if ('color' in next && next.color instanceof THREE.Color) next.color.set(accent)
      if (child.name === 'Eyes' && 'roughness' in next) next.roughness = 0.25
      return next
    })
    // Preserve the original material shape. A single-material mesh with a
    // one-item array can have no matching geometry group and render nothing.
    child.material = (isMaterialArray ? tinted : tinted[0]) as THREE.Mesh['material']
  })
}

function setBoneRotation(root: THREE.Object3D, name: string, axis: 'x' | 'y' | 'z', value: number) {
  const bone = root.getObjectByName(name)
  if (!bone) return
  bone.rotation[axis] += value
}

function setBoneRotationAbsolute(root: THREE.Object3D, name: string, axis: 'x' | 'y' | 'z', value: number) {
  const bone = root.getObjectByName(name)
  if (!bone) return
  bone.rotation[axis] = value
}

type RestBoneRotation = { x: number; y: number; z: number; order: THREE.EulerOrder }

/**
 * Keep the source rig's local rotations around so pose presets can be
 * reapplied without accumulating the previous preset's offsets. This is
 * intentionally stored on the cloned instance, not the cached GLB source.
 */
function captureActorRestPose(root: THREE.Object3D) {
  if (root.userData.directorRestRotations instanceof Map) return
  const rest = new Map<string, RestBoneRotation>()
  root.traverse((child) => {
    if (child instanceof THREE.Bone) {
      rest.set(child.uuid, { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z, order: child.rotation.order })
    }
  })
  root.userData.directorRestRotations = rest
}

function resetActorPose(root: THREE.Object3D) {
  const rest = root.userData.directorRestRotations
  if (!(rest instanceof Map)) return
  root.traverse((child) => {
    if (!(child instanceof THREE.Bone)) return
    const rotation = rest.get(child.uuid)
    if (!rotation) return
    child.rotation.set(rotation.x, rotation.y, rotation.z, rotation.order)
  })
}

function applyActorPose(root: THREE.Object3D, pose: DirectorActor['pose'], poseControls?: DirectorPoseControls) {
  // The source mesh is authored in a T-pose. Establish a natural standing
  // baseline first, then apply visible preset offsets and saved joint edits.
  // This is why the old GLB preview looked like the pose selector did nothing:
  // small offsets were being added to horizontal arms and the head lookup was
  // using the wrong case for the `Head` bone.
  // Quaternius' arm bones point upward in the source T-pose. In this rig a
  // The source rig's arms cross the chest when the baseline is left at its
  // authored T-pose rotation. For idle/walk poses, ±200° local Z places the
  // hands beside the hips. Hero/T-pose presets keep the earlier ±140° basis
  // so the existing arm presets remain readable and the T-pose can use the
  // -230°/+230° controls below.
  resetActorPose(root)
  const armBaseline = pose === 'hero' ? 140 : 200
  setBoneRotationAbsolute(root, 'upperarm_l', 'z', THREE.MathUtils.degToRad(armBaseline))
  setBoneRotationAbsolute(root, 'upperarm_r', 'z', THREE.MathUtils.degToRad(-armBaseline))
  if (pose === 'hero') {
    setBoneRotation(root, 'thigh_l', 'z', -0.1)
    setBoneRotation(root, 'thigh_r', 'z', 0.1)
  }
  const controls = { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...(poseControls ?? {}) }
  const radians = (value: number) => THREE.MathUtils.degToRad(value)
  const rotate = (name: string, axis: 'x' | 'y' | 'z', value: number) => setBoneRotation(root, name, axis, radians(value))
  rotate('spine_01', 'x', controls.torsoPitch)
  rotate('spine_01', 'y', controls.torsoYaw)
  rotate('spine_01', 'z', controls.torsoRoll)
  rotate('Head', 'x', controls.headPitch)
  rotate('Head', 'y', controls.headYaw)
  rotate('Head', 'z', controls.headRoll)
  rotate('upperarm_l', 'x', controls.leftShoulderPitch)
  rotate('upperarm_l', 'y', controls.leftShoulderYaw)
  rotate('upperarm_l', 'z', controls.leftShoulderRoll)
  rotate('lowerarm_l', 'x', controls.leftElbow)
  rotate('hand_l', 'z', controls.leftWrist)
  rotate('upperarm_r', 'x', controls.rightShoulderPitch)
  rotate('upperarm_r', 'y', controls.rightShoulderYaw)
  rotate('upperarm_r', 'z', controls.rightShoulderRoll)
  rotate('lowerarm_r', 'x', controls.rightElbow)
  rotate('hand_r', 'z', controls.rightWrist)
  rotate('thigh_l', 'x', controls.leftHip)
  rotate('calf_l', 'x', controls.leftKnee)
  rotate('foot_l', 'x', controls.leftAnkle)
  rotate('thigh_r', 'x', controls.rightHip)
  rotate('calf_r', 'x', controls.rightKnee)
  rotate('foot_r', 'x', controls.rightAnkle)
}

function addWhiteBoxActor(group: THREE.Group, actor: DirectorActor) {
  const controls = { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...(actor.poseControls ?? {}) }
  const radians = (value: number) => THREE.MathUtils.degToRad(value)
  const material = new THREE.MeshStandardMaterial({ color: actor.color, roughness: .72 })
  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, position: [number, number, number], rotation?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.directorFallback = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.set(...position)
    if (rotation) mesh.rotation.set(...rotation)
    parent.add(mesh)
    return mesh
  }
  const torso = new THREE.Group()
  torso.position.set(0, .78, 0)
  torso.rotation.set(radians(controls.torsoPitch), radians(controls.torsoYaw), radians(controls.torsoRoll))
  group.add(torso)
  add(torso, new THREE.CapsuleGeometry(.3, .86, 6, 12), [0, .42, 0])
  add(torso, new THREE.SphereGeometry(.31, 14, 10), [0, 0, 0])
  const neck = new THREE.Group()
  neck.position.set(0, 1.05, 0)
  torso.add(neck)
  add(neck, new THREE.CylinderGeometry(.12, .14, .16, 10), [0, 0, 0])
  const head = new THREE.Group()
  head.position.set(0, .24, 0)
  head.rotation.set(radians(controls.headPitch), radians(controls.headYaw), radians(controls.headRoll))
  neck.add(head)
  add(head, new THREE.SphereGeometry(.28, 16, 12), [0, .1, 0])
  const buildArm = (side: -1 | 1, shoulderPitch: number, shoulderRoll: number, elbow: number, wrist: number) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * .4, .9, 0)
    shoulder.rotation.set(radians(shoulderPitch), 0, side * (radians(.06 * 57.3) + radians(shoulderRoll)))
    torso.add(shoulder)
    add(shoulder, new THREE.CapsuleGeometry(.095, .62, 5, 8), [0, -.3, 0])
    const forearm = new THREE.Group()
    forearm.position.set(0, -.62, 0)
    forearm.rotation.set(radians(elbow), 0, 0)
    shoulder.add(forearm)
    add(forearm, new THREE.CapsuleGeometry(.095, .42, 5, 8), [0, -.22, 0])
    const hand = new THREE.Group()
    hand.position.set(0, -.46, 0)
    hand.rotation.z = radians(wrist)
    forearm.add(hand)
    add(hand, new THREE.SphereGeometry(.12, 10, 8), [0, -.08, 0])
  }
  buildArm(-1, controls.leftShoulderPitch, controls.leftShoulderRoll, controls.leftElbow, controls.leftWrist)
  buildArm(1, controls.rightShoulderPitch, controls.rightShoulderRoll, controls.rightElbow, controls.rightWrist)
  const buildLeg = (side: -1 | 1, hip: number, knee: number, ankle: number) => {
    const thigh = new THREE.Group()
    // Keep the hierarchical legs anchored beneath the pelvis instead of
    // placing the whole chain below the floor plane.
    thigh.position.set(side * .16, .72, 0)
    thigh.rotation.z = radians(side * (actor.pose === 'walk' ? 11 : actor.pose === 'hero' ? 3 : 0))
    thigh.rotation.x += radians(hip)
    torso.add(thigh)
    add(thigh, new THREE.CapsuleGeometry(.12, .62, 5, 8), [0, -.35, 0])
    const shin = new THREE.Group()
    shin.position.set(0, -.67, 0)
    shin.rotation.x = radians(knee)
    thigh.add(shin)
    add(shin, new THREE.CapsuleGeometry(.12, .5, 5, 8), [0, -.27, 0])
    const foot = new THREE.Group()
    foot.position.set(0, -.55, -.06)
    foot.rotation.x = radians(ankle)
    shin.add(foot)
    add(foot, new THREE.CapsuleGeometry(.12, .25, 5, 8), [0, 0, -.08], [0, Math.PI / 2, 0])
  }
  buildLeg(-1, controls.leftHip, controls.leftKnee, controls.leftAnkle)
  buildLeg(1, controls.rightHip, controls.rightKnee, controls.rightAnkle)
  return torso
}

function DirectorViewport({ scene, viewMode, focusTarget, focusRequest, selectedActorId, selectedCameraId, transformMode, onSelect, onActorTransform, onCameraTransform }: { scene: DirectorSceneData; viewMode: 'director' | 'camera'; focusTarget: DirectorActor | DirectorCamera | null | undefined; focusRequest: number; selectedActorId: string | null; selectedCameraId: string | null; transformMode: 'select' | 'translate' | 'rotate' | 'scale'; onSelect: (selection: DirectorSelection) => void; onActorTransform: (id: string, patch: Partial<DirectorActor>) => void; onCameraTransform: (id: string, patch: Partial<DirectorCamera>) => void }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [loadState, setLoadState] = useState<Partial<Record<FigureModel, 'loading' | 'ready' | 'failed'>>>({})
  const [loadAttempt, setLoadAttempt] = useState(0)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const resizeViewportRef = useRef<() => void>(() => {})
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelCacheRef = useRef(new Map<string, Promise<THREE.Object3D | null>>())
  const transformRef = useRef<TransformControls | null>(null)
  const objectRefs = useRef(new Map<string, THREE.Object3D>())
  const { state: { theme } } = useStudio()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const floorRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const selectRef = useRef(onSelect)
  const viewModeRef = useRef(viewMode)
  const previousViewMode = useRef<string | null>(null)
  selectRef.current = onSelect
  viewModeRef.current = viewMode
  const latestSceneRef = useRef(scene)
  const actorTransformRef = useRef(onActorTransform)
  const cameraTransformRef = useRef(onCameraTransform)
  latestSceneRef.current = scene
  actorTransformRef.current = onActorTransform
  cameraTransformRef.current = onCameraTransform
  // Rebuild the Three.js graph only when the object list/model source changes.
  // Pose sliders, transforms and camera settings are applied in the lightweight
  // effect below so a preset switch does not tear down and reload the scene.
  const sceneStructureKey = JSON.stringify({
    loadAttempt,
    grid: scene.grid,
    actors: scene.actors.map(actor => ({ id: actor.id, figureModel: actor.figureModel, modelUrl: actor.modelUrl || DEFAULT_MODEL_URL })),
    cameras: scene.cameras.map(camera => camera.id),
  })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true }) } catch { mount.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-muted-foreground">当前浏览器不支持 WebGL 预览</div>'; return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0x080b0f, 1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; mount.append(renderer.domElement); renderer.domElement.dataset.directorViewport = 'true'; rendererRef.current = renderer
    const world = new THREE.Scene(); sceneRef.current = world
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100); camera.position.set(0, 2.3, 4.8); cameraRef.current = camera
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1.05, 0); controls.enableDamping = true; controls.minDistance = 2.2; controls.maxDistance = 16; controlsRef.current = controls
    const transform = new TransformControls(camera, renderer.domElement)
    let transformed = false
    transform.setMode('translate')
    transform.setSpace('world')
    transform.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as { value?: unknown }).value)
      if (dragging) transformed = true
      controls.enabled = !dragging
      if (dragging || !transform.object) return
      const object = transform.object
      const id = typeof object.userData.directorActorId === 'string' ? object.userData.directorActorId : typeof object.userData.directorCameraId === 'string' ? object.userData.directorCameraId : ''
      if (!id) return
      const degrees = (value: number) => Math.round(THREE.MathUtils.radToDeg(value) * 10) / 10
      const poseOffset = object.userData.poseOffset as { x: number; y: number; z: number } | undefined
      const patch = { x: object.position.x, y: object.position.y, z: object.position.z, rotationX: degrees(object.rotation.x - (poseOffset?.x ?? 0)), rotationY: degrees(object.rotation.y - (poseOffset?.y ?? 0)), rotationZ: degrees(object.rotation.z - (poseOffset?.z ?? 0)) }
      if (object.userData.directorActorId) actorTransformRef.current(id, { ...patch, scale: object.scale.x })
      else cameraTransformRef.current(id, patch)
    })
    transformRef.current = transform
    world.add(transform.getHelper())
    world.add(new THREE.HemisphereLight(0xd7edff, 0x1b2030, 1.8)); const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 7, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); world.add(key)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ color: 0x101722, roughness: 0.9, metalness: 0.05 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor)
    floorRef.current = floor.material
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let start: { x: number; y: number; pointerId: number } | null = null
    const pointerDown = (event: PointerEvent) => { if (event.button !== 0) return; transformed = false; start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId } }
    const pointerUp = (event: PointerEvent) => {
      const pick = isDirectorPick(start, event, transformed)
      start = null
      if (!pick || viewModeRef.current !== 'director') return
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects([...objectRefs.current.values()], true)
      selectRef.current(directorObjectIdentity(hits[0]?.object ?? null))
    }
    const pointerCancel = () => { start = null }
    renderer.domElement.addEventListener('pointerdown', pointerDown, true)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerCancel)
    const resize = () => {
      const [w, h] = latestSceneRef.current.aspect.split(':').map(Number), ratio = w / h
      const width = Math.min(mount.clientWidth || 1, (mount.clientHeight || 1) * ratio), height = width / ratio
      renderer.setSize(width, height, false)
      Object.assign(renderer.domElement.style, { position: 'absolute', width: `${width}px`, height: `${height}px`, left: '50%', top: '50%', transform: 'translate(-50%,-50%)' })
      camera.aspect = ratio; camera.updateProjectionMatrix()
    }
    resizeViewportRef.current = resize
    resize(); const observer = new ResizeObserver(resize); observer.observe(mount)
    let frame = 0; const animate = () => { controls.update(); renderer.render(world, camera); frame = requestAnimationFrame(animate) }; animate()
    return () => {
      renderer.domElement.removeEventListener('pointerdown', pointerDown, true); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointercancel', pointerCancel)
      cancelAnimationFrame(frame); observer.disconnect(); transform.detach(); transform.dispose(); transformRef.current = null; controls.dispose(); controlsRef.current = null; renderer.dispose(); renderer.domElement.remove(); disposeObject(world)
      for (const promise of modelCacheRef.current.values()) void promise.then(model => { if (model) disposeObject(model) })
      modelCacheRef.current.clear()
    }
  }, [])

  useEffect(() => { resizeViewportRef.current() }, [scene.aspect])

  useEffect(() => {
    const dark = theme === 'dark'
    rendererRef.current?.setClearColor(dark ? 0x080b0f : 0xe9edf1, 1)
    floorRef.current?.color.set(dark ? 0x101722 : 0xcbd5df)
    sceneRef.current?.traverse(object => {
      if (!(object instanceof THREE.GridHelper)) return
      const colors = object.geometry.getAttribute('color')
      const center = new THREE.Color(dark ? 0x477380 : 0x8b9ca5), line = new THREE.Color(dark ? 0x293d46 : 0xc1cbd1)
      for (let i = 0; i < colors.count; i += 1) { const color = Math.floor(i / 8) === 14 ? center : line; colors.setXYZ(i, color.r, color.g, color.b) }
      colors.needsUpdate = true
    })
  }, [theme])

  useEffect(() => {
    const world = sceneRef.current; if (!world) return
    let active = true
    objectRefs.current.clear()
    transformRef.current?.detach()
    for (const object of [...world.children]) if (object.userData.directorObject) {
      world.remove(object)
      // SkeletonUtils.clone shares buffer geometry with the cached GLB source;
      // dispose only clone materials here so a later actor can reuse the cache.
      const fallbackRoot = object.userData.directorFallbackRoot as THREE.Object3D | undefined
      if (fallbackRoot) disposeObject(fallbackRoot)
      disposeObject(object, { skipGeometry: Boolean(object.userData.directorModelInstance) })
    }
    if (scene.grid) { const grid = new THREE.GridHelper(14, 28, themeRef.current === 'dark' ? 0x477380 : 0x8b9ca5, themeRef.current === 'dark' ? 0x293d46 : 0xc1cbd1); grid.position.y = 0.01; grid.userData.directorObject = true; world.add(grid) }

    const loader = new GLTFLoader()
    const loadModel = (url: string) => {
      let promise = modelCacheRef.current.get(url)
      if (!promise) {
        promise = loader.loadAsync(url).then(gltf => gltf.scene).catch(() => null)
        modelCacheRef.current.set(url, promise)
      }
      return promise
    }
    const modelInstance = (actor: DirectorActor, model: THREE.Object3D | null) => {
      if (!model) return null
      try {
        const instance = cloneSkinnedModel(model)
        tintModel(instance, actor.color)
        instance.scale.setScalar(1.15)
        // Quaternius' source character faces -Z while the director camera
        // approaches from +Z. Rotate the instance so the actor's face and
        // hands are presented to the user instead of showing the back.
        instance.rotation.y = Math.PI
        captureActorRestPose(instance)
        applyActorPose(instance, actor.pose, actor.poseControls)
        instance.userData.directorModelColor = actor.color
        instance.traverse((child) => {
          child.visible = true
          if (!(child instanceof THREE.Mesh)) return
          child.frustumCulled = false
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          materials.forEach((material) => {
            material.transparent = false
            material.opacity = 1
            material.depthWrite = true
          })
        })
        instance.updateMatrixWorld(true)
        instance.userData.directorObject = true
        return instance
      } catch {
        return null
      }
    }
    const appendActor = (actor: DirectorActor, model: THREE.Object3D | null) => {
      if (!active) return
      const group = new THREE.Group(); group.userData.directorObject = true; group.userData.directorActorId = actor.id; group.userData.poseOffset = { x: 0, y: !actor.figureModel && actor.pose === 'walk' ? .2 : 0, z: !actor.figureModel && actor.pose === 'hero' ? -.08 : 0 }; group.position.set(actor.x, actor.y, actor.z); group.rotation.set(THREE.MathUtils.degToRad(actor.rotationX || 0) + group.userData.poseOffset.x, THREE.MathUtils.degToRad(actor.rotationY || 0) + group.userData.poseOffset.y, THREE.MathUtils.degToRad(actor.rotationZ || 0) + group.userData.poseOffset.z); group.scale.setScalar(actor.scale); objectRefs.current.set(`actor:${actor.id}`, group)
      const instance = modelInstance(actor, model)
      // Keep a procedural mannequin underneath every actor. Some valid GLB
      // files can instantiate without producing visible pixels in a user's
      // browser (for example after a context restore); the mannequin keeps
      // the scene usable instead of leaving an empty transform gizmo.
      group.userData.directorFallbackRoot = addWhiteBoxActor(group, actor)
      if (instance) {
        // The mannequin is only a loading/error fallback. Keeping it in front
        // of the GLB makes the detailed model look like a capsule character.
        group.traverse((child) => {
          if (child.userData.directorFallback) child.visible = false
        })
        group.add(instance)
        group.userData.directorModelInstance = instance
      }
      world.add(group)
    }
    scene.actors.forEach(actor => {
      if (actor.figureModel) {
        appendActor(actor, null)
        const model = actor.figureModel
        setLoadState(current => ({ ...current, [model]: 'loading' }))
        void loadFigureModel(undefined, model).then(ready => {
          if (!active) return
          setLoadState(current => ({ ...current, [model]: ready ? 'ready' : 'failed' }))
          if (!ready) return
          const group = objectRefs.current.get(`actor:${actor.id}`)
          const currentActor = latestSceneRef.current.actors.find(item => item.id === actor.id)
          if (!(group instanceof THREE.Group) || !currentActor) return
          const instance = createActorFigure(currentActor)
          const fallback = group.userData.directorFallbackRoot as THREE.Object3D | undefined
          if (fallback) { group.remove(fallback); disposeObject(fallback); delete group.userData.directorFallbackRoot }
          group.add(instance); group.userData.directorModelInstance = instance
        })
        return
      }
      const requested = actor.modelUrl === 'builtin:whitebox' ? '' : (actor.modelUrl || DEFAULT_MODEL_URL)
      if (!requested) { appendActor(actor, null); return }
      // Put the procedural mannequin in the scene immediately. A remote or
      // malformed GLB must never leave the actor as empty space while it loads.
      appendActor(actor, null)
      void loadModel(requested).then(model => {
        if (!active || !model) return
        const group = objectRefs.current.get(`actor:${actor.id}`)
        const currentActor = latestSceneRef.current.actors.find(item => item.id === actor.id) ?? actor
        const instance = group && modelInstance(currentActor, model)
        if (!(group instanceof THREE.Group) || !instance) return
        // Hide the fallback once the detailed model has finished loading.
        // When loading fails, the fallback remains visible because this block
        // is never reached.
        const fallbackRoot = group.userData.directorFallbackRoot as THREE.Object3D | undefined
        if (fallbackRoot) fallbackRoot.visible = false
        group.add(instance)
        group.userData.directorModelInstance = instance
      })
    })
    scene.cameras.forEach(camera => { const marker = new THREE.Mesh(new THREE.BoxGeometry(.32, .18, .55), new THREE.MeshStandardMaterial({ color: camera.id === scene.activeCameraId ? 0x67e8f9 : 0x738091 })); marker.userData.directorObject = true; marker.userData.directorCameraId = camera.id; marker.position.set(camera.x, camera.y, camera.z); if (camera.rotationX || camera.rotationY || camera.rotationZ) marker.rotation.set(THREE.MathUtils.degToRad(camera.rotationX || 0), THREE.MathUtils.degToRad(camera.rotationY || 0), THREE.MathUtils.degToRad(camera.rotationZ || 0)); else marker.lookAt(camera.targetX, camera.targetY, camera.targetZ); objectRefs.current.set(`camera:${camera.id}`, marker); world.add(marker) })
    return () => { active = false }
  }, [sceneStructureKey])

  // Apply mutable scene data to the existing object graph. This keeps pose
  // changes on the already-cloned skeleton and makes preset/sliders respond
  // on the next render frame instead of waiting for a GLB reload.
  useEffect(() => {
    const world = sceneRef.current
    if (!world) return
    scene.actors.forEach((actor) => {
      const group = objectRefs.current.get(`actor:${actor.id}`)
      if (!(group instanceof THREE.Group)) return
      const poseOffset = { x: 0, y: !actor.figureModel && actor.pose === 'walk' ? .2 : 0, z: !actor.figureModel && actor.pose === 'hero' ? -.08 : 0 }
      group.userData.poseOffset = poseOffset
      group.position.set(actor.x, actor.y, actor.z)
      group.rotation.set(
        THREE.MathUtils.degToRad(actor.rotationX || 0) + (poseOffset?.x ?? 0),
        THREE.MathUtils.degToRad(actor.rotationY || 0) + (poseOffset?.y ?? 0),
        THREE.MathUtils.degToRad(actor.rotationZ || 0) + (poseOffset?.z ?? 0),
      )
      group.scale.setScalar(actor.scale)
      const model = group.userData.directorModelInstance as THREE.Object3D | undefined
      if (model && actor.figureModel) {
        updateActorFigure(model as THREE.Group, actor)
      } else if (model) {
        if (model.userData.directorModelColor !== actor.color) {
          tintModel(model, actor.color)
          model.userData.directorModelColor = actor.color
        }
        applyActorPose(model, actor.pose, actor.poseControls)
        model.updateMatrixWorld(true)
      } else {
        // Keep the error/loading mannequin interactive too. Rebuilding this
        // tiny hierarchy is cheap and avoids stale fallback joint transforms.
        const previousFallback = group.userData.directorFallbackRoot as THREE.Object3D | undefined
        if (previousFallback) {
          group.remove(previousFallback)
          disposeObject(previousFallback)
        }
        group.userData.directorFallbackRoot = addWhiteBoxActor(group, actor)
      }
      group.updateMatrixWorld(true)
    })
    scene.cameras.forEach((camera) => {
      const marker = objectRefs.current.get(`camera:${camera.id}`)
      if (!(marker instanceof THREE.Object3D)) return
      marker.position.set(camera.x, camera.y, camera.z)
      if (camera.rotationX || camera.rotationY || camera.rotationZ) {
        marker.rotation.set(THREE.MathUtils.degToRad(camera.rotationX || 0), THREE.MathUtils.degToRad(camera.rotationY || 0), THREE.MathUtils.degToRad(camera.rotationZ || 0))
      } else {
        marker.lookAt(camera.targetX, camera.targetY, camera.targetZ)
      }
      if (marker instanceof THREE.Mesh) {
        const material = marker.material
        if (!Array.isArray(material) && 'color' in material && material.color instanceof THREE.Color) material.color.set(camera.id === scene.activeCameraId ? 0x67e8f9 : 0x738091)
      }
    })
  }, [scene])

  useEffect(() => {
    const transform = transformRef.current
    if (!transform) return
    // Camera markers have no persisted scale field; keep the gizmo in a
    // durable mode instead of allowing a visual scale that snaps back on save.
    if (transformMode !== 'select') transform.setMode(transformMode === 'scale' && selectedCameraId ? 'translate' : transformMode)
    const selected = selectedActorId ? objectRefs.current.get(`actor:${selectedActorId}`) : selectedCameraId ? objectRefs.current.get(`camera:${selectedCameraId}`) : undefined
    if (selected && viewMode === 'director' && transformMode !== 'select') transform.attach(selected)
    else transform.detach()
  }, [selectedActorId, selectedCameraId, transformMode, viewMode, scene])

  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera) return
    const active = scene.cameras.find((item) => item.id === scene.activeCameraId) ?? scene.cameras[0]
    if (viewMode === 'camera' && active) {
      camera.position.set(active.x, active.y, active.z); camera.fov = active.fov; controls?.target.set(active.targetX, active.targetY, active.targetZ); if (active.rotationX || active.rotationY || active.rotationZ) camera.rotation.set(THREE.MathUtils.degToRad(active.rotationX || 0), THREE.MathUtils.degToRad(active.rotationY || 0), THREE.MathUtils.degToRad(active.rotationZ || 0)); else camera.lookAt(active.targetX, active.targetY, active.targetZ); if (controls) { controls.enabled = false; controls.update() }
    } else if (previousViewMode.current !== 'director') {
      camera.position.set(0, 2.3, 4.8); camera.fov = 42; controls?.target.set(0, 1.05, 0); camera.lookAt(0, 1.05, 0); if (controls) { controls.enabled = true; controls.update() }
    }
    previousViewMode.current = viewMode
    camera.updateProjectionMatrix()
  }, [scene.activeCameraId, scene.cameras, viewMode])
  useEffect(() => {
    const camera = cameraRef.current; const controls = controlsRef.current
    if (!camera || !controls || !focusTarget || focusRequest === 0) return
    if ('fov' in focusTarget) { camera.position.set(focusTarget.x, focusTarget.y, focusTarget.z); controls.target.set(focusTarget.targetX, focusTarget.targetY, focusTarget.targetZ) } else { camera.position.set(focusTarget.x + 3.5, Math.max(2.4, focusTarget.y + 2.1), focusTarget.z + 4.5); controls.target.set(focusTarget.x, focusTarget.y + 1, focusTarget.z) }
    camera.lookAt(controls.target); controls.update()
  }, [focusRequest])
  const pending = Object.entries(loadState).filter(([model, status]) => status !== 'ready' && scene.actors.some(actor => actor.figureModel === model))
  return <><div ref={mountRef} data-director-viewport className="absolute inset-0 overflow-hidden" />{pending.length > 0 && <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow" role="status">{pending.map(([model, status]) => <div key={model} className="flex items-center gap-2"><span>{FIGURE_LABELS[model as FigureModel]}{status === 'failed' ? '加载失败，正在使用简化预览' : '正在加载…'}</span>{status === 'failed' && <button type="button" className="min-h-8 text-studio-accent underline" onClick={() => setLoadAttempt(value => value + 1)}>重试</button>}</div>)}</div>}</>
}
