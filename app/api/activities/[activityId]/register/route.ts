import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireUser, enforceApiRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { upsertNotificationWithDb } from '@/lib/notification-write'
import { activityRegistrationStateMessage, activityRegistrationSuccessNotificationKey, ActivityRegistrationError, getActivityRegistrationState, type ActivityRegistrationState } from '@/lib/activity-registration'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/

function stateError(state: ActivityRegistrationState) {
  if (state === 'AVAILABLE') throw new Error('活动报名状态不一致')
  return new ActivityRegistrationError(state, activityRegistrationStateMessage(state), 409)
}

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin

  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/activities/register',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  }, '报名操作过于频繁，请稍后再试')
  if (limited) return limited

  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialize all capacity decisions for one activity. The row lock makes
      // the count/create/update sequence safe under concurrent submissions.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
      if (!locked.length) throw new ActivityRegistrationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)

      const activity = await tx.activity.findUnique({
        where: { id: activityId },
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          registrationStartAt: true,
          registrationEndAt: true,
          publishedAt: true,
          signupLimit: true,
          signupCount: true,
        },
      })
      if (!activity) throw new ActivityRegistrationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)

      const existing = await tx.activityRegistration.findUnique({
        where: { activityId_userId: { activityId, userId: guard.user.id } },
        select: { id: true },
      })
      const registrationCount = await tx.activityRegistration.count({ where: { activityId } })
      const availability = getActivityRegistrationState(activity, registrationCount)

      if (!existing) {
        if (!availability.canRegister) throw stateError(availability.state)
        await tx.activityRegistration.create({ data: { activityId, userId: guard.user.id } })
      }

      const nextRegistrationCount = existing ? registrationCount : registrationCount + 1
      if (activity.signupCount !== nextRegistrationCount) {
        await tx.activity.update({ where: { id: activityId }, data: { signupCount: nextRegistrationCount }, select: { id: true } })
      }

      await upsertNotificationWithDb(tx, {
        where: { recipientId_key: { recipientId: guard.user.id, key: activityRegistrationSuccessNotificationKey(activityId, guard.user.id) } },
        update: {},
        create: {
          recipientId: guard.user.id,
          actorId: null,
          type: 'ACTIVITY',
          title: '活动报名成功',
          content: `你已成功报名「${activity.title}」`,
          link: `/activities/${activityId}`,
          key: activityRegistrationSuccessNotificationKey(activityId, guard.user.id),
        },
      }, {
        operation: 'activity-registration-success',
        userId: guard.user.id,
        activityFallback: true,
      })

      const nextAvailability = getActivityRegistrationState(activity, nextRegistrationCount)
      return {
        alreadyRegistered: Boolean(existing),
        registrationCount: nextRegistrationCount,
        registrationState: nextAvailability.state,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 })

    invalidateHomeDataCache()
    revalidatePath('/activities')
    revalidatePath(`/activities/${activityId}`)
    revalidatePath('/')
    emitRealtime(guard.user.id, 'notification')
    return NextResponse.json({
      ok: true,
      alreadyRegistered: result.alreadyRegistered,
      isRegistered: true,
      registrationCount: result.registrationCount,
      registrationState: result.registrationState,
      canRegister: false,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof ActivityRegistrationError) {
      return NextResponse.json({
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.code !== 'ACTIVITY_NOT_FOUND' ? { registrationState: error.code } : {}),
      }, { status: error.status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // A legacy writer may race this endpoint without taking the activity
      // lock. Treat the unique registration as an idempotent success.
      const existing = await prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId, userId: guard.user.id } }, select: { id: true } }).catch(() => null)
      if (existing) {
        const count = await prisma.activityRegistration.count({ where: { activityId } }).catch(() => null)
        if (count !== null) return NextResponse.json({ ok: true, alreadyRegistered: true, isRegistered: true, registrationCount: count, canRegister: false }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
      }
    }
    console.error('[activities.register]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, message: '报名失败，请稍后重试' }, { status: 500 })
  }
}
