import type { DirectorActor, DirectorActorKey, DirectorCamera, DirectorCameraKey, DirectorSceneData } from '../types'

export const ACTOR_KEY_FIELDS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'scale'] as const
export const CAMERA_KEY_FIELDS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'targetX', 'targetY', 'targetZ', 'fov'] as const
export const directorDuration = (scene: DirectorSceneData) => Math.max(1, Math.min(15, scene.duration ?? 5))
const roundTime = (time: number) => Math.round(time * 100) / 100
const angle = (from: number, to: number, progress: number) => from + (((to - from) % 360 + 540) % 360 - 180) * progress

function sample<T extends object>(item: T, keys: Array<T & { t: number; ease: 'smooth' | 'linear' }> | undefined, fields: readonly (keyof T)[], time: number): T {
  if (!keys?.length) return item
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const after = sorted.findIndex(key => key.t >= time)
  const pick = (key: T) => ({ ...item, ...Object.fromEntries(fields.map(field => [field, key[field]])) }) as T
  if (after === 0) return pick(sorted[0])
  if (after < 0) return pick(sorted.at(-1)!)
  const from = sorted[after - 1], to = sorted[after]
  const progress = (time - from.t) / (to.t - from.t)
  const u = from.ease === 'linear' ? progress : progress * progress * (3 - 2 * progress)
  return { ...item, ...Object.fromEntries(fields.map(field => {
    const a = Number(from[field]), b = Number(to[field])
    return [field, String(field).startsWith('rotation') ? angle(a, b, u) : a + (b - a) * u]
  })) }
}

export const sampleActor = (actor: DirectorActor, time: number) => sample(actor, actor.keys as Array<DirectorActor & DirectorActorKey> | undefined, ACTOR_KEY_FIELDS, time)
export const sampleCamera = (camera: DirectorCamera, time: number) => sample(camera, camera.keys as Array<DirectorCamera & DirectorCameraKey> | undefined, CAMERA_KEY_FIELDS, time)
export const sampleDirectorScene = (scene: DirectorSceneData, time: number): DirectorSceneData => ({ ...scene, actors: scene.actors.map(actor => sampleActor(actor, time)), cameras: scene.cameras.map(camera => sampleCamera(camera, time)) })

export function recordActorKey(actor: DirectorActor, time: number, patch: Partial<DirectorActor> = {}): DirectorActor {
  const current = { ...sampleActor(actor, time), ...patch }
  const key: DirectorActorKey = { ...Object.fromEntries(ACTOR_KEY_FIELDS.map(field => [field, current[field]])), t: roundTime(time), ease: 'smooth' } as DirectorActorKey
  return { ...actor, keys: [...(actor.keys ?? []).filter(item => Math.abs(item.t - key.t) > .005), key].sort((a, b) => a.t - b.t) }
}

export function recordCameraKey(camera: DirectorCamera, time: number, patch: Partial<DirectorCamera> = {}): DirectorCamera {
  const current = { ...sampleCamera(camera, time), ...patch }
  const key: DirectorCameraKey = { ...Object.fromEntries(CAMERA_KEY_FIELDS.map(field => [field, current[field]])), t: roundTime(time), ease: 'smooth' } as DirectorCameraKey
  return { ...camera, keys: [...(camera.keys ?? []).filter(item => Math.abs(item.t - key.t) > .005), key].sort((a, b) => a.t - b.t) }
}

export function resizeDirectorDuration(scene: DirectorSceneData, duration: number): DirectorSceneData {
  const end = directorDuration({ ...scene, duration })
  const actors = scene.actors.map(actor => {
    if (!actor.keys?.some(key => key.t > end)) return actor
    const keys = [...actor.keys.filter(key => key.t <= end), recordActorKey(actor, end).keys!.find(key => key.t === end)!].sort((a, b) => a.t - b.t)
    return { ...actor, keys: keys.filter((key, i) => !i || key.t !== keys[i - 1].t) }
  })
  const cameras = scene.cameras.map(camera => {
    if (!camera.keys?.some(key => key.t > end)) return camera
    const keys = [...camera.keys.filter(key => key.t <= end), recordCameraKey(camera, end).keys!.find(key => key.t === end)!].sort((a, b) => a.t - b.t)
    return { ...camera, keys: keys.filter((key, i) => !i || key.t !== keys[i - 1].t) }
  })
  return { ...scene, duration: end, actors, cameras }
}

