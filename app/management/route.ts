import { NextRequest, NextResponse } from 'next/server'

/**
 * 旧版管理入口的兼容跳转。
 * 全部映射到 OAOOAO 控制中心的对应页面，不再跳转到任何外部管理端。
 */
const aliases: Record<string, string> = {
  channels: '/admin/channels',
  models: '/admin/channels',
  users: '/admin/users',
  payments: '/admin/orders',
  orders: '/admin/orders',
  coupons: '/admin/orders',
  referrals: '/admin/orders',
  promotions: '/admin/products',
  products: '/admin/products',
  logs: '/admin/generation',
  generation: '/admin/generation',
  announcements: '/admin/content',
  works: '/admin/content',
  settings: '/admin/settings',
  audit: '/admin/audit',
}

export function GET(request: NextRequest) {
  const section = request.nextUrl.searchParams.get('section') || ''
  const target = aliases[section] || '/admin'
  return NextResponse.redirect(new URL(target, request.url))
}
