import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Vector3, Mesh } from 'three'

function moduleUrl(path, dependencies = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  for (const [name, url] of Object.entries(dependencies)) code = code.replaceAll(`from "${name}"`, `from ${JSON.stringify(url)}`).replaceAll(`from '${name}'`, `from ${JSON.stringify(url)}`)
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const three = import.meta.resolve('three')
const catalog = moduleUrl('../components/free-canvas/director/catalog.ts')
const pose = moduleUrl('../components/free-canvas/director/pose.ts', { three })
const poses = moduleUrl('../components/free-canvas/director/poses.ts')
const figureUrl = moduleUrl('../components/free-canvas/director/figure.ts', {
  three, './pose': pose, './poses': poses,
  'three/examples/jsm/loaders/GLTFLoader.js': import.meta.resolve('three/examples/jsm/loaders/GLTFLoader.js'),
  'three/examples/jsm/utils/SkeletonUtils.js': import.meta.resolve('three/examples/jsm/utils/SkeletonUtils.js'),
})
const figure = await import(figureUrl)
const adapter = await import(moduleUrl('../components/free-canvas/director/figure-adapter.ts', { three, './figure': figureUrl, './poses': poses }))
const timeline = await import(moduleUrl('../components/free-canvas/director/timeline.ts'))
const { POSE_LABELS } = await import(catalog)
const types = moduleUrl('../components/free-canvas/types.ts')
const factoryUrl = moduleUrl('../components/free-canvas/node-factory.ts', { 'lucide-react': import.meta.resolve('lucide-react') })
const factory = await import(factoryUrl)
const codec = await import(moduleUrl('../components/free-canvas/board-codec.ts', { './types': types, './node-factory': factoryUrl, './director/catalog': catalog }))
const bytes = async model => {
  const buffer = readFileSync(new URL(`../public/assets/director/${model}.glb`, import.meta.url))
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}
const bone = (root, name) => { root.updateMatrixWorld(true); return root.getObjectByName(name).getWorldPosition(new Vector3()) }

test('both bundled human models share the pose rig, keep their intended height, and all 12 poses touch the ground', async () => {
  for (const model of ['male', 'female']) {
    assert.equal(await figure.loadFigureModel(bytes, model), true)
    for (const pose of Object.keys(POSE_LABELS)) {
      const { group } = figure.createFigure({ model, pose, color: '#93c5fd' })
      const box = figure.measureFigure(group)
      assert.ok(Math.abs(box.min.y) < .001, `${model}/${pose}: ground ${box.min.y}`)
      assert.ok(box.max.y > .2, `${model}/${pose}: visible body`)
      if (pose === 'stand') assert.ok(Math.abs(box.max.y - figure.FIGURE_HEIGHT[model]) < .08)
      assert.ok(group.getObjectByName('index_01_r'), 'finger joints are included')
      if (pose === 'stand') assert.ok(bone(group, 'hand_l').y < bone(group, 'upperarm_l').y - .3)
      if (pose === 'point') assert.ok(bone(group, 'hand_r').z < bone(group, 'upperarm_r').z - .3)
      if (pose === 'lying') assert.ok(box.getSize(new Vector3()).y < .65)
      adapter.disposeActorFigure(group)
    }
  }
})

test('changing pose repeatedly resets from bind pose, does not accumulate rotations or affect another actor', () => {
  const actor = { ...factory.DEFAULT_DIRECTOR_SCENE.actors[0], figureModel: 'male', posePreset: 'stand' }
  const a = adapter.createActorFigure(actor), b = adapter.createActorFigure(actor)
  const initial = bone(a, 'hand_r').clone(), other = bone(b, 'hand_r').clone()
  for (let i = 0; i < 3; i++) {
    adapter.updateActorFigure(a, { ...actor, posePreset: 'raiseHand', color: '#ff0000' })
    assert.ok(bone(a, 'hand_r').y > initial.y + .5)
    adapter.updateActorFigure(a, actor)
    assert.ok(bone(a, 'hand_r').distanceTo(initial) < .00001)
  }
  assert.ok(bone(b, 'hand_r').distanceTo(other) < .00001)
  adapter.disposeActorFigure(a)
  adapter.disposeActorFigure(b)
})

test('disposing a figure releases instance materials without disposing the shared mesh geometry', () => {
  const { group } = figure.createFigure({ model: 'female', pose: 'wave', color: '#c0c0c0' })
  let disposedGeometry = 0, disposedMaterial = 0
  group.traverse(node => {
    if (!(node instanceof Mesh)) return
    node.geometry.addEventListener('dispose', () => disposedGeometry++)
    node.material.addEventListener('dispose', () => disposedMaterial++)
  })
  adapter.disposeActorFigure(group)
  assert.equal(disposedGeometry, 0)
  assert.ok(disposedMaterial > 0)
  const next = figure.createFigure({ model: 'female', pose: 'stand', color: '#c0c0c0' }).group
  assert.ok(figure.measureFigure(next).max.y > 1.5)
  adapter.disposeActorFigure(next)
})

test('timeline interpolates shortest rotation, replaces a same-time key, and sampling never changes the saved scene', () => {
  let actor = { ...factory.DEFAULT_DIRECTOR_SCENE.actors[0], rotationY: 170 }
  actor = timeline.recordActorKey(actor, 0)
  actor = timeline.recordActorKey(actor, 5, { x: 4, rotationY: -170 })
  const before = JSON.stringify(actor)
  const mid = timeline.sampleActor(actor, 2.5)
  assert.ok(Math.abs(mid.rotationY - 180) < .001)
  assert.ok(Math.abs(mid.x - (actor.x + 4) / 2) < .001)
  assert.equal(JSON.stringify(actor), before)
  actor = timeline.recordActorKey(actor, 5, { x: 8 })
  assert.equal(actor.keys.length, 2)
  assert.equal(timeline.sampleActor(actor, 5).x, 8)
})

test('camera presets create real keyframes, follow tracks actor positions, and shorter duration preserves its endpoint', () => {
  let scene = structuredClone(factory.DEFAULT_DIRECTOR_SCENE)
  scene.duration = 5
  scene.actors[0] = timeline.recordActorKey(timeline.recordActorKey(scene.actors[0], 0), 5, { x: 3 })
  for (const motion of Object.keys(timeline.CAMERA_MOTIONS)) {
    const applied = timeline.applyCameraMotion(scene, scene.activeCameraId, motion, scene.actors[0].id)
    assert.equal(applied.cameras[0].keys.length, motion === 'fixed' ? 0 : 11)
    for (const key of applied.cameras[0].keys) assert.ok(Object.values(key).filter(value => typeof value === 'number').every(Number.isFinite))
  }
  const follow = timeline.applyCameraMotion(scene, scene.activeCameraId, 'follow', scene.actors[0].id)
  const initial = timeline.sampleCamera(follow.cameras[0], 0), final = timeline.sampleCamera(follow.cameras[0], 5)
  assert.ok(Math.abs(final.x - initial.x - (3 - scene.actors[0].x)) < .001)
  const shortened = timeline.resizeDirectorDuration(follow, 2.5)
  assert.equal(shortened.duration, 2.5)
  assert.ok(shortened.actors[0].keys.every(key => key.t <= 2.5))
  assert.ok(Math.abs(timeline.sampleActor(shortened.actors[0], 2.5).x - timeline.sampleActor(follow.actors[0], 2.5).x) < .001)
})

test('canvas save and reload preserve models, poses, fine joints and timeline without reviving deleted actors', () => {
  const node = factory.createDirectorNode({ x: 0, y: 0 }, 'test-director')
  node.data.scene.duration = 7
  node.data.scene.actors[0] = timeline.recordActorKey({ ...node.data.scene.actors[0], figureModel: 'female', posePreset: 'point' }, 1)
  const board = codec.writeBoard([node], [])
  const restored = codec.readBoard({ ...board, id: 'test', title: 'Test' }).nodes[0]
  assert.equal(restored.data.scene.actors[0].figureModel, 'female')
  assert.equal(restored.data.scene.actors[0].posePreset, 'point')
  assert.equal(restored.data.scene.actors[0].keys[0].t, 1)
  const empty = factory.createDirectorNode({ x: 0, y: 0 })
  empty.data.scene.actors = []
  assert.equal(codec.readBoard(codec.writeBoard([empty], [])).nodes[0].data.scene.actors.length, 0)
  const legacy = factory.createDirectorNode({ x: 0, y: 0 })
  delete legacy.data.scene.actors[0].figureModel; delete legacy.data.scene.actors[0].posePreset
  legacy.data.scene.actors[0].modelUrl = '/assets/director/quaternius-superhero.glb'
  const reloaded = codec.readBoard(codec.writeBoard([legacy], [])).nodes[0]
  assert.equal(reloaded.data.scene.actors[0].figureModel, undefined)
  assert.equal(reloaded.data.scene.actors[0].modelUrl, '/assets/director/quaternius-superhero.glb')
})
