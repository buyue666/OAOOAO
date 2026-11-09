import { AmbientLight, DirectionalLight, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { FIGURE_MODELS, createFigure, loadFigureModel, measureFigure } from './figure'
import { disposeActorFigure } from './figure-adapter'
import { POSE_LABELS, type FigureModel, type PoseId } from './catalog'

const pending = new Map<FigureModel, Promise<Partial<Record<PoseId, string>>>>()

export function figureThumbnails(model: FigureModel) {
  let promise = pending.get(model)
  if (promise) return promise
  promise = (async () => {
    if (!FIGURE_MODELS.includes(model) || !await loadFigureModel(undefined, model)) { pending.delete(model); return {} }
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ alpha: true, antialias: true }) } catch { pending.delete(model); return {} }
    renderer.setPixelRatio(1); renderer.setSize(144, 144); renderer.setClearColor(0, 0)
    const world = new Scene()
    world.add(new AmbientLight(0xffffff, 1.8))
    const light = new DirectionalLight(0xffffff, 2.6); light.position.set(-3, 5, -4); world.add(light)
    const camera = new OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.1, 30)
    const result: Partial<Record<PoseId, string>> = {}
    try {
      for (const pose of Object.keys(POSE_LABELS) as PoseId[]) {
        const { group } = createFigure({ model, pose, color: '#a7b9ca' })
        world.add(group)
        const box = measureFigure(group), center = box.getCenter(new Vector3()), size = box.getSize(new Vector3())
        const half = Math.max(size.x, size.y, size.z, 1) * 0.64
        camera.left = -half; camera.right = half; camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix()
        camera.position.set(center.x + 2.5, center.y + 0.8, center.z - 5); camera.lookAt(center)
        renderer.render(world, camera); result[pose] = renderer.domElement.toDataURL('image/png')
        world.remove(group); disposeActorFigure(group)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      return result
    } finally { renderer.dispose(); renderer.forceContextLoss() }
  })()
  pending.set(model, promise)
  return promise
}
