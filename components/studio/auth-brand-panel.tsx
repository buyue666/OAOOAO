import Image from 'next/image'

const steps = [
  { title: '描述想法', detail: '用一句话或一段脚本说明画面、镜头与故事。' },
  { title: '导演 Agent 编排', detail: '拆解分镜、选择模型，并在开始前估算积分。' },
  { title: '生成与交付', detail: '图片、视频与短剧在同一工作台完成，并保存为作品。' },
]

const capabilities = ['图片生成', '视频生成', '短剧制作', '自由画布', '导演 Agent']

/**
 * 登录页品牌区：AI 创作画布作为底图，流程与能力直接排在画面下方，不套卡片。
 * 仅桌面端显示；移动端由表单区顶部的品牌标识代替。
 */
export function AuthBrandPanel() {
  return (
    <aside aria-label="OAO 产品介绍" className="relative hidden min-h-dvh overflow-hidden bg-[#0b0c0e] text-white lg:flex lg:flex-col">
      <Image
        src="/media/generated/auth-ai-canvas-v1.png"
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 54vw, 0px"
        className="object-cover object-center opacity-75"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-[#0b0c0e]/55" />

      <div className="relative flex h-16 shrink-0 items-center gap-3 px-12">
        <Image src="/media/brand/oao-mark.png" alt="" width={512} height={512} className="size-7 invert" />
        <span className="text-sm font-medium text-white/90">OAO 创作平台</span>
      </div>

      <div className="relative mt-auto flex flex-col gap-10 px-12 pb-12">
        <div className="flex max-w-xl flex-col gap-3">
          <p className="text-xs font-medium text-white/70">从想法到作品</p>
          <h2 className="text-balance text-3xl font-semibold leading-[1.2] tracking-[-0.03em]">图片、视频与短剧，在同一个工作台完成</h2>
          <p className="max-w-md text-sm leading-7 text-white/80">导演 Agent 会把想法拆成可执行的步骤，你只需要确认方向。</p>
        </div>

        <ol aria-label="创作流程" className="grid max-w-xl gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-1.5 border-t border-white/25 pt-3">
              <span className="text-xs font-medium tabular-nums text-white/60">0{index + 1}</span>
              <span className="text-sm font-medium text-white">{step.title}</span>
              <span className="text-xs leading-5 text-white/75">{step.detail}</span>
            </li>
          ))}
        </ol>

        <p aria-label="创作能力" className="text-xs leading-5 text-white/70">{capabilities.join(' · ')}</p>
      </div>
    </aside>
  )
}
