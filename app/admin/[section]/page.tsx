import { AdminDashboard } from '@/components/studio/admin-dashboard'

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  return <AdminDashboard section={section} />
}
