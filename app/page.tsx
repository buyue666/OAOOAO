import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing-page'

export const metadata: Metadata = {
  title: 'OAO · 图片、视频与故事创作',
  description: '在 OAO，从一个想法出发，用图片、视频、无限画布与智能导演，完成属于你的作品。',
}

export default function Page() {
  return <LandingPage />
}
