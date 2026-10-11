'use client'

import type { InputHTMLAttributes, ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export const authInputClass = 'h-11 w-full min-w-0 rounded-lg border bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-studio-accent focus-visible:ring-2 focus-visible:ring-studio-accent/25 disabled:opacity-60'

type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & { id: string; error?: string; hint?: string }

export function AuthField({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-destructive">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function AuthInput({ id, error, hint, className, ...props }: AuthInputProps) {
  return (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      className={cn(authInputClass, error ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20' : 'border-border', className)}
      {...props}
    />
  )
}

export function AuthPasswordInput({ visible, onToggle, className, ...props }: AuthInputProps & { visible: boolean; onToggle: () => void }) {
  return (
    <span className="relative block">
      <AuthInput type={visible ? 'text' : 'password'} className={cn('pr-11', className)} {...props} />
      <button
        type="button"
        onClick={onToggle}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/50"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </span>
  )
}
