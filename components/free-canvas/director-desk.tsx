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
import type { DirectorActor, DirectorCamera, DirectorSceneData } from './types'

type Props = { nodeId: string; onClose: () => void }

const ASPECT_LABEL: Record<DirectorSceneData['aspect'], string> = { '16:9': '横屏 16:9', '9:16': '竖屏 9:16', '1:1': '方形 1:1' }
const DEFAULT_MODEL_URL = '/assets/director/quaternius-superhero.glb'

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
        <aside className="order-3 w-full shrink-0 border-t border-white/10 bg-[#0d1014] p-3 lg:w-72 lg:border-l lg:border-t-0">
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
  return <Inspector title={actor.name} subtitle="角色"><Field label="名称"><input value={actor.name} onChange={event => onChange({ name: event.target.value })} /></Field>{tab === 'properties' ? <><Field label="模型"><select value={actor.modelUrl === 'builtin:whitebox' ? 'builtin:whitebox' : (actor.modelUrl || DEFAULT_MODEL_URL)} onChange={event => onChange({ modelUrl: event.target.value })}><option value={DEFAULT_MODEL_URL}>Quaternius 人形（CC0）</option><option value="builtin:whitebox">白盒预览</option></select></Field><Field label="颜色"><input type="color" value={actor.color} onChange={event => onChange({ color: event.target.value })} /></Field><Field label="位置"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={actor.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={actor.y} onChange={(value) => onChange({ y: value })} /><NumberField label="Z" value={actor.z} onChange={(value) => onChange({ z: value })} /></div></Field><Field label="旋转（度）"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={actor.rotationX} onChange={(value) => onChange({ rotationX: value })} /><NumberField label="Y" value={actor.rotationY} onChange={(value) => onChange({ rotationY: value })} /><NumberField label="Z" value={actor.rotationZ} onChange={(value) => onChange({ rotationZ: value })} /></div></Field><Field label="统一缩放"><input type="range" min="0.5" max="2" step="0.05" value={actor.scale} onChange={event => onChange({ scale: Number(event.target.value) })} /><span className="min-w-7 text-right text-[10px] text-neutral-500">{actor.scale.toFixed(2)}</span></Field></> : <><Field label="姿态"><select value={actor.pose} onChange={event => onChange({ pose: event.target.value as DirectorActor['pose'] })}><option value="idle">待机</option><option value="hero">英雄站姿</option><option value="walk">行走</option></select></Field><div className="grid grid-cols-3 gap-2"><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'idle' ? 'border-cyan-200/60 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-neutral-500')} onClick={() => onChange({ pose: 'idle' })}>待机</button><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'hero' ? 'border-cyan-200/60 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-neutral-500')} onClick={() => onChange({ pose: 'hero' })}>英雄</button><button type="button" className={cn('rounded-md border px-2 py-2 text-[11px]', actor.pose === 'walk' ? 'border-cyan-200/60 bg-cyan-200/10 text-cyan-100' : 'border-white/10 text-neutral-500')} onClick={() => onChange({ pose: 'walk' })}>行走</button></div><p className="text-[11px] leading-5 text-neutral-500">姿态会同步影响角色的骨骼关节，方便预演动作与构图。</p></>}</Inspector>
}

function CameraInspector({ camera, onChange }: { camera: DirectorCamera; onChange: (patch: Partial<DirectorCamera>) => void }) {
  return <Inspector title={camera.name} subtitle="机位"><Field label="名称"><input value={camera.name} onChange={event => onChange({ name: event.target.value })} /></Field><Field label="位置"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={camera.x} onChange={(value) => onChange({ x: value })} /><NumberField label="Y" value={camera.y} onChange={(value) => onChange({ y: value })} /><NumberField label="Z" value={camera.z} onChange={(value) => onChange({ z: value })} /></div></Field><Field label="旋转（度）"><div className="grid grid-cols-3 gap-2"><NumberField label="X" value={camera.rotationX} onChange={(value) => onChange({ rotationX: value })} /><NumberField label="Y" value={camera.rotationY} onChange={(value) => onChange({ rotationY: value })} /><NumberField label="Z" value={camera.rotationZ} onChange={(value) => onChange({ rotationZ: value })} /></div></Field><Field label="焦距 / FOV"><input type="range" min="20" max="90" value={camera.fov} onChange={event => onChange({ fov: Number(event.target.value) })} /><span className="text-[10px] text-neutral-500">{camera.fov}°</span></Field><p className="text-[11px] leading-5 text-neutral-500">机位位置、旋转和焦距会实时影响镜头；切换到“机位视角”可预览当前镜头。</p></Inspector>
}

