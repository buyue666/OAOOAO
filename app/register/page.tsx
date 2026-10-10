import { Suspense } from 'react'
import { LoginPage } from '@/components/studio/login-page'

export default function Page() {
  return (
    <Suspense fallback={<main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">正在加载注册页…</main>}>
      <LoginPage mode="register" />
    </Suspense>
  )
}
