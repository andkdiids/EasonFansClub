import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  createPostViewKey,
  parsePostViewHistory,
  POST_VIEW_HISTORY_COOKIE,
  POST_VIEW_WINDOW_MS,
  POST_VIEWER_COOKIE,
  recordPostView,
  serializePostViewHistory,
  shouldCountPostView,
} from '@/lib/post-views'
import { buildSalonFeedWhere } from '@/lib/salon'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { rejectInvalidRequestOrigin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const postIdPattern = /^[a-zA-Z0-9_-]{1,191}$/
const recentRequests = new Map<string, number>()

export async function POST(request: Request, context: { params: Promise<{ postId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin

  const { postId } = await context.params
  if (!postIdPattern.test(postId)) return NextResponse.json({ message: '作品标识无效' }, { status: 400 })

  const user = await getCurrentUser()
  const cookieStore = await cookies()
  let anonymousId = cookieStore.get(POST_VIEWER_COOKIE)?.value
  if (!user && !anonymousId) anonymousId = randomUUID()
  const identity = user ? `user:${user.id}` : `anonymous:${anonymousId}`
  const key = createPostViewKey(`salon:${postId}`, identity)
  const now = Date.now()
  const history = parsePostViewHistory(cookieStore.get(POST_VIEW_HISTORY_COOKIE)?.value, now)
  if (recentRequests.size > 1000) {
    recentRequests.forEach((timestamp, requestKey) => {
      if (timestamp <= now - POST_VIEW_WINDOW_MS) recentRequests.delete(requestKey)
    })
  }
  const recentlyRequested = (recentRequests.get(key) || 0) > now - POST_VIEW_WINDOW_MS
  const shouldIncrement = !recentlyRequested && shouldCountPostView(history, key, now)
  const visibleSalonWhere = { ...buildSalonFeedWhere(), id: postId }
  if (shouldIncrement) recentRequests.set(key, now)

  try {
    const updated = shouldIncrement
      ? await prisma.salonPost.updateMany({ where: visibleSalonWhere, data: { viewCount: { increment: 1 } } })
      : null
    const post = !shouldIncrement || updated?.count
      ? await prisma.salonPost.findFirst({ where: visibleSalonWhere, select: { viewCount: true } })
      : null
    if (!post) {
      if (shouldIncrement) recentRequests.delete(key)
      return NextResponse.json({ message: '作品不存在或不可用' }, { status: 404 })
    }

    const response = NextResponse.json({ viewCount: post.viewCount || 0, counted: shouldIncrement }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
    response.cookies.set(POST_VIEW_HISTORY_COOKIE, serializePostViewHistory(recordPostView(history, key, now)), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24,
    })
    if (!user && anonymousId && !cookieStore.get(POST_VIEWER_COOKIE)) {
      response.cookies.set(POST_VIEWER_COOKIE, anonymousId, {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365,
      })
    }
    return response
  } catch (error) {
    if (shouldIncrement) recentRequests.delete(key)
    console.error('[salon.view]', { postId, errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '浏览统计暂时不可用' }, { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  }
}