function Inspector({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <div><div className="mb-3 flex items-center justify-between gap-2"><h3 className="truncate text-xs font-semibold text-neutral-200">{title}</h3>{subtitle && <span className="text-[10px] text-neutral-500">{subtitle}</span>}</div><div className="flex flex-col gap-3">{children}</div></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-[11px] text-neutral-500"><span className="mb-1.5 block">{label}</span><span className="flex items-center gap-2">{children}</span></label> }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="block text-[10px] text-neutral-500"><span className="mb-1 block">{label}</span><input type="number" step="0.1" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value) || 0)} className="h-8 w-full rounded-md border border-white/10 bg-black/20 px-2 text-xs text-neutral-200 outline-none focus:border-cyan-200/60" /></label> }

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach(material => material.dispose())
  })
}

function tintModel(root: THREE.Object3D, color: string) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    child.material = materials.map(material => {
      const next = material.clone()
      if ('color' in next && next.color instanceof THREE.Color) next.color.set(color)
      return next
    }) as THREE.Mesh['material']
  })
}

function setBoneRotation(root: THREE.Object3D, name: string, axis: 'x' | 'y' | 'z', value: number) {
  const bone = root.getObjectByName(name)
  if (!bone) return
  bone.rotation[axis] += value
}

function applyActorPose(root: THREE.Object3D, pose: DirectorActor['pose']) {
  // The bundled Quaternius model has a humanoid skeleton but no animation clips.
  // These restrained procedural offsets keep the director desk useful without
  // pulling in a separate animation pack or a non-redistributable runtime.
  if (pose === 'hero') {
    setBoneRotation(root, 'upperarm_l', 'z', -0.16)
    setBoneRotation(root, 'upperarm_r', 'z', 0.16)
    setBoneRotation(root, 'thigh_l', 'z', -0.05)
    setBoneRotation(root, 'thigh_r', 'z', 0.05)
  } else if (pose === 'walk') {
    setBoneRotation(root, 'upperarm_l', 'z', 0.28)
    setBoneRotation(root, 'upperarm_r', 'z', -0.28)
    setBoneRotation(root, 'thigh_l', 'z', 0.24)
    setBoneRotation(root, 'thigh_r', 'z', -0.24)
    setBoneRotation(root, 'calf_l', 'z', -0.08)
    setBoneRotation(root, 'calf_r', 'z', 0.08)
  }
}

