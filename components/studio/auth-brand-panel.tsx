import Image from 'next/image'

const steps = [
  { title: '描述想法', detail: '用一句话或一段脚本说明画面、镜头与故事。' },
  { title: '导演 Agent 编排', detail: '拆解分镜、选择模型，并在开始前估算积分。' },
  { title: '生成与交付', detail: '图片、视频与短剧在同一工作台完成，并保存为作品。' },
]

const capabilities = ['图片生成', '视频生成', '短剧制作', '自由画布', '导演 Agent']

export function AuthBrandPanel() {
  return (
    <aside aria-label="OAO 产品介绍" className="relative hidden min-h-dvh overflow-hidden bg-[#0a0a0a] text-white lg:flex lg:flex-col">
      <Image
        src="/media/generated/hero-film-v2.png"
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 50vw, 0px"
        className="object-cover opacity-60"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-[#0a0a0a] via-[#0a0a0a]/75 to-[#0a0a0a]/30" />

      <div className="relative flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-12">
        <Image src="/media/brand/oao-mark.png" alt="" width={512} height={512} className="size-7 invert" />
        <span className="text-sm font-semibold tracking-tight">OAO 创作平台</span>
      </div>

      <div className="relative mt-auto flex flex-col gap-10 p-12">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/50">从想法到作品</p>
          <h2 className="max-w-md text-4xl font-semibold leading-[1.15] tracking-[-0.04em]">图片、视频与短剧，在同一个工作台完成</h2>
          <p className="max-w-md text-sm leading-7 text-white/70">导演 Agent 会把想法拆成可执行的步骤，你只需要确认方向。</p>
        </div>

        <ol aria-label="创作流程" className="overflow-hidden rounded-lg border border-white/15">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4 border-b border-white/15 bg-[#0a0a0a] p-4 last:border-b-0">
              <span className="text-xs font-medium tabular-nums text-white/45">0{index + 1}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">{step.title}</span>
                <span className="text-xs leading-5 text-white/65">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <ul aria-label="创作能力" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/55">
          {capabilities.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </aside>
  )
}
