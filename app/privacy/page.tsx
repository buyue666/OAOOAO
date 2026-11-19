import { PublicPolicyPage } from '@/components/legal/public-policy-page'
import { Suspense } from 'react'

export default function PrivacyPage() {
  return <Suspense fallback={<main className="min-h-dvh bg-background p-8 text-foreground">正在读取正文…</main>}><PublicPolicyPage kind="privacy" /></Suspense>
}
