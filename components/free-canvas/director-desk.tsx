'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Camera, Check, Clapperboard, Grid3X3, Maximize2, Plus, ScanLine, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCanvasStore } from './canvas-store'
import { DEFAULT_DIRECTOR_SCENE } from './node-factory'
import type { DirectorActor, DirectorCamera, DirectorSceneData } from './types'

type Props = { nodeId: string; onClose: () => void }

const ASPECT_LABEL: Record<DirectorSceneData['aspect'], string> = { '16:9': '横屏 16:9', '9:16': '竖屏 9:16', '1:1': '方形 1:1' }

function copyScene(scene: DirectorSceneData): DirectorSceneData {
  return JSON.parse(JSON.stringify(scene)) as DirectorSceneData
}

export function DirectorDesk({ nodeId, onClose }: Props) {
  const node = useCanvasStore((store) => store.nodes.find(item => item.id === nodeId && item.type === 'director'))
  const updateNodeData = useCanvasStore((store) => store.updateNodeData)
  const [scene, setScene] = useState<DirectorSceneData>(() => node?.type === 'director' ? copyScene(node.data.scene) : copyScene(DEFAULT_DIRECTOR_SCENE))
  const [selectedActor, setSelectedActor] = useState<string | null>(null)
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
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
    next.actors.push({ id: `actor-${Date.now()}`, name: `角色 ${index}`, x: (index % 3 - 1) * 1.4, y: 0, z: (index % 2) * -0.45, color: index % 2 ? '#74b9ff' : '#ff9f8a', scale: 1, pose: 'idle' })
    commit(next)
  }
  const addCamera = () => {
    const index = scene.cameras.length + 1
    const id = `camera-${Date.now()}`
    const next = copyScene(scene)
    next.cameras.push({ id, name: `机位 ${index}`, x: 0, y: 2.3, z: 6.5 + index, targetX: 0, targetY: 1, targetZ: 0, fov: 42 })
    next.activeCameraId = id
    commit(next)
  }
  const setActor = (id: string, patch: Partial<DirectorActor>) => commit({ ...scene, actors: scene.actors.map(actor => actor.id === id ? { ...actor, ...patch } : actor) }, false)
  const setCamera = (id: string, patch: Partial<DirectorCamera>) => commit({ ...scene, cameras: scene.cameras.map(camera => camera.id === id ? { ...camera, ...patch } : camera) }, false)
  const removeActor = (id: string) => commit({ ...scene, actors: scene.actors.filter(actor => actor.id !== id) })
  const removeCamera = (id: string) => {
    if (scene.cameras.length <= 1) return
    const cameras = scene.cameras.filter(camera => camera.id !== id)
    commit({ ...scene, cameras, activeCameraId: scene.activeCameraId === id ? cameras[0].id : scene.activeCameraId })
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[100] flex flex-col bg-[#07090c] text-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0d1014] px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-100"><ScanLine className="size-4" /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{node.data.title}</h2><p className="text-[10px] tracking-[0.12em] text-neutral-500">3D 导演台 · 白盒预演</p></div>
        <button type="button" className="hidden items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 hover:bg-white/10 sm:flex" onClick={capture}><Maximize2 className="size-3.5" />导出预览图</button>
        <button type="button" className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-950 hover:bg-white disabled:opacity-50" disabled={saved} onClick={save}><Check className="size-3.5" />{saved ? '已保存' : '保存到画布'}</button>
        <button type="button" aria-label="关闭导演台" className="flex size-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white" onClick={onClose}><X className="size-4" /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 flex max-h-[40vh] w-full shrink-0 flex-col overflow-y-auto border-t border-white/10 bg-[#0d1014] p-3 lg:order-1 lg:max-h-none lg:w-64 lg:border-t-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">场景对象</span><span className="text-[10px] text-neutral-500">{scene.actors.length} 角色 · {scene.cameras.length} 机位</span></div>
          <button type="button" className="mb-2 flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 text-xs text-neutral-300 hover:border-cyan-200/50 hover:bg-cyan-200/5" onClick={addActor}><Plus className="size-3.5" />添加角色</button>
          <div className="flex flex-col gap-1.5">{scene.actors.map(actor => <div key={actor.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', selectedActor === actor.id ? 'border-cyan-200/60 bg-cyan-200/10' : 'border-white/10 bg-white/[0.02]')}><button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-neutral-200" onClick={() => { setSelectedActor(actor.id); setSelectedCamera(null) }}>{actor.name}</button><button type="button" className="text-neutral-600 hover:text-rose-200" aria-label={`删除${actor.name}`} onClick={() => removeActor(actor.id)}><Trash2 className="size-3.5" /></button></div>)}</div>
          <div className="my-4 h-px bg-white/10" />
          <button type="button" className="mb-2 flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 text-xs text-neutral-300 hover:border-cyan-200/50 hover:bg-cyan-200/5" onClick={addCamera}><Plus className="size-3.5" />添加机位</button>
          <div className="flex flex-col gap-1.5">{scene.cameras.map(camera => <div key={camera.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', scene.activeCameraId === camera.id ? 'border-cyan-200/60 bg-cyan-200/10' : 'border-white/10 bg-white/[0.02]')}><button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-neutral-200" onClick={() => { setSelectedCamera(camera.id); setSelectedActor(null); commit({ ...scene, activeCameraId: camera.id }, false) }}><CameraIcon />{camera.name}</button><button type="button" className="text-neutral-600 hover:text-rose-200 disabled:opacity-30" disabled={scene.cameras.length <= 1} aria-label={`删除${camera.name}`} onClick={() => removeCamera(camera.id)}><Trash2 className="size-3.5" /></button></div>)}</div>
        </aside>
        <section className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#0b0e12] px-3 py-2 text-xs"><span className="text-neutral-400">画幅</span>{(Object.keys(ASPECT_LABEL) as DirectorSceneData['aspect'][]).map(aspect => <button key={aspect} type="button" className={cn('rounded-md px-2.5 py-1.5', scene.aspect === aspect ? 'bg-white text-black' : 'text-neutral-400 hover:bg-white/10 hover:text-white')} onClick={() => commit({ ...scene, aspect })}>{ASPECT_LABEL[aspect]}</button>)}<label className="ml-auto flex cursor-pointer items-center gap-1.5 text-neutral-400"><input type="checkbox" checked={scene.grid} onChange={event => commit({ ...scene, grid: event.target.checked }, false)} /><Grid3X3 className="size-3.5" />网格</label></div>
          <div className="relative min-h-0 flex-1"><DirectorViewport scene={scene} /><div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[10px] text-neutral-400">拖动旋转 · 滚轮缩放 · 右键平移</div></div>
        </section>
        <aside className="order-3 w-full shrink-0 border-t border-white/10 bg-[#0d1014] p-3 lg:w-64 lg:border-l lg:border-t-0">
          {selectedActor ? <ActorInspector actor={scene.actors.find(actor => actor.id === selectedActor)!} onChange={patch => setActor(selectedActor, patch)} /> : selectedCamera ? <CameraInspector camera={scene.cameras.find(camera => camera.id === selectedCamera)!} onChange={patch => setCamera(selectedCamera, patch)} /> : <div className="flex h-full min-h-24 flex-col items-center justify-center text-center text-xs text-neutral-500"><Clapperboard className="mb-2 size-5 text-neutral-600" /><p>选择角色或机位<br />编辑位置、姿态与镜头参数</p></div>}
          <label className="mt-4 block text-[11px] text-neutral-500">导演备注<textarea value={scene.notes} onChange={event => commit({ ...scene, notes: event.target.value }, false)} rows={3} placeholder="记录调度、镜头意图或对白提示" className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-neutral-200 outline-none focus:border-cyan-200/50" /></label>
        </aside>
      </div>
    </div>
  )
}

function CameraIcon() { return <Camera className="mr-1.5 inline size-3.5 text-cyan-100" aria-hidden="true" /> }

function ActorInspector({ actor, onChange }: { actor: DirectorActor; onChange: (patch: Partial<DirectorActor>) => void }) {
  return <Inspector title={actor.name}><Field label="名称"><input value={actor.name} onChange={event => onChange({ name: event.target.value })} /></Field><Field label="颜色"><input type="color" value={actor.color} onChange={event => onChange({ color: event.target.value })} /></Field><Field label="姿态"><select value={actor.pose} onChange={event => onChange({ pose: event.target.value as DirectorActor['pose'] })}><option value="idle">待机</option><option value="hero">英雄站姿</option><option value="walk">行走</option></select></Field><Field label="缩放"><input type="range" min="0.5" max="2" step="0.05" value={actor.scale} onChange={event => onChange({ scale: Number(event.target.value) })} /></Field></Inspector>
}

function CameraInspector({ camera, onChange }: { camera: DirectorCamera; onChange: (patch: Partial<DirectorCamera>) => void }) {
  return <Inspector title={camera.name}><Field label="名称"><input value={camera.name} onChange={event => onChange({ name: event.target.value })} /></Field><Field label="焦距 / FOV"><input type="range" min="20" max="90" value={camera.fov} onChange={event => onChange({ fov: Number(event.target.value) })} /><span className="text-[10px] text-neutral-500">{camera.fov}°</span></Field><p className="text-[11px] leading-5 text-neutral-500">当前版本使用白盒角色与基础机位预演，后续可接入自有或已授权的 GLB 模型。</p></Inspector>
}

function Inspector({ title, children }: { title: string; children: React.ReactNode }) { return <div><h3 className="mb-3 text-xs font-semibold text-neutral-200">{title}</h3><div className="flex flex-col gap-3">{children}</div></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-[11px] text-neutral-500"><span className="mb-1.5 block">{label}</span><span className="flex items-center gap-2">{children}</span></label> }

function DirectorViewport({ scene }: { scene: DirectorSceneData }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true }) } catch { mount.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-neutral-500">当前浏览器不支持 WebGL 预览</div>'; return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0x080b0f, 1); mount.append(renderer.domElement); renderer.domElement.dataset.directorViewport = 'true'; rendererRef.current = renderer
    const world = new THREE.Scene(); sceneRef.current = world
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100); camera.position.set(0, 3.2, 8); cameraRef.current = camera
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 18
    world.add(new THREE.HemisphereLight(0xd7edff, 0x1b2030, 1.8)); const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 7, 4); world.add(key)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ color: 0x101722, roughness: 0.9, metalness: 0.05 })); floor.rotation.x = -Math.PI / 2; world.add(floor)
    const resize = () => { const width = mount.clientWidth || 1; const height = mount.clientHeight || 1; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix() }; resize(); const observer = new ResizeObserver(resize); observer.observe(mount)
    let frame = 0; const animate = () => { controls.update(); renderer.render(world, camera); frame = requestAnimationFrame(animate) }; animate()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); world.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (Array.isArray(object.material)) object.material.forEach(material => material.dispose()); else object.material.dispose() } }) }
  }, [])
  useEffect(() => {
    const world = sceneRef.current; if (!world) return
    for (const object of [...world.children]) if (object.userData.directorObject) world.remove(object)
    if (scene.grid) { const grid = new THREE.GridHelper(14, 28, 0x2a5160, 0x1a2830); grid.position.y = 0.01; grid.userData.directorObject = true; world.add(grid) }
    scene.actors.forEach(actor => { const group = new THREE.Group(); group.userData.directorObject = true; group.position.set(actor.x, 0, actor.z); group.scale.setScalar(actor.scale); const material = new THREE.MeshStandardMaterial({ color: actor.color, roughness: .72 }); const body = new THREE.Mesh(new THREE.CapsuleGeometry(.34, 1.05, 6, 12), material); body.position.y = .9; group.add(body); const head = new THREE.Mesh(new THREE.SphereGeometry(.28, 16, 12), material); head.position.y = 1.75; group.add(head); if (actor.pose === 'hero') group.rotation.z = -.08; if (actor.pose === 'walk') group.rotation.y = .2; world.add(group) })
    scene.cameras.forEach(camera => { const marker = new THREE.Mesh(new THREE.BoxGeometry(.32, .18, .55), new THREE.MeshStandardMaterial({ color: camera.id === scene.activeCameraId ? 0x67e8f9 : 0x738091 })); marker.userData.directorObject = true; marker.position.set(camera.x, camera.y, camera.z); marker.lookAt(camera.targetX, camera.targetY, camera.targetZ); world.add(marker) })
  }, [scene])
  return <div ref={mountRef} data-director-viewport className="absolute inset-0 overflow-hidden" />
}
