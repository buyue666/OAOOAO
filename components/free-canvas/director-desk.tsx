'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinnedModel } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { Camera, Check, Clapperboard, Crosshair, Grid3X3, Maximize2, Move3d, Plus, Rotate3d, ScanLine, Search, SlidersHorizontal, Trash2, UserRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from './canvas-store'
import { DEFAULT_DIRECTOR_SCENE } from './node-factory'
import { DEFAULT_DIRECTOR_POSE_CONTROLS, type DirectorActor, type DirectorCamera, type DirectorPoseControls, type DirectorSceneData } from './types'

type Props = { nodeId: string; onClose: () => void }

const ASPECT_LABEL: Record<DirectorSceneData['aspect'], string> = { '16:9': '横屏 16:9', '9:16': '竖屏 9:16', '1:1': '方形 1:1' }
const DEFAULT_MODEL_URL = '/assets/director/quaternius-superhero.glb'

const POSE_PRESETS: Array<{ id: string; label: string; pose: DirectorActor['pose']; controls: Partial<DirectorPoseControls> }> = [
  { id: 'stand', label: '站立', pose: 'idle', controls: {} },
  { id: 't-pose', label: 'T 型', pose: 'hero', controls: { leftShoulderRoll: -230, rightShoulderRoll: 230 } },
  { id: 'walk', label: '行走', pose: 'walk', controls: { torsoPitch: -4, headPitch: -2, leftShoulderPitch: -22, rightShoulderPitch: 22, leftShoulderYaw: 10, rightShoulderYaw: -10, leftElbow: -18, rightElbow: -18, leftHip: -18, rightHip: 18, leftKnee: 16, rightKnee: -10, leftAnkle: 4, rightAnkle: -4 } },
  { id: 'run', label: '跑步', pose: 'walk', controls: { torsoPitch: -18, headPitch: -5, leftShoulderPitch: -38, rightShoulderPitch: 38, leftShoulderYaw: 20, rightShoulderYaw: -20, leftElbow: -55, rightElbow: -55, leftHip: -22, rightHip: 18, leftKnee: 38, rightKnee: 18, leftAnkle: -8, rightAnkle: 6 } },
  { id: 'sit', label: '坐姿', pose: 'idle', controls: { torsoPitch: -12, leftHip: -42, rightHip: -42, leftKnee: 72, rightKnee: 72, leftAnkle: -16, rightAnkle: -16 } },
  { id: 'squat', label: '蹲下', pose: 'idle', controls: { torsoPitch: -20, leftHip: -30, rightHip: -30, leftKnee: 60, rightKnee: 60, leftAnkle: -12, rightAnkle: -12 } },
  { id: 'single-jump', label: '单腿跳', pose: 'walk', controls: { torsoPitch: -8, leftShoulderPitch: 28, rightShoulderPitch: 28, leftElbow: -28, rightElbow: -28, leftHip: -24, rightHip: 28, leftKnee: 58, rightKnee: 78, leftAnkle: -12, rightAnkle: 18 } },
  { id: 'double-jump', label: '双腿跳', pose: 'walk', controls: { torsoPitch: -10, leftShoulderPitch: 34, rightShoulderPitch: 34, leftElbow: -32, rightElbow: -32, leftHip: -28, rightHip: 28, leftKnee: 58, rightKnee: 58, leftAnkle: -16, rightAnkle: -16 } },
  { id: 'akimbo', label: '叉腰', pose: 'hero', controls: { torsoPitch: -4, leftShoulderPitch: 32, rightShoulderPitch: 32, leftShoulderRoll: -55, rightShoulderRoll: 55, leftElbow: -98, rightElbow: -98, leftWrist: 18, rightWrist: -18 } },
  { id: 'lean', label: '俯靠', pose: 'idle', controls: { torsoPitch: -34, torsoRoll: -18, headPitch: -16, leftShoulderPitch: 28, rightShoulderPitch: 28, leftElbow: -28, rightElbow: -28 } },
  { id: 'turn', label: '翻身', pose: 'idle', controls: { torsoYaw: 88, headYaw: 55, leftShoulderYaw: -52, rightShoulderYaw: 52, leftHip: -18, rightHip: 18 } },
  { id: 'think', label: '思考', pose: 'idle', controls: { torsoYaw: -24, torsoPitch: -12, headPitch: -34, headYaw: 32, headRoll: -12, leftShoulderPitch: 52, leftShoulderRoll: -28, leftElbow: -118, leftWrist: 44 } },
  { id: 'fight', label: '格斗', pose: 'hero', controls: { torsoPitch: -10, torsoYaw: -18, torsoRoll: -6, leftShoulderPitch: 34, rightShoulderPitch: 34, leftShoulderRoll: -24, rightShoulderRoll: 24, leftElbow: -82, rightElbow: -82, leftHip: -22, rightHip: 22, leftKnee: 22, rightKnee: 12 } },
  { id: 'dodge', label: '躲球', pose: 'idle', controls: { torsoPitch: -16, torsoRoll: -34, headRoll: -18, leftShoulderPitch: -42, rightShoulderPitch: -42, leftHip: -35, rightHip: 24, leftKnee: 24, rightKnee: 24 } },
  { id: 'throw', label: '投球', pose: 'hero', controls: { torsoYaw: -34, torsoPitch: -8, rightShoulderPitch: -88, rightShoulderRoll: 58, rightElbow: -28, leftShoulderPitch: 30, leftShoulderRoll: -22, leftElbow: -52 } },
  { id: 'push', label: '推进', pose: 'hero', controls: { torsoPitch: 18, leftShoulderPitch: -58, rightShoulderPitch: -58, leftShoulderRoll: -22, rightShoulderRoll: 22, leftElbow: -18, rightElbow: -18, leftHip: -22, rightHip: -22 } },
  { id: 'wave', label: '招手', pose: 'hero', controls: { rightShoulderPitch: -72, rightShoulderRoll: 260, rightElbow: -40, rightWrist: 32, leftShoulderRoll: -50 } },
  { id: 'reach', label: '伸手', pose: 'hero', controls: { torsoPitch: -8, rightShoulderPitch: -52, rightShoulderRoll: 24, rightElbow: -8, rightWrist: 0, leftShoulderRoll: -20 } },
  { id: 'raise', label: '抬臂', pose: 'hero', controls: { leftShoulderRoll: -70, rightShoulderRoll: 250, leftShoulderPitch: 12, rightShoulderPitch: -12, leftElbow: -18, rightElbow: -18 } },
  { id: 'phone', label: '看手机', pose: 'idle', controls: { headPitch: -28, torsoPitch: -14, torsoYaw: 12, rightShoulderPitch: 38, rightShoulderRoll: 28, rightElbow: -112, rightWrist: -24, leftShoulderPitch: 18, leftElbow: -54 } },
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
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate')
  const [focusRequest, setFocusRequest] = useState(0)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    if (node?.type === 'director') setScene(copyScene(node.data.scene))
  }, [nodeId])

  const commit = useCallback((next: DirectorSceneData, history = true) => {
    setScene(next)
    setSaved(false)
    updateNodeData(nodeId, { scene: next }, { history })
  }, [nodeId, updateNodeData])

  const save = useCallback(() => {
    if (node?.type === 'director') updateNodeData(nodeId, { scene, lastCaptureAt: node.data.lastCaptureAt }, { history: true })
    setSaved(true)
    useCanvasStore.getState().setNotice('3D 导演台已保存到画布')
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

  const addActor = () => {
    const index = scene.actors.length + 1
    const next = copyScene(scene)
    next.actors.push({ id: `actor-${Date.now()}`, name: `角色 ${index}`, x: (index % 3 - 1) * 1.4, y: 0, z: (index % 2) * -0.45, color: index % 2 ? '#74b9ff' : '#ff9f8a', scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, pose: 'idle' })
    commit(next)
  }
  const addCamera = () => {
    const index = scene.cameras.length + 1
    const id = `camera-${Date.now()}`
    const next = copyScene(scene)
    next.cameras.push({ id, name: `机位 ${index}`, x: 0, y: 2.3, z: 6.5 + index, targetX: 0, targetY: 1, targetZ: 0, fov: 42, rotationX: 0, rotationY: 0, rotationZ: 0 })
    next.activeCameraId = id
    commit(next)
  }
  const setActor = (id: string, patch: Partial<DirectorActor>) => commit({ ...scene, actors: scene.actors.map(actor => actor.id === id ? { ...actor, ...patch } : actor) }, false)
  const setCamera = (id: string, patch: Partial<DirectorCamera>) => commit({ ...scene, cameras: scene.cameras.map(camera => camera.id === id ? { ...camera, ...patch } : camera) }, false)
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
  const selectedObject = selectedActor ? scene.actors.find((actor) => actor.id === selectedActor) : selectedCamera ? scene.cameras.find((camera) => camera.id === selectedCamera) : null
  const focusSelected = () => {
    if (!selectedObject) {
      useCanvasStore.getState().setNotice('请先选择一个角色或机位')
      return
    }
    setFocusRequest((value) => value + 1)
    useCanvasStore.getState().setNotice(`已将视图聚焦到${selectedObject.name}`)
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[100] flex flex-col bg-[#07090c] text-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0d1014] px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-100"><ScanLine className="size-4" /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{node.data.title}</h2><p className="text-[10px] tracking-[0.12em] text-neutral-500">3D 导演台 · 实时角色预演</p></div>
        <div className="hidden items-center rounded-lg border border-white/10 bg-black/20 p-0.5 text-[11px] sm:flex" role="group" aria-label="视角模式">
          <button type="button" className={cn('rounded-md px-3 py-1.5 transition-colors', viewMode === 'director' ? 'bg-white/15 text-white' : 'text-neutral-500 hover:text-neutral-200')} onClick={() => setViewMode('director')}><Move3d className="mr-1.5 inline size-3.5" />导演视角</button>
          <button type="button" className={cn('rounded-md px-3 py-1.5 transition-colors', viewMode === 'camera' ? 'bg-white/15 text-white' : 'text-neutral-500 hover:text-neutral-200')} onClick={() => setViewMode('camera')}><Camera className="mr-1.5 inline size-3.5" />机位视角</button>
        </div>
        <button type="button" className="hidden items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 hover:bg-white/10 sm:flex" onClick={capture}><Maximize2 className="size-3.5" />导出预览图</button>
        <button type="button" className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-950 hover:bg-white disabled:opacity-50" disabled={saved} onClick={save}><Check className="size-3.5" />{saved ? '已保存' : '保存到画布'}</button>
        <button type="button" aria-label="关闭导演台" className="flex size-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white" onClick={onClose}><X className="size-4" /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 flex max-h-[40vh] w-full shrink-0 flex-col overflow-y-auto border-t border-white/10 bg-[#0d1014] p-3 lg:order-1 lg:max-h-none lg:w-64 lg:border-t-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">场景对象</span><span className="text-[10px] text-neutral-500">{scene.actors.length} 角色 · {scene.cameras.length} 机位</span></div>
          <label className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 text-xs text-neutral-500"><Search className="size-3.5" /><input value={objectSearch} onChange={(event) => setObjectSearch(event.target.value)} placeholder="搜索资源" className="min-w-0 flex-1 bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-600" aria-label="搜索导演台资源" /></label>
          <div className="mb-2 flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">角色</span><button type="button" className="inline-flex items-center gap-1 text-[11px] text-cyan-200 hover:text-cyan-100" onClick={addActor}><Plus className="size-3" />添加</button></div>
          <div className="flex flex-col gap-1.5">{visibleActors.map(actor => <div key={actor.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', selectedActor === actor.id ? 'border-cyan-200/60 bg-cyan-200/10' : 'border-white/10 bg-white/[0.02]')}><button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-neutral-200" onClick={() => { setSelectedActor(actor.id); setSelectedCamera(null); setInspectorTab('properties') }}><UserRound className="mr-1.5 inline size-3.5 text-neutral-500" />{actor.name}</button><button type="button" className="text-neutral-600 hover:text-rose-200" aria-label={`删除${actor.name}`} onClick={() => removeActor(actor.id)}><Trash2 className="size-3.5" /></button></div>)}</div>
          <div className="my-4 h-px bg-white/10" />
          <div className="mb-2 flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">摄像机</span><button type="button" className="inline-flex items-center gap-1 text-[11px] text-cyan-200 hover:text-cyan-100" onClick={addCamera}><Plus className="size-3" />添加</button></div>
          <div className="flex flex-col gap-1.5">{visibleCameras.map(camera => <div key={camera.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', scene.activeCameraId === camera.id ? 'border-cyan-200/60 bg-cyan-200/10' : 'border-white/10 bg-white/[0.02]')}><button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-neutral-200" onClick={() => { setSelectedCamera(camera.id); setSelectedActor(null); setInspectorTab('properties'); commit({ ...scene, activeCameraId: camera.id }, false) }}><CameraIcon />{camera.name}</button><button type="button" className="text-neutral-600 hover:text-rose-200 disabled:opacity-30" disabled={scene.cameras.length <= 1} aria-label={`删除${camera.name}`} onClick={() => removeCamera(camera.id)}><Trash2 className="size-3.5" /></button></div>)}</div>
          {!visibleActors.length && !visibleCameras.length && <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-neutral-600">没有匹配的场景对象</p>}
        </aside>
        <section className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#0b0e12] px-3 py-2 text-xs"><span className="text-neutral-400">画幅</span>{(Object.keys(ASPECT_LABEL) as DirectorSceneData['aspect'][]).map(aspect => <button key={aspect} type="button" className={cn('rounded-md px-2.5 py-1.5', scene.aspect === aspect ? 'bg-white text-black' : 'text-neutral-400 hover:bg-white/10 hover:text-white')} onClick={() => commit({ ...scene, aspect })}>{ASPECT_LABEL[aspect]}</button>)}<label className="ml-auto flex cursor-pointer items-center gap-1.5 text-neutral-400"><input type="checkbox" checked={scene.grid} onChange={event => commit({ ...scene, grid: event.target.checked }, false)} /><Grid3X3 className="size-3.5" />网格</label></div>
          <div className="relative min-h-0 flex-1"><DirectorViewport scene={scene} viewMode={viewMode} focusTarget={selectedObject} focusRequest={focusRequest} selectedActorId={selectedActor} selectedCameraId={selectedCamera} transformMode={transformMode} onActorTransform={(id, patch) => setActor(id, patch)} onCameraTransform={(id, patch) => setCamera(id, patch)} /><div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[10px] text-neutral-400">拖动旋转 · 滚轮缩放 · 右键平移 · 选中对象可变换</div><div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-[#10151c]/90 p-1.5 shadow-2xl backdrop-blur"><button type="button" aria-label="选择工具" className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-white"><Crosshair className="size-4" /></button><button type="button" aria-label="移动工具" className={cn('flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white', transformMode === 'translate' && 'bg-cyan-200/15 text-cyan-100')} onClick={() => setTransformMode('translate')}><Move3d className="size-4" /></button><button type="button" aria-label="旋转工具" className={cn('flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white', transformMode === 'rotate' && 'bg-cyan-200/15 text-cyan-100')} onClick={() => setTransformMode('rotate')}><Rotate3d className="size-4" /></button><button type="button" aria-label="缩放工具" className={cn('flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white', transformMode === 'scale' && 'bg-cyan-200/15 text-cyan-100')} onClick={() => setTransformMode('scale')}><Maximize2 className="size-4" /></button><button type="button" aria-label="聚焦当前对象" className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white" onClick={focusSelected}><ScanLine className="size-4" /></button><button type="button" aria-label="切换网格" className={cn('flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white', scene.grid && 'bg-cyan-200/15 text-cyan-100')} onClick={() => commit({ ...scene, grid: !scene.grid }, false)}><Grid3X3 className="size-4" /></button><button type="button" aria-label="切换姿态面板" className="flex size-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white" onClick={() => setInspectorTab('pose')}><Rotate3d className="size-4" /></button></div></div>
        </section>
        <aside className="order-3 max-h-[42vh] w-full shrink-0 overflow-y-auto border-t border-white/10 bg-[#0d1014] p-3 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
          {selectedObject && <div className="mb-3 flex items-center gap-1 rounded-lg bg-black/20 p-1 text-[11px]" role="tablist" aria-label="对象属性"><button type="button" role="tab" aria-selected={inspectorTab === 'properties'} className={cn('flex-1 rounded-md px-2 py-1.5', inspectorTab === 'properties' ? 'bg-white/10 text-white' : 'text-neutral-500')} onClick={() => setInspectorTab('properties')}><SlidersHorizontal className="mr-1 inline size-3.5" />属性</button><button type="button" role="tab" aria-selected={inspectorTab === 'pose'} className={cn('flex-1 rounded-md px-2 py-1.5', inspectorTab === 'pose' ? 'bg-white/10 text-white' : 'text-neutral-500')} onClick={() => setInspectorTab('pose')}><Rotate3d className="mr-1 inline size-3.5" />姿态</button></div>}
          {selectedActor && scene.actors.find(actor => actor.id === selectedActor) ? <ActorInspector actor={scene.actors.find(actor => actor.id === selectedActor)!} tab={inspectorTab} onChange={patch => setActor(selectedActor, patch)} /> : selectedCamera && scene.cameras.find(camera => camera.id === selectedCamera) ? <CameraInspector camera={scene.cameras.find(camera => camera.id === selectedCamera)!} onChange={patch => setCamera(selectedCamera, patch)} /> : <div className="flex h-full min-h-24 flex-col items-center justify-center text-center text-xs text-neutral-500"><Clapperboard className="mb-2 size-5 text-neutral-600" /><p>选择角色或机位<br />编辑位置、姿态与镜头参数</p></div>}
          <label className="mt-4 block text-[11px] text-neutral-500">导演备注<textarea value={scene.notes} onChange={event => commit({ ...scene, notes: event.target.value }, false)} rows={3} placeholder="记录调度、镜头意图或对白提示" className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-neutral-200 outline-none focus:border-cyan-200/50" /></label>
        </aside>
      </div>
    </div>
  )
}

function CameraIcon() { return <Camera className="mr-1.5 inline size-3.5 text-cyan-100" aria-hidden="true" /> }

function ActorInspector({ actor, tab = 'properties', onChange }: { actor: DirectorActor; tab?: 'properties' | 'pose'; onChange: (patch: Partial<DirectorActor>) => void }) {
  const controls = { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...(actor.poseControls ?? {}) }
  const setPoseControls = (patch: Partial<DirectorPoseControls>) => onChange({ poseControls: { ...controls, ...patch } })
  const applyPreset = (preset: typeof POSE_PRESETS[number]) => onChange({ pose: preset.pose, poseControls: { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...preset.controls } })
  if (tab === 'pose') return <PoseInspector actor={actor} controls={controls} setPoseControls={setPoseControls} applyPreset={applyPreset} />
  return <Inspector title={actor.name} subtitle="角色"><Field label="名称"><input value={actor.name} onChange={event => onChange({ name: event.target.value })} /></Field>{tab === 'properties' ? <><Field label="模型"><select value={actor.modelUrl === 'builtin:whitebox' ? 'builtin:whitebox' : (actor.modelUrl || DEFAULT_MODEL_URL)} onChange={event => onChange({ modelUrl: event.target.value })}><option value={DEFAULT_MODEL_URL}>Quaternius 人形（CC0）</option><option value="builtin:whitebox">白盒预览</option></select></Field><Field label="颜色"><input type="color" value={actor.color} onChange={event => onChange({ color: event.target.value })} /></Field><Field label="位置"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={actor.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={actor.y} onChange={(value) => onChange({ y: value })} /><NumberField label="Z" value={actor.z} onChange={(value) => onChange({ z: value })} /></div></Field><Field label="旋转（度）"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={actor.rotationX} onChange={(value) => onChange({ rotationX: value })} /><NumberField label="Y" value={actor.rotationY} onChange={(value) => onChange({ rotationY: value })} /><NumberField label="Z" value={actor.rotationZ} onChange={(value) => onChange({ rotationZ: value })} /></div></Field><Field label="统一缩放"><input type="range" min="0.5" max="2" step="0.05" value={actor.scale} onChange={event => onChange({ scale: Number(event.target.value) })} /><span className="min-w-7 text-right text-[10px] text-neutral-500">{actor.scale.toFixed(2)}</span></Field></> : <><Field label="姿态"><select value={actor.pose} onChange={event => onChange({ pose: event.target.value as DirectorActor['pose'] })}><option value="idle">待机</option><option value="hero">英雄站姿</option><option value="walk">行走</option></select></Field><div className="grid grid-cols-3 gap-2"><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'idle' ? 'border-cyan-200/60 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-neutral-500')} onClick={() => onChange({ pose: 'idle' })}>待机</button><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'hero' ? 'border-cyan-200/60 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-neutral-500')} onClick={() => onChange({ pose: 'hero' })}>英雄</button><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'walk' ? 'border-cyan-200/60 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-neutral-500')} onClick={() => onChange({ pose: 'walk' })}>行走</button></div><p className="text-[11px] leading-5 text-neutral-500">姿态会同步影响角色的骨骼关节，方便预演动作与构图。</p></>}</Inspector>
}

function isPosePresetActive(actor: DirectorActor, controls: DirectorPoseControls, preset: typeof POSE_PRESETS[number]) {
  if (actor.pose !== preset.pose) return false
  const expected = { ...DEFAULT_DIRECTOR_POSE_CONTROLS, ...preset.controls }
  return (Object.keys(DEFAULT_DIRECTOR_POSE_CONTROLS) as (keyof DirectorPoseControls)[]).every(key => controls[key] === expected[key])
}

function PoseInspector({ actor, controls, setPoseControls, applyPreset }: { actor: DirectorActor; controls: DirectorPoseControls; setPoseControls: (patch: Partial<DirectorPoseControls>) => void; applyPreset: (preset: typeof POSE_PRESETS[number]) => void }) {
  const activePreset = POSE_PRESETS.find(preset => isPosePresetActive(actor, controls, preset))
  return <Inspector title={actor.name} subtitle="姿态">
    <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-[11px] text-neutral-400">姿势预设</span>{activePreset ? <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200/40 bg-cyan-200/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan-100"><Check className="size-2.5" />当前：{activePreset.label}</span> : <span className="rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-neutral-500">自定义姿态</span>}</div><button type="button" className="text-[10px] text-cyan-200 hover:text-cyan-100" onClick={() => setPoseControls(DEFAULT_DIRECTOR_POSE_CONTROLS)}>重置关节</button></div>
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="姿态预设">{POSE_PRESETS.map(preset => { const selected = isPosePresetActive(actor, controls, preset); return <button key={preset.id} type="button" aria-pressed={selected} aria-label={`${preset.label}姿态${selected ? '（当前）' : ''}`} className={cn('relative rounded-md border px-1.5 py-2 text-[10px] transition-colors', selected ? 'border-cyan-200 bg-cyan-200/20 font-medium text-cyan-50 shadow-[0_0_0_1px_rgba(165,243,252,0.35),0_0_12px_rgba(103,232,249,0.12)]' : 'border-white/10 text-neutral-400 hover:border-white/25 hover:bg-white/5 hover:text-white')} onClick={() => applyPreset(preset)}>{selected && <Check aria-hidden="true" className="absolute right-1 top-1 size-2.5 text-cyan-100" />}{preset.label}</button> })}</div>
    <p className="text-[10px] leading-5 text-neutral-600">先选姿势，再用下方滑杆微调关节；角度会保存到当前角色。</p>
    <div className="flex flex-col gap-4">{POSE_CONTROL_SECTIONS.map(section => <section key={section.title}><h4 className="mb-2 border-b border-white/10 pb-1.5 text-[10px] font-medium tracking-wide text-neutral-400">{section.title}</h4><div className="flex flex-col gap-2.5">{section.items.map(item => <PoseSlider key={item.key} label={item.label} value={controls[item.key]} onChange={value => setPoseControls({ [item.key]: value })} />)}</div></section>)}</div>
  </Inspector>
}

function PoseSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="block text-[10px] text-neutral-500"><span className="mb-1 flex items-center justify-between gap-2"><span>{label}</span><output className="rounded bg-black/25 px-1.5 py-0.5 tabular-nums text-[9px] text-neutral-400">{Math.round(value)}°</output></span><input aria-label={label} type="range" min="-240" max="240" step="1" value={value} onChange={event => onChange(Number(event.target.value))} className="h-1.5 w-full accent-cyan-200" /></label>
}

function CameraInspector({ camera, onChange }: { camera: DirectorCamera; onChange: (patch: Partial<DirectorCamera>) => void }) {
  return <Inspector title={camera.name} subtitle="机位"><Field label="名称"><input value={camera.name} onChange={event => onChange({ name: event.target.value })} /></Field><Field label="位置"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={camera.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={camera.y} onChange={(value) => onChange({ y: value })} /><NumberField label="Z" value={camera.z} onChange={(value) => onChange({ z: value })} /></div></Field><Field label="旋转（度）"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={camera.rotationX} onChange={(value) => onChange({ rotationX: value })} /><NumberField label="Y" value={camera.rotationY} onChange={(value) => onChange({ rotationY: value })} /><NumberField label="Z" value={camera.rotationZ} onChange={(value) => onChange({ rotationZ: value })} /></div></Field><Field label="焦距 / FOV"><input type="range" min="20" max="90" value={camera.fov} onChange={event => onChange({ fov: Number(event.target.value) })} /><span className="text-[10px] text-neutral-500">{camera.fov}°</span></Field><p className="text-[11px] leading-5 text-neutral-500">机位位置、旋转和焦距会实时影响镜头；切换到“机位视角”可预览当前镜头。</p></Inspector>
}

function Inspector({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <div><div className="mb-3 flex items-center justify-between gap-2"><h3 className="truncate text-xs font-semibold text-neutral-200">{title}</h3>{subtitle && <span className="text-[10px] text-neutral-500">{subtitle}</span>}</div><div className="flex flex-col gap-3">{children}</div></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-[11px] text-neutral-500"><span className="mb-1.5 block">{label}</span><span className="flex items-center gap-2">{children}</span></label> }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="block text-[10px] text-neutral-500"><span className="mb-1 block">{label}</span><input type="number" step="0.1" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value) || 0)} className="h-8 w-full rounded-md border border-white/10 bg-black/20 px-2 text-xs text-neutral-200 outline-none focus:border-cyan-200/60" /></label> }

function disposeObject(root: THREE.Object3D, options?: { skipGeometry?: boolean }) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (!options?.skipGeometry) child.geometry.dispose()
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

function DirectorViewport({ scene, viewMode, focusTarget, focusRequest, selectedActorId, selectedCameraId, transformMode, onActorTransform, onCameraTransform }: { scene: DirectorSceneData; viewMode: 'director' | 'camera'; focusTarget: DirectorActor | DirectorCamera | null | undefined; focusRequest: number; selectedActorId: string | null; selectedCameraId: string | null; transformMode: 'translate' | 'rotate' | 'scale'; onActorTransform: (id: string, patch: Partial<DirectorActor>) => void; onCameraTransform: (id: string, patch: Partial<DirectorCamera>) => void }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelCacheRef = useRef(new Map<string, Promise<THREE.Object3D | null>>())
  const transformRef = useRef<TransformControls | null>(null)
  const objectRefs = useRef(new Map<string, THREE.Object3D>())
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
    grid: scene.grid,
    actors: scene.actors.map(actor => ({ id: actor.id, modelUrl: actor.modelUrl || DEFAULT_MODEL_URL })),
    cameras: scene.cameras.map(camera => camera.id),
  })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true }) } catch { mount.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-neutral-500">当前浏览器不支持 WebGL 预览</div>'; return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0x080b0f, 1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; mount.append(renderer.domElement); renderer.domElement.dataset.directorViewport = 'true'; rendererRef.current = renderer
    const world = new THREE.Scene(); sceneRef.current = world
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100); camera.position.set(0, 2.8, 6.3); cameraRef.current = camera
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1.05, 0); controls.enableDamping = true; controls.minDistance = 2.2; controls.maxDistance = 16; controlsRef.current = controls
    const transform = new TransformControls(camera, renderer.domElement)
    transform.setMode('translate')
    transform.setSpace('world')
    transform.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as { value?: unknown }).value)
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
    const resize = () => { const width = mount.clientWidth || 1; const height = mount.clientHeight || 1; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix() }; resize(); const observer = new ResizeObserver(resize); observer.observe(mount)
    let frame = 0; const animate = () => { controls.update(); renderer.render(world, camera); frame = requestAnimationFrame(animate) }; animate()
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); transform.detach(); transform.dispose(); transformRef.current = null; controls.dispose(); controlsRef.current = null; renderer.dispose(); renderer.domElement.remove(); disposeObject(world)
      for (const promise of modelCacheRef.current.values()) void promise.then(model => { if (model) disposeObject(model) })
      modelCacheRef.current.clear()
    }
  }, [])

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
    if (scene.grid) { const grid = new THREE.GridHelper(14, 28, 0x2a5160, 0x1a2830); grid.position.y = 0.01; grid.userData.directorObject = true; world.add(grid) }

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
      const group = new THREE.Group(); group.userData.directorObject = true; group.userData.directorActorId = actor.id; group.userData.poseOffset = { x: 0, y: actor.pose === 'walk' ? .2 : 0, z: actor.pose === 'hero' ? -.08 : 0 }; group.position.set(actor.x, actor.y, actor.z); group.rotation.set(THREE.MathUtils.degToRad(actor.rotationX || 0) + group.userData.poseOffset.x, THREE.MathUtils.degToRad(actor.rotationY || 0) + group.userData.poseOffset.y, THREE.MathUtils.degToRad(actor.rotationZ || 0) + group.userData.poseOffset.z); group.scale.setScalar(actor.scale); objectRefs.current.set(`actor:${actor.id}`, group)
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
      // A model may load after the selection effect has already run.
      if (selectedActorId === actor.id && viewMode === 'director') transformRef.current?.attach(group)
    }
    scene.actors.forEach(actor => {
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
      const poseOffset = { x: 0, y: actor.pose === 'walk' ? .2 : 0, z: actor.pose === 'hero' ? -.08 : 0 }
      group.userData.poseOffset = poseOffset
      group.position.set(actor.x, actor.y, actor.z)
      group.rotation.set(
        THREE.MathUtils.degToRad(actor.rotationX || 0) + (poseOffset?.x ?? 0),
        THREE.MathUtils.degToRad(actor.rotationY || 0) + (poseOffset?.y ?? 0),
        THREE.MathUtils.degToRad(actor.rotationZ || 0) + (poseOffset?.z ?? 0),
      )
      group.scale.setScalar(actor.scale)
      const model = group.userData.directorModelInstance as THREE.Object3D | undefined
      if (model) {
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
    transform.setMode(transformMode === 'scale' && selectedCameraId ? 'translate' : transformMode)
    const selected = selectedActorId ? objectRefs.current.get(`actor:${selectedActorId}`) : selectedCameraId ? objectRefs.current.get(`camera:${selectedCameraId}`) : undefined
    if (selected && viewMode === 'director') transform.attach(selected)
    else transform.detach()
  }, [selectedActorId, selectedCameraId, transformMode, viewMode, scene])

  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera) return
    const active = scene.cameras.find((item) => item.id === scene.activeCameraId) ?? scene.cameras[0]
    if (viewMode === 'camera' && active) {
      camera.position.set(active.x, active.y, active.z); camera.fov = active.fov; controls?.target.set(active.targetX, active.targetY, active.targetZ); if (active.rotationX || active.rotationY || active.rotationZ) camera.rotation.set(THREE.MathUtils.degToRad(active.rotationX || 0), THREE.MathUtils.degToRad(active.rotationY || 0), THREE.MathUtils.degToRad(active.rotationZ || 0)); else camera.lookAt(active.targetX, active.targetY, active.targetZ); if (controls) { controls.enabled = false; controls.update() }
    } else {
      camera.position.set(0, 2.8, 6.3); camera.fov = 42; controls?.target.set(0, 1.05, 0); camera.lookAt(0, 1.05, 0); if (controls) { controls.enabled = true; controls.update() }
    }
    camera.updateProjectionMatrix()
  }, [scene.activeCameraId, scene.cameras, viewMode])
  useEffect(() => {
    const camera = cameraRef.current; const controls = controlsRef.current
    if (!camera || !controls || !focusTarget || focusRequest === 0) return
    if ('fov' in focusTarget) { camera.position.set(focusTarget.x, focusTarget.y, focusTarget.z); controls.target.set(focusTarget.targetX, focusTarget.targetY, focusTarget.targetZ) } else { camera.position.set(focusTarget.x + 3.5, Math.max(2.4, focusTarget.y + 2.1), focusTarget.z + 4.5); controls.target.set(focusTarget.x, focusTarget.y + 1, focusTarget.z) }
    camera.lookAt(controls.target); controls.update()
  }, [focusRequest, focusTarget])
  return <div ref={mountRef} data-director-viewport className="absolute inset-0 overflow-hidden" />
}
