import { ProjectsPage } from '@/components/studio/projects-pages'
import { redirect } from 'next/navigation'

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams
  if (params.view === 'drama') redirect('/drama')
  return <ProjectsPage />
}
