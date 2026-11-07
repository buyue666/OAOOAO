'use client'

import Link from 'next/link'
import { AlertCircle, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export function TeamError({ error }: { error?: unknown }) {
  if (!error) return null
  return <Alert variant="destructive"><AlertCircle /><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription></Alert>
}

export function TeamUnavailable({ connected, error, retry }: { connected: boolean; error?: unknown; retry?: () => void }) {
  return <Empty className="min-h-64 border">
    <EmptyHeader><EmptyMedia variant="icon"><Users /></EmptyMedia><EmptyTitle>{connected ? '暂时无法读取团队' : '登录后使用团队空间'}</EmptyTitle><EmptyDescription>{connected ? error instanceof Error ? error.message : '团队不存在，或当前账号已没有访问权限。' : '预览不会创建虚拟团队。连接后端并登录后，即可创建真实团队、邀请成员并共享项目。'}</EmptyDescription></EmptyHeader>
    <EmptyContent>{connected ? <Button variant="outline" onClick={retry}>重新读取</Button> : <Link className={buttonVariants({ variant: 'outline' })} href="/login?next=%2Fteams">前往登录</Link>}</EmptyContent>
  </Empty>
}

export function TeamLoading() {
  return <div role="status" aria-label="正在读取团队" className="flex flex-col gap-4"><Skeleton className="h-10 w-40" /><Skeleton className="h-40 w-full" /><span className="sr-only">正在读取团队…</span></div>
}
