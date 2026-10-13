'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CanvasSkillLibrary } from '@/components/free-canvas/canvas-skill-library'
import { PageHeader } from './ui'

export function SkillsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader eyebrow="创作工具" title="技能库" description="保存常用的风格、步骤和输出要求。在画布节点中选择技能，再输入这次要完成的任务。" actions={<Link href="/canvas" className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">进入自由画布<ArrowRight className="size-4" aria-hidden="true" /></Link>} />
      <div className="rounded-2xl border border-border bg-background p-5 md:p-6"><CanvasSkillLibrary /></div>
      <p className="text-sm leading-6 text-muted-foreground">生成节点会把技能指令加入本次提示词；Agent 会读取所选技能后制定执行计划，确认计划后再开始执行。保存技能本身不消耗生成积分。</p>
    </div>
  )
}
