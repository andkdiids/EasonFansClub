import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireUser, enforceApiRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { upsertNotificationWithDb } from '@/lib/notification-write'
import {
  activityRegistrationSelect,
  activityRegistrationStateMessage,
  activityRegistrationSuccessNotificationKey,
  ActivityRegistrationError,
  countActiveActivityRegistrations,
  generateActivityRegistrationLifecycleKey,
  generateActivityRegistrationToken,
  getActivityRegistrationQuestions,
  getActivityRegistrationState,
  serializeActivityRegistration,
  syncActivitySignupCount,
  validateRegistrationAnswers,
  type ActivityRegistrationState,
} from '@/lib/activity-registration'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function stateError(state: ActivityRegistrationState) {
  if (state === 'AVAILABLE') throw new Error('活动报名状态不一致')
  return new ActivityRegistrationError(state, activityRegistrationStateMessage(state), 409)
}

function bodyRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })
  const body = bodyRecord(await request.json().catch(() => null))

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
      if (!locked.length) throw new ActivityRegistrationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)

      const activity = await tx.activity.findUnique({
        where: { id: activityId },
        select: { id: true, title: true, status: true, registrationStartAt: true, registrationEndAt: true, signupLimit: true },
      })
      if (!activity) throw new ActivityRegistrationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)

      const existing = await tx.activityRegistration.findUnique({
        where: { activityId_userId: { activityId, userId: guard.user.id } },
        select: activityRegistrationSelect,
      })
      const registrationCount = await countActiveActivityRegistrations(tx, activityId)

      // Retries after a successful request are idempotent and do not require
      // the client to resubmit answers.
      if (existing?.status === 'ACTIVE') {
        const availability = getActivityRegistrationState(activity, registrationCount)
        return {
          alreadyRegistered: true,
          registrationCount,
          registrationState: availability.state,
          registration: serializeActivityRegistration(existing),
        }
      }

      const availability = getActivityRegistrationState(activity, registrationCount)
      if (!availability.canRegister) throw stateError(availability.state)
      if (body.confirm !== true) throw new ActivityRegistrationError('CONFIRMATION_REQUIRED', '请确认报名信息后继续', 400)

      const questions = await getActivityRegistrationQuestions(tx, activityId)
      const answers = validateRegistrationAnswers(questions, body.answers)
      if (!answers.valid) throw new ActivityRegistrationError('INVALID_ANSWERS', answers.message, 400)

      const now = new Date()
      const token = generateActivityRegistrationToken()
      const lifecycleKey = generateActivityRegistrationLifecycleKey()
      const registration = existing
        ? await tx.activityRegistration.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', registeredAt: now, cancelledAt: null, verifiedAt: null, verifiedById: null, verificationMethod: null, checkedInAt: null, verificationToken: token },
            select: { id: true },
          })
        : await tx.activityRegistration.create({
            data: { activityId, userId: guard.user.id, status: 'ACTIVE', registeredAt: now, verificationToken: token },
            select: { id: true },
          })

      await tx.activityRegistrationAnswer.deleteMany({ where: { registrationId: registration.id } })
      if (answers.value.length) await tx.activityRegistrationAnswer.createMany({
        data: answers.value.map((answer) => ({ registrationId: registration.id, questionId: answer.questionId, questionTitle: answer.questionTitle, value: answer.value })),
      })

      const nextRegistrationCount = await syncActivitySignupCount(tx, activityId)
      const notificationKey = activityRegistrationSuccessNotificationKey(activityId, guard.user.id, registration.id, lifecycleKey)
      await upsertNotificationWithDb(tx, {
        where: { recipientId_key: { recipientId: guard.user.id, key: notificationKey } },
        update: {},
        create: {
          recipientId: guard.user.id,
          actorId: null,
          type: 'ACTIVITY',
          title: '活动报名成功',
          content: `你已成功报名「${activity.title}」`,
          link: `/activities/${activityId}`,
          key: notificationKey,
        },
      }, { operation: 'activity-registration-success', userId: guard.user.id })

      const saved = await tx.activityRegistration.findUnique({ where: { id: registration.id }, select: activityRegistrationSelect })
      if (!saved) throw new ActivityRegistrationError('REGISTRATION_NOT_FOUND', '报名记录保存失败', 500)
      const nextAvailability = getActivityRegistrationState(activity, nextRegistrationCount)
      return {
        alreadyRegistered: false,
        registrationCount: nextRegistrationCount,
        registrationState: nextAvailability.state,
        registration: serializeActivityRegistration(saved),
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
      isRegistered: result.registration.status === 'ACTIVE',
      registrationStatus: result.registration.status,
      registration: result.registration,
      registrationCount: result.registrationCount,
      registrationState: result.registrationState,
      canRegister: false,
    }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityRegistrationError) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message, ...(error.code !== 'ACTIVITY_NOT_FOUND' ? { registrationState: error.code } : {}) }, { status: error.status, headers: privateHeaders })
    }
    console.error('[activities.register]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'REGISTRATION_FAILED', message: '报名失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
