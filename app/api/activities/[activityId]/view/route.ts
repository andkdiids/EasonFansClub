import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  ACTIVITY_VIEWER_COOKIE,
  ACTIVITY_VIEW_HISTORY_COOKIE,
  ACTIVITY_VIEW_WINDOW_MS,
  createActivityViewKey,
  parseActivityViewHistory,
  recordActivityView,
  serializeActivityViewHistory,
  shouldCountActivityView,
} from '@/lib/activity-views'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const recentRequests = new Map<string, number>()

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin

  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })

  const user = await getCurrentUser()
  const cookieStore = await cookies()
  let anonymousId = cookieStore.get(ACTIVITY_VIEWER_COOKIE)?.value
  if (!user && !anonymousId) anonymousId = randomUUID()
  const identity = user ? `user:${user.id}` : `anonymous:${anonymousId}`
  const key = createActivityViewKey(activityId, identity)
  const now = Date.now()
  const history = parseActivityViewHistory(cookieStore.get(ACTIVITY_VIEW_HISTORY_COOKIE)?.value, now)

  if (recentRequests.size > 1000) {
    recentRequests.forEach((timestamp, requestKey) => {
      if (timestamp <= now - ACTIVITY_VIEW_WINDOW_MS) recentRequests.delete(requestKey)
    })
  }
  const recentlyRequested = (recentRequests.get(key) || 0) > now - ACTIVITY_VIEW_WINDOW_MS
  const shouldIncrement = !recentlyRequested && shouldCountActivityView(history, key, now)
  if (shouldIncrement) recentRequests.set(key, now)

  const updated = shouldIncrement
    ? await prisma.activity.updateMany({ where: { id: activityId, status: { in: ['PUBLISHED', 'CANCELLED'] } }, data: { viewCount: { increment: 1 } } })
    : null
  const activity = !shouldIncrement || updated?.count
    ? await prisma.activity.findFirst({ where: { id: activityId, status: { in: ['PUBLISHED', 'CANCELLED'] } }, select: { viewCount: true } })
    : null

  if (!activity) {
    if (shouldIncrement) recentRequests.delete(key)
    return NextResponse.json({ message: '活动不存在或不可用' }, { status: 404 })
  }

  const response = NextResponse.json({ viewCount: activity.viewCount, counted: shouldIncrement }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  response.cookies.set(ACTIVITY_VIEW_HISTORY_COOKIE, serializeActivityViewHistory(recordActivityView(history, key, now)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24,
  })
  if (!user && anonymousId && !cookieStore.get(ACTIVITY_VIEWER_COOKIE)) {
    response.cookies.set(ACTIVITY_VIEWER_COOKIE, anonymousId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }
  return response
}