function addWhiteBoxActor(group: THREE.Group, actor: DirectorActor) {
  const material = new THREE.MeshStandardMaterial({ color: actor.color, roughness: .72 })
  const add = (geometry: THREE.BufferGeometry, position: [number, number, number], rotation?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    if (rotation) mesh.rotation.set(...rotation)
    group.add(mesh)
  }
  add(new THREE.CapsuleGeometry(.3, .86, 6, 12), [0, 1.2, 0])
  add(new THREE.SphereGeometry(.31, 14, 10), [0, .78, 0])
  add(new THREE.SphereGeometry(.28, 16, 12), [0, 2.1, 0])
  add(new THREE.CylinderGeometry(.12, .14, .16, 10), [0, 1.84, 0])
  const armAngle = actor.pose === 'hero' ? .18 : actor.pose === 'walk' ? .24 : .06
  add(new THREE.CapsuleGeometry(.095, .62, 5, 8), [-.42, 1.25, 0], [0, 0, -armAngle])
  add(new THREE.CapsuleGeometry(.095, .62, 5, 8), [.42, 1.25, 0], [0, 0, armAngle])
  add(new THREE.SphereGeometry(.12, 10, 8), [-.49, .88, 0])
  add(new THREE.SphereGeometry(.12, 10, 8), [.49, .88, 0])
  const legAngle = actor.pose === 'walk' ? .2 : actor.pose === 'hero' ? .06 : 0
  add(new THREE.CapsuleGeometry(.12, .62, 5, 8), [-.16, .43, 0], [0, 0, -legAngle])
  add(new THREE.CapsuleGeometry(.12, .62, 5, 8), [.16, .43, 0], [0, 0, legAngle])
  add(new THREE.CapsuleGeometry(.12, .25, 5, 8), [-.16, .08, -.08], [0, Math.PI / 2, 0])
  add(new THREE.CapsuleGeometry(.12, .25, 5, 8), [.16, .08, -.08], [0, Math.PI / 2, 0])
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
  const actorTransformRef = useRef(onActorTransform)
  const cameraTransformRef = useRef(onCameraTransform)
  actorTransformRef.current = onActorTransform
  cameraTransformRef.current = onCameraTransform

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true }) } catch { mount.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-neutral-500">当前浏览器不支持 WebGL 预览</div>'; return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0x080b0f, 1); mount.append(renderer.domElement); renderer.domElement.dataset.directorViewport = 'true'; rendererRef.current = renderer
    const world = new THREE.Scene(); sceneRef.current = world
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100); camera.position.set(0, 3.2, 8); cameraRef.current = camera
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 18; controlsRef.current = controls
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
    world.add(new THREE.HemisphereLight(0xd7edff, 0x1b2030, 1.8)); const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 7, 4); world.add(key)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ color: 0x101722, roughness: 0.9, metalness: 0.05 })); floor.rotation.x = -Math.PI / 2; world.add(floor)
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
    for (const object of [...world.children]) if (object.userData.directorObject) { world.remove(object); disposeObject(object) }
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
    const appendActor = (actor: DirectorActor, model: THREE.Object3D | null) => {
      if (!active) return
      const group = new THREE.Group(); group.userData.directorObject = true; group.userData.directorActorId = actor.id; group.userData.poseOffset = { x: 0, y: actor.pose === 'walk' ? .2 : 0, z: actor.pose === 'hero' ? -.08 : 0 }; group.position.set(actor.x, actor.y, actor.z); group.rotation.set(THREE.MathUtils.degToRad(actor.rotationX || 0) + group.userData.poseOffset.x, THREE.MathUtils.degToRad(actor.rotationY || 0) + group.userData.poseOffset.y, THREE.MathUtils.degToRad(actor.rotationZ || 0) + group.userData.poseOffset.z); group.scale.setScalar(actor.scale); objectRefs.current.set(`actor:${actor.id}`, group)
      if (model) {
        try {
          const instance = cloneSkinnedModel(model)
          tintModel(instance, actor.color)
          instance.scale.setScalar(1.05)
          applyActorPose(instance, actor.pose)
          instance.userData.directorObject = true
          group.add(instance)
        } catch {
          // A malformed or incompatible GLB must never remove the actor from
          // the scene. Keep the procedural mannequin visible as a safe fallback.
          addWhiteBoxActor(group, actor)
        }
      } else addWhiteBoxActor(group, actor)
      world.add(group)
      // A model may load after the selection effect has already run.
      if (selectedActorId === actor.id && viewMode === 'director') transformRef.current?.attach(group)
    }
    scene.actors.forEach(actor => {
      const requested = actor.modelUrl === 'builtin:whitebox' ? '' : (actor.modelUrl || DEFAULT_MODEL_URL)
      if (!requested) { appendActor(actor, null); return }
      void loadModel(requested).then(model => appendActor(actor, model))
    })
    scene.cameras.forEach(camera => { const marker = new THREE.Mesh(new THREE.BoxGeometry(.32, .18, .55), new THREE.MeshStandardMaterial({ color: camera.id === scene.activeCameraId ? 0x67e8f9 : 0x738091 })); marker.userData.directorObject = true; marker.userData.directorCameraId = camera.id; marker.position.set(camera.x, camera.y, camera.z); if (camera.rotationX || camera.rotationY || camera.rotationZ) marker.rotation.set(THREE.MathUtils.degToRad(camera.rotationX || 0), THREE.MathUtils.degToRad(camera.rotationY || 0), THREE.MathUtils.degToRad(camera.rotationZ || 0)); else marker.lookAt(camera.targetX, camera.targetY, camera.targetZ); objectRefs.current.set(`camera:${camera.id}`, marker); world.add(marker) })
    return () => { active = false }
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
      camera.position.set(0, 3.2, 8); camera.fov = 42; controls?.target.set(0, 1, 0); camera.lookAt(0, 1, 0); if (controls) { controls.enabled = true; controls.update() }
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
