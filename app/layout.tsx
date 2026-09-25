import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { StudioApp } from '@/components/studio/studio-app'
import { GenerationProvider } from '@/lib/studio/generation-store'
import { StudioProvider } from '@/lib/studio/store'
import './globals.css'

export const metadata: Metadata = {
  title: 'OAOOAO Studio · AI 创作工作台',
  description: '在一个工作台中完成 AI 图片、视频、短剧与导演 Agent 创作。',
  generator: 'v0.app',
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#fafafa',
  userScalable: true,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="bg-background" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <StudioProvider>
          <GenerationProvider><StudioApp>{children}</StudioApp></GenerationProvider>
        </StudioProvider>
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
