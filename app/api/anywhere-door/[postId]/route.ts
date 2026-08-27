import { NextResponse } from 'next/server'
import { getPublicSocialPostDetail } from '@/lib/social-posts'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  if (!(await canAccessAnywhereDoor(guard.user))) return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED', message: '随意门当前未开放' }, { status: 404 })
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/anywhere-door/[postId]:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  const { postId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(postId)) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
  try {
    const post = await getPublicSocialPostDetail(postId, guard.user.id)
    if (!post) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
    return NextResponse.json({ post }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[anywhere-door.detail]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '动态暂时无法加载' }, { status: 503 })
  }
}
