import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { StudioApp } from '@/components/studio/studio-app'
import { GenerationProvider } from '@/lib/studio/generation-store'
import { StudioProvider } from '@/lib/studio/store'
import { LocaleProvider } from '@/lib/studio/i18n'
import { SiteBrandMetadata } from '@/components/site-brand'
import { SiteAnnouncements } from '@/components/site-announcements'
import { SitePopups } from '@/components/site-popups'
import { WorkspaceProvider } from '@/lib/studio/workspace-context'
import '@xyflow/react/dist/style.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'OAO · AI 创作工作台',
  description: '在一个工作台中完成 AI 图片、视频、短剧与导演 Agent 创作，支持独立的个人与团队空间、共享资产和团队预算。',
  icons: { icon: '/media/brand/oao-mark.png' },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#f4f5f7',
  userScalable: true,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="bg-background" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <LocaleProvider>
          <StudioProvider>
            <SiteBrandMetadata />
            <WorkspaceProvider><GenerationProvider><SiteAnnouncements><StudioApp>{children}</StudioApp><SitePopups /></SiteAnnouncements></GenerationProvider></WorkspaceProvider>
          </StudioProvider>
        </LocaleProvider>
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
