export type AnnouncementTimeRemaining = {
  remainingSeconds: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

/** Calculate from the deadline on each tick so paused tabs and delayed timers cannot accumulate drift. */
export function getAnnouncementCountdown(endsAt: string | undefined, now: number): AnnouncementTimeRemaining | null {
  if (!endsAt || !Number.isFinite(now)) return null
  const deadline = Date.parse(endsAt)
  if (!Number.isFinite(deadline) || deadline <= now) return null

  const remainingSeconds = Math.ceil((deadline - now) / 1000)
  return {
    remainingSeconds,
    days: Math.floor(remainingSeconds / 86400),
    hours: Math.floor(remainingSeconds / 3600) % 24,
    minutes: Math.floor(remainingSeconds / 60) % 60,
    seconds: remainingSeconds % 60,
  }
}
