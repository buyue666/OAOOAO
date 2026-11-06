import { DirectorAgentWorkspace } from '@/components/studio/director-agent'

export default function Page() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-56px)] min-h-0 w-full max-w-[1440px] p-4 sm:p-6 xl:p-8">
      <DirectorAgentWorkspace />
    </div>
  )
}
