import { Suspense } from 'react'
import { OaoCanvas } from '@/components/oao-canvas/oao-canvas'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <Suspense fallback={<main className="h-full min-h-dvh bg-black" />}><OaoCanvas projectId={projectId} /></Suspense>
}
