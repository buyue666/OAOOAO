import { Suspense } from 'react'
import { OaoInfiniteCanvasIndex } from '@/components/oao-canvas/oao-infinite-canvas'

export default function Page() {
  return <Suspense fallback={<main className="h-full min-h-dvh bg-background" />}><OaoInfiniteCanvasIndex /></Suspense>
}
