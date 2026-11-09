import { Group, Mesh } from 'three'
import type { DirectorActor } from '../types'
import { createFigure, updateFigure } from './figure'
import { POSE_ROTATIONS } from './poses'
import type { BoneRotations } from './pose'
import type { PoseId } from './catalog'

export function actorPoseId(actor: DirectorActor): PoseId {
  return actor.posePreset ?? (actor.pose === 'walk' ? 'walk' : 'stand')
}

export function actorBoneRotations(actor: DirectorActor): BoneRotations {
  const rotations: BoneRotations = Object.fromEntries(Object.entries(POSE_ROTATIONS[actorPoseId(actor)]).map(([key, value]) => [key, [...value!]]))
  const controls = actor.poseControls
  if (!controls) return rotations
  const add = (bone: string, axis: 0 | 1 | 2, value: number) => {
    const rotation = [...(rotations[bone] ?? [0, 0, 0])] as [number, number, number]
    rotation[axis] += Number.isFinite(value) ? value : 0
    rotations[bone] = rotation
  }
  for (const bone of ['spine_01', 'spine_02', 'spine_03']) {
    add(bone, 0, -controls.torsoPitch / 3); add(bone, 1, controls.torsoYaw / 3); add(bone, 2, controls.torsoRoll / 3)
  }
  add('Head', 0, -controls.headPitch); add('Head', 1, controls.headYaw); add('Head', 2, controls.headRoll)
  for (const side of ['left', 'right'] as const) {
    const suffix = side === 'left' ? 'l' : 'r'
    add(`upperarm_${suffix}`, 0, controls[`${side}ShoulderPitch`]); add(`upperarm_${suffix}`, 1, controls[`${side}ShoulderYaw`]); add(`upperarm_${suffix}`, 2, controls[`${side}ShoulderRoll`])
    add(`lowerarm_${suffix}`, 0, -controls[`${side}Elbow`]); add(`hand_${suffix}`, 2, controls[`${side}Wrist`])
    add(`thigh_${suffix}`, 0, -controls[`${side}Hip`]); add(`calf_${suffix}`, 0, -controls[`${side}Knee`]); add(`foot_${suffix}`, 0, controls[`${side}Ankle`])
  }
  return rotations
}

export function createActorFigure(actor: DirectorActor) {
  const wrapper = new Group()
  // Our front camera sits on +Z. The shared figure coordinate system faces -Z.
  wrapper.rotation.y = Math.PI
  const figure = createFigure({ model: actor.figureModel ?? 'male', pose: actorPoseId(actor), color: actor.color }).group
  wrapper.add(figure)
  wrapper.userData.actorFigure = figure
  updateActorFigure(wrapper, actor)
  return wrapper
}

export function updateActorFigure(wrapper: Group, actor: DirectorActor) {
  const figure = wrapper.userData.actorFigure as Group | undefined
  if (!figure) return false
  const signature = JSON.stringify([actor.figureModel, actor.posePreset, actor.pose, actor.poseControls, actor.color])
  if (wrapper.userData.poseSignature === signature) return true
  wrapper.userData.poseSignature = signature
  return updateFigure(figure, { model: actor.figureModel ?? 'male', pose: actorPoseId(actor), rotations: actorBoneRotations(actor), color: actor.color })
}

/** Geometry belongs to the cached template; only the instance material and skeleton are owned. */
export function disposeActorFigure(root: Group) {
  const materials = new Set<import('three').Material>()
  const skeletons = new Set<import('three').Skeleton>()
  root.traverse(node => {
    if (!(node instanceof Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
    if ('skeleton' in node) skeletons.add(node.skeleton as import('three').Skeleton)
  })
  materials.forEach(material => material.dispose())
  skeletons.forEach(skeleton => skeleton.dispose())
}
