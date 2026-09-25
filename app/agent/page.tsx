import { DirectorAgentWorkspace } from '@/components/studio/director-agent'

export default function Page() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-60px)] min-h-0 w-full max-w-[1400px] px-4 py-4 sm:px-5 md:px-8 md:py-5 xl:px-10">
      <DirectorAgentWorkspace context="工作台创意 · 极光之后" />
    </div>
  )
}