export const CAMERA_MOTIONS = {
  fixed: '固定', dollyIn: '推近', dollyOut: '拉远', panLeft: '左摇', panRight: '右摇', tiltUp: '上摇', tiltDown: '下摇',
  truckLeft: '左移', truckRight: '右移', craneUp: '上升', craneDown: '下降', orbit: '环绕', follow: '跟拍',
} as const
export type CameraMotion = keyof typeof CAMERA_MOTIONS

export function applyCameraMotion(scene: DirectorSceneData, cameraId: string, motion: CameraMotion, actorId?: string): DirectorSceneData {
  const camera = scene.cameras.find(item => item.id === cameraId)
  if (!camera) return scene
  const start = sampleCamera(camera, 0), duration = directorDuration(scene)
  const actor = scene.actors.find(item => item.id === (actorId ?? camera.lookAtActorId)) ?? scene.actors[0]
  const baseActor = actor && sampleActor(actor, 0)
  const target = baseActor ? [baseActor.x, baseActor.y + 1.2 * baseActor.scale, baseActor.z] : [start.targetX, start.targetY, start.targetZ]
  const delta = [target[0] - start.x, target[1] - start.y, target[2] - start.z]
  const length = Math.hypot(...delta) || 1
  const forward = delta.map(value => value / length)
  const rightLength = Math.hypot(forward[0], forward[2]) || 1
  const right = [-forward[2] / rightLength, 0, forward[0] / rightLength]
  const at = (u: number): Partial<DirectorCamera> => {
    const p: Partial<DirectorCamera> = { ...start, rotationX: 0, rotationY: 0, rotationZ: 0, targetX: target[0], targetY: target[1], targetZ: target[2] }
    const move = (direction: number[], distance: number) => { p.x = start.x + direction[0] * distance; p.y = Math.max(.2, start.y + direction[1] * distance); p.z = start.z + direction[2] * distance }
    if (motion === 'dollyIn' || motion === 'dollyOut') move(forward, length * .4 * u * (motion === 'dollyIn' ? 1 : -1))
    if (motion === 'truckLeft' || motion === 'truckRight') { const sign = motion === 'truckLeft' ? -1 : 1; move(right, 2 * sign * u); p.targetX! += right[0] * 2 * sign * u; p.targetZ! += right[2] * 2 * sign * u }
    if (motion === 'craneUp' || motion === 'craneDown') move([0, 1, 0], 1.5 * u * (motion === 'craneUp' ? 1 : -1))
    if (motion === 'panLeft' || motion === 'panRight') { const theta = Math.PI / 6 * u * (motion === 'panLeft' ? 1 : -1); p.targetX = start.x + delta[0] * Math.cos(theta) + delta[2] * Math.sin(theta); p.targetZ = start.z - delta[0] * Math.sin(theta) + delta[2] * Math.cos(theta) }
    if (motion === 'tiltUp' || motion === 'tiltDown') p.targetY = target[1] + Math.tan(Math.PI / 12 * u) * length * (motion === 'tiltUp' ? 1 : -1)
    if (motion === 'orbit') { const theta = Math.PI / 2 * u, x = start.x - target[0], z = start.z - target[2]; p.x = target[0] + x * Math.cos(theta) + z * Math.sin(theta); p.z = target[2] - x * Math.sin(theta) + z * Math.cos(theta) }
    if (motion === 'follow' && actor && baseActor) { const value = sampleActor(actor, duration * u); p.x = start.x + value.x - baseActor.x; p.y = start.y + value.y - baseActor.y; p.z = start.z + value.z - baseActor.z; p.targetX = value.x; p.targetY = value.y + 1.2 * value.scale; p.targetZ = value.z }
    return p
  }
  let changed: DirectorCamera = { ...camera, ...at(0), keys: [] }
  if (motion !== 'fixed') for (let time = 0; time <= duration + .001; time += .5) changed = recordCameraKey(changed, Math.min(time, duration), at(Math.min(1, time / duration)))
  return { ...scene, cameras: scene.cameras.map(item => item.id === cameraId ? changed : item) }
}
