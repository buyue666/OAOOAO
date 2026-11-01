import { notFound } from 'next/navigation'
import { ToolsPage, type CreativeTool } from '@/components/studio/tools-page'

export default async function Page({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params
  if (tool !== 'remix' && tool !== 'tryon') notFound()
  return <ToolsPage tool={tool as CreativeTool} />
}
