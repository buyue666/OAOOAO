'use client'

import { useEffect, useState } from 'react'
import { getAnnouncementCountdown } from '@/lib/studio/announcement-countdown'

function CountdownDigits({ value }: { value: number }) {
  return (
    <span className="oao-countdown-number">
      {String(value).padStart(2, '0').split('').map((digit, index) => (
        <span className="oao-countdown-digit" key={index}>
          <span>{digit}</span>
        </span>
      ))}
    </span>
  )
}

export function AnnouncementCountdown({ endsAt }: { endsAt?: string }) {
  // Both the server and the first browser render are empty; time is read only after hydration.
  const [clock, setClock] = useState<{ endsAt: string; now: number } | null>(null)

  useEffect(() => {
    if (!endsAt) return
    const deadline = Date.parse(endsAt)
    if (!Number.isFinite(deadline)) return
    let timer: number | undefined
    let disposed = false

    const stop = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }
    const refresh = () => {
      stop()
      if (disposed || document.visibilityState === 'hidden') return
      const now = Date.now()
      setClock({ endsAt, now })
      const remainingMs = deadline - now
      if (remainingMs > 0) {
        // Align to this deadline's next second boundary, including the final partial second.
        timer = window.setTimeout(refresh, Math.max(16, remainingMs % 1000 || 1000))
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
      else refresh()
    }

    refresh()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [endsAt])

  const remaining = clock && clock.endsAt === endsAt ? getAnnouncementCountdown(endsAt, clock.now) : null
  if (!remaining) return null
  const label = `距结束还有${remaining.days}天${remaining.hours}小时${remaining.minutes}分${remaining.seconds}秒`

  return (
    <div className="oao-announcement-countdown" role="timer" aria-live="off" aria-label={label}>
      <span className="oao-countdown-caption" aria-hidden="true">距结束</span>
      <span className="oao-countdown-clock" aria-hidden="true">
        <CountdownDigits value={remaining.days} />
        <span className="oao-countdown-unit">天</span>
        <CountdownDigits value={remaining.hours} />
        <span className="oao-countdown-separator">:</span>
        <CountdownDigits value={remaining.minutes} />
        <span className="oao-countdown-separator">:</span>
        <CountdownDigits value={remaining.seconds} />
      </span>
    </div>
  )
}
