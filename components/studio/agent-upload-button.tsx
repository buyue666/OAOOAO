'use client'

import { useRef } from 'react'
import { Plus } from 'lucide-react'
import styles from './agent-upload-button.module.css'

// Motion Prompt #153 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#153
// CSS port: 520px perspective, 0.32rad tilt, 400ms cubic ease-out and pointer glare.
export function AgentUploadButton({ disabled, onClick, label = '添加参考文件' }: { disabled?: boolean; onClick: () => void; label?: string }) {
  const button = useRef<HTMLButtonElement>(null)
  return <button ref={button} type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={styles.upload}
    onPointerMove={event => {
      if (event.pointerType !== 'mouse' || !button.current) return
      const rect = event.currentTarget.getBoundingClientRect()
      const x = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)))
      const y = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)))
      button.current.style.setProperty('--tilt-x', `${y * .32}rad`)
      button.current.style.setProperty('--tilt-y', `${-x * .32}rad`)
      button.current.style.setProperty('--glare-x', `${(x + 1) * 50}%`)
      button.current.style.setProperty('--glare-y', `${(y + 1) * 50}%`)
    }} onPointerLeave={() => { button.current?.style.setProperty('--tilt-x', '0rad'); button.current?.style.setProperty('--tilt-y', '0rad') }}>
    <span className={styles.back} aria-hidden="true" />
    <span className={styles.card} aria-hidden="true"><Plus className="size-5" strokeWidth={1.5} /><span className={styles.glare} /></span>
    <span className={styles.caption}>添加文件</span>
  </button>
}
