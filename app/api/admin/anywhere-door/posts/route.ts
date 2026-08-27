import { NextResponse } from 'next/server'
import { getAdminSocialPosts } from '@/lib/social-posts'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const url = new URL(request.url)
  try {
    return NextResponse.json(await getAdminSocialPosts({ status: url.searchParams.get('status'), page: Number(url.searchParams.get('page') || 1) }), { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.anywhere-door.posts]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '随意门动态暂时无法加载' }, { status: 503 })
  }
}
