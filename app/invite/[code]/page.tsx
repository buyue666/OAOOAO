import { redirect } from 'next/navigation'

/**
 * 邀请链接落地页。
 *
 * 后端的 `/invite/[code]` 会设置邀请 Cookie 并跳转到 `/register`，
 * 但那套页面属于后端自身的界面，不是本前端的入口。
 * 这里提供前端自己的落地路径：把邀请码透传给登录页的注册流程，
 * 保证复制出去的邀请链接在本地入口（前端）也能正常工作。
 *
 * 邀请关系最终仍由后端 `/api/auth/register` 记录，前端只负责把码带过去。
 */
export default async function InviteLandingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const normalized = decodeURIComponent(String(code ?? '')).trim().slice(0, 64)
  // 邀请码只允许字母数字与短横线，避免把任意内容带进查询参数。
  const safe = /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : ''
  redirect(safe ? `/login?mode=register&ref=${encodeURIComponent(safe)}` : '/login?mode=register')
}
