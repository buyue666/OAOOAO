import Image from 'next/image'

const steps = [
  { title: '描述想法', detail: '用一句话或一段脚本说明画面、镜头与故事。' },
  { title: '导演 Agent 编排', detail: '拆解分镜、选择模型，并在开始前估算积分。' },
  { title: '生成与交付', detail: '图片、视频与短剧在同一工作台完成，并保存为作品。' },
]

const capabilities = ['图片生成', '视频生成', '短剧制作', '自由画布', '导演 Agent']

/**
 * 品牌视觉区：产品画面作为底图，文案与流程直接排在画面上，不再套用卡片。
 * 仅在桌面端显示；移动端由表单区顶部的标识代替。
 */
export function AuthBrandPanel() {
  return (
    <aside aria-label="OAO 产品介绍" className="relative hidden min-h-dvh overflow-hidden bg-[#0a0a0a] text-white lg:flex lg:flex-col">
      <Image
        src="/media/generated/hero-film-v2.png"
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 52vw, 0px"
        className="object-cover opacity-55"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-[#0a0a0a] via-[#0a0a0a]/70 to-[#0a0a0a]/25" />

      <div className="relative flex h-16 shrink-0 items-center gap-3 px-14">
        <Image src="/media/brand/oao-mark.png" alt="" width={512} height={512} className="size-7 invert" />
        <span className="text-sm font-semibold tracking-tight">OAO 创作平台</span>
      </div>

      <div className="relative mt-auto flex flex-col gap-12 px-14 pb-14">
        <div className="flex max-w-xl flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/55">从想法到作品</p>
          <h2 className="text-balance text-4xl font-semibold leading-[1.12] tracking-[-0.04em]">图片、视频与短剧，在同一个工作台完成</h2>
          <p className="max-w-md text-sm leading-7 text-white/70">导演 Agent 会把想法拆成可执行的步骤，你只需要确认方向。</p>
        </div>

        <ol aria-label="创作流程" className="grid max-w-xl gap-5 border-l border-white/20 pl-6">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex flex-col gap-1">
              <span aria-hidden="true" className="absolute -left-[28px] top-1.5 size-2 rounded-full bg-white" />
              <span className="text-xs font-medium tabular-nums text-white/45">0{index + 1}</span>
              <span className="text-sm font-medium">{step.title}</span>
              <span className="text-xs leading-5 text-white/65">{step.detail}</span>
            </li>
          ))}
        </ol>

        <ul aria-label="创作能力" className="flex flex-wrap gap-2 text-xs text-white/70">
          {capabilities.map((item) => <li key={item} className="rounded-full border border-white/20 px-3 py-1">{item}</li>)}
        </ul>
      </div>
    </aside>
  )
}
