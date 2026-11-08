import { DirectorAgentWorkspace } from '@/components/studio/director-agent'

export default function Page() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-60px)] w-full max-w-[1560px] px-4 py-5 sm:px-6 md:px-8 md:py-7 xl:h-[calc(100dvh-60px)] xl:min-h-0 xl:px-10">
      <DirectorAgentWorkspace />
    </div>
  )
}
