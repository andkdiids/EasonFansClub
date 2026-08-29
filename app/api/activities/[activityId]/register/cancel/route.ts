import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireUser, enforceApiRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { ActivityRegistrationError, syncActivitySignupCount } from '@/lib/activity-registration'
import { awardRegistrationFee } from '@/lib/registration-fee'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/activities/register/cancel',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  }, '取消报名操作过于频繁，请稍后再试')
  if (limited) return limited

  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
      if (!locked.length) throw new ActivityRegistrationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
      const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, startsAt: true, endsAt: true } })
      if (!activity) throw new ActivityRegistrationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
      const registration = await tx.activityRegistration.findUnique({
        where: { activityId_userId: { activityId, userId: guard.user.id } },
        select: { id: true, status: true, verifiedAt: true, paidRegistrationFee: true, linkedMaterialRedemptionId: true, LinkedMaterialRedemption: { select: { id: true, status: true, quantity: true, materialId: true } } },
      })
      if (!registration) throw new ActivityRegistrationError('REGISTRATION_NOT_FOUND', '你还没有报名这场活动', 404)
      if (registration.status === 'CANCELLED') return { alreadyCancelled: true, registrationCount: await syncActivitySignupCount(tx, activityId) }
      if (registration.verifiedAt) throw new ActivityRegistrationError('CANNOT_CANCEL', '已核销的报名不能取消', 409)
      const now = new Date()
      if ((activity.startsAt && activity.startsAt <= now) || (activity.endsAt && activity.endsAt < now)) throw new ActivityRegistrationError('CANNOT_CANCEL', '活动开始后不能取消报名或退款', 409)

      const linkedOrder = registration.LinkedMaterialRedemption
      if (linkedOrder) {
        await tx.$queryRaw`SELECT \`id\` FROM \`MaterialRedemptionOrder\` WHERE \`id\` = ${linkedOrder.id} FOR UPDATE`
        if (linkedOrder.status === 'REDEEMED') throw new ActivityRegistrationError('CANNOT_CANCEL', '绑定活动物料已核销，不能取消报名', 409)
        if (linkedOrder.status === 'SUCCESS') {
          const restored = await tx.materialRedemption.updateMany({
            where: { id: linkedOrder.materialId, stockRemaining: { lte: (await tx.materialRedemption.findUniqueOrThrow({ where: { id: linkedOrder.materialId }, select: { stockTotal: true } })).stockTotal - linkedOrder.quantity } },
            data: { stockRemaining: { increment: linkedOrder.quantity } },
          })
          if (restored.count !== 1) throw new ActivityRegistrationError('ACTIVITY_MATERIAL_UNAVAILABLE', '活动物料库存恢复失败，请联系管理员', 409)
          const cancelled = await tx.materialRedemptionOrder.updateMany({ where: { id: linkedOrder.id, status: 'SUCCESS' }, data: { status: 'CANCELLED', cancelledAt: now } })
          if (cancelled.count !== 1) throw new ActivityRegistrationError('CANNOT_CANCEL', '活动物料状态已发生变化，请刷新后重试', 409)
        } else if (!['CANCELLED'].includes(linkedOrder.status)) {
          throw new ActivityRegistrationError('CANNOT_CANCEL', '绑定活动物料当前不能取消', 409)
        }
      }

      if (registration.paidRegistrationFee > 0) {
        await awardRegistrationFee(tx, {
          userId: guard.user.id,
          requestedAmount: registration.paidRegistrationFee,
          action: 'ACTIVITY_REGISTRATION_REFUND',
          reason: `取消活动报名：${activity.title}`,
          businessKey: `activity-registration-refund:${registration.id}`,
          activityId,
          activityRegistrationId: registration.id,
          now,
        })
      }
      await tx.activityRegistration.update({ where: { id: registration.id }, data: { status: 'CANCELLED', cancelledAt: now }, select: { id: true } })
      return { alreadyCancelled: false, registrationCount: await syncActivitySignupCount(tx, activityId) }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 })

    invalidateHomeDataCache()
    revalidatePath('/activities')
    revalidatePath(`/activities/${activityId}`)
    revalidatePath('/')
    return NextResponse.json({ ok: true, alreadyCancelled: result.alreadyCancelled, isRegistered: false, registrationStatus: 'CANCELLED', registrationCount: result.registrationCount }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityRegistrationError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[activities.register.cancel]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'CANCEL_REGISTRATION_FAILED', message: '取消报名失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
