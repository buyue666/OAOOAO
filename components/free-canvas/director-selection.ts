type PickObject = { userData: Record<string, unknown>; parent: PickObject | null }
export type DirectorSelection = { kind: 'actor' | 'camera'; id: string } | null

/** Meshes in imported rigs inherit the scene identity from their enclosing group. */
export function directorObjectIdentity(object: PickObject | null): DirectorSelection {
  for (let current = object; current; current = current.parent) {
    if (typeof current.userData.directorActorId === 'string') return { kind: 'actor', id: current.userData.directorActorId }
    if (typeof current.userData.directorCameraId === 'string') return { kind: 'camera', id: current.userData.directorCameraId }
  }
  return null
}

export function isDirectorPick(start: { x: number; y: number; pointerId: number } | null, end: { clientX: number; clientY: number; pointerId: number }, transformed: boolean) {
  return Boolean(start && start.pointerId === end.pointerId && !transformed && Math.hypot(start.x - end.clientX, start.y - end.clientY) <= 5)
}
