import Image from 'next/image'

const capabilities = ['图片生成', '视频生成', '短剧制作', '自由画布', '导演 Agent']

export function AuthBrandPanel() {
  return (
    <aside aria-label="OAO 产品介绍" className="relative hidden overflow-hidden bg-[#0f1012] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <Image
        src="/media/generated/hero-film-v2.png"
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 52vw, 0px"
        className="object-cover opacity-75"
      />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-[#0f1012] via-[#0f1012]/70 to-transparent" />

      <div className="relative">
        <Image src="/media/brand/oao-mark.png" alt="" width={512} height={512} className="size-10 invert" />
      </div>

      <div className="relative flex flex-col gap-6">
        <h2 className="max-w-md text-4xl font-semibold leading-[1.15] tracking-[-0.04em]">从一个想法，到完整作品</h2>
        <p className="max-w-md text-base leading-7 text-white/80">图片、视频、短剧与自由画布在同一个工作台完成，导演 Agent 会把想法拆解成可执行的步骤。</p>
        <ul aria-label="创作能力" className="flex flex-wrap gap-2">
          {capabilities.map((item) => (
            <li key={item} className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-white">{item}</li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
