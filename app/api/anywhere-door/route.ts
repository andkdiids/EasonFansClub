import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { getPublicSocialPostFeed, decodeSocialCursor } from '@/lib/social-posts'
import { enforceApiRateLimit, unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()
  if (!(await canAccessAnywhereDoor(user))) return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED', message: '随意门当前未开放' }, { status: 404 })
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/anywhere-door:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const url = new URL(request.url)
  const cursor = url.searchParams.get('cursor')
  if (cursor && !decodeSocialCursor(cursor)) return NextResponse.json({ ok: false, message: '分页游标无效' }, { status: 400 })
  const limit = Number(url.searchParams.get('limit') || 20)
  try {
    const feed = await getPublicSocialPostFeed({ cursor, limit, viewerId: user.id })
    return NextResponse.json(feed, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
  } catch (error) {
    console.error('[anywhere-door.feed]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ ok: false, message: '随意门内容暂时无法加载' }, { status: 503 })
  }
}
