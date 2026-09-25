import { Suspense } from 'react'
import { LoginPage } from '@/components/studio/login-page'

export default function Page() {
  // LoginPage 读取查询参数（mode / next / ref）来切换登录、注册与重置密码流程，
  // useSearchParams 需要 Suspense 边界，否则静态渲染会报错。
  return (
    <Suspense fallback={<main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">正在加载登录页…</main>}>
      <LoginPage />
    </Suspense>
  )
}
