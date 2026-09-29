import { Suspense } from 'react'
import { OaoCanvasIndex } from '@/components/oao-canvas/oao-canvas'

export default function Page() {
  return <Suspense fallback={<main className="h-full min-h-dvh bg-background" />}><OaoCanvasIndex /></Suspense>
}
