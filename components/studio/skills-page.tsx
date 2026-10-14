'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CanvasSkillLibrary } from '@/components/free-canvas/canvas-skill-library'
import { PageHeader } from './ui'

export function SkillsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader eyebrow="创作工具" title="技能库" description="把你的风格、创作步骤和交付标准存成技能。填写说明或导入 SKILL.md，在画布中随时调用。" actions={<Link href="/canvas" className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">进入自由画布<ArrowRight className="size-4" aria-hidden="true" /></Link>} />
      <div className="rounded-2xl border border-border bg-background p-5 md:p-6"><CanvasSkillLibrary /></div>
      <p className="text-sm leading-6 text-muted-foreground">使用方法：进入画布，在生成节点或 Agent 中点击“选择技能”，再描述这次的任务。简介、适用场景、使用方式和输出要求会与技能指令一起生效；Agent 制定计划后由你确认执行。技能仅当前账号可见，保存与导入技能不消耗生成积分。</p>
    </div>
  )
}
