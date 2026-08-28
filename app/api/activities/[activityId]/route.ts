import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { getActivityRegistrationState } from '@/lib/activity-registration'
import { activityRegistrationSelect, getActivityRegistrationQuestions, serializeActivityRegistration } from '@/lib/activity-registration'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const [activity, viewer] = await Promise.all([
    prisma.activity.findFirst({
      where: { id: activityId, status: { in: ['PUBLISHED', 'CANCELLED'] } },
      select: activitySelect,
    }),
    getCurrentUser(),
  ])
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404 })

  const view = serializeActivityRow(activity)
  const [registration, questions] = await Promise.all([
    viewer
      ? prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId, userId: viewer.id } }, select: activityRegistrationSelect })
      : Promise.resolve(null),
    getActivityRegistrationQuestions(prisma, activityId),
  ])
  const availability = getActivityRegistrationState(view, view.signupCount)
  const isRegistered = registration?.status === 'ACTIVE'
  return NextResponse.json({
    activity: view,
    questions,
    registration: registration ? serializeActivityRegistration(registration) : null,
    registrationCount: view.signupCount,
    isRegistered,
    registrationStatus: registration?.status || null,
    registrationState: availability.state,
    canRegister: availability.canRegister && Boolean(viewer) && !isRegistered,
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
