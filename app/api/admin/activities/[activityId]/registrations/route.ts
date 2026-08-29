import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404, headers: privateHeaders })

  const search = new URL(request.url).searchParams
  const query = sanitizeText(search.get('q'), 120)
  const status = (search.get('status') || 'ALL').toUpperCase()
  const uid = Number.parseInt(query, 10)
  const where: Prisma.ActivityRegistrationWhereInput = {
    activityId,
    ...(status === 'CANCELLED'
      ? { status: 'CANCELLED' }
      : status === 'VERIFIED'
        ? { status: 'ACTIVE', verifiedAt: { not: null } }
        : status === 'ACTIVE'
          ? { status: 'ACTIVE' }
          : {}),
    ...(query ? {
      OR: [
        { User: { nickname: { contains: query } } },
        { User: { username: { contains: query } } },
        ...(Number.isInteger(uid) ? [{ User: { uid } }] : []),
      ],
    } : {}),
  }

  const [activity, registrations, total, activeCount, verifiedCount, cancelledCount] = await prisma.$transaction([
    prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        registrationFee: true,
        feeDescription: true,
        registrationStartAt: true,
        registrationEndAt: true,
        signupLimit: true,
        verificationMode: true,
        ActivityReward: {
          where: { type: 'BADGE', enabled: true },
          select: { Badge: { select: { id: true, name: true, code: true } } },
          take: 1,
        },
      },
    }),
    prisma.activityRegistration.findMany({
      where,
      orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: {
        id: true,
        status: true,
        registeredAt: true,
        cancelledAt: true,
        verifiedAt: true,
        verificationMethod: true,
        checkedInAt: true,
        checkInSource: true,
        paidRegistrationFee: true,
        LinkedMaterialRedemption: {
          select: { id: true, status: true, redeemCode: true, redeemedAt: true, material: { select: { title: true } } },
        },
        User: { select: { id: true, uid: true, username: true, nickname: true, avatarUrl: true } },
        Answers: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { questionId: true, questionTitle: true, value: true } },
      },
    }),
    prisma.activityRegistration.count({ where }),
    prisma.activityRegistration.count({ where: { activityId, status: 'ACTIVE' } }),
    prisma.activityRegistration.count({ where: { activityId, status: 'ACTIVE', verifiedAt: { not: null } } }),
    prisma.activityRegistration.count({ where: { activityId, status: 'CANCELLED' } }),
  ])
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404, headers: privateHeaders })

  return NextResponse.json({
    activity: {
      ...activity,
      startsAt: activity.startsAt?.toISOString() || null,
      endsAt: activity.endsAt?.toISOString() || null,
      registrationStartAt: activity.registrationStartAt?.toISOString() || null,
      registrationEndAt: activity.registrationEndAt?.toISOString() || null,
      reward: activity.ActivityReward[0]?.Badge || null,
    },
    registrations: registrations.map((registration) => ({
      ...registration,
      registeredAt: registration.registeredAt.toISOString(),
      cancelledAt: registration.cancelledAt?.toISOString() || null,
      verifiedAt: registration.verifiedAt?.toISOString() || null,
      checkedInAt: registration.checkedInAt?.toISOString() || null,
      paidRegistrationFee: registration.paidRegistrationFee,
      checkInSource: registration.checkInSource,
      linkedMaterialRedemption: registration.LinkedMaterialRedemption ? {
        id: registration.LinkedMaterialRedemption.id,
        title: registration.LinkedMaterialRedemption.material.title,
        status: registration.LinkedMaterialRedemption.status,
        redeemCode: registration.LinkedMaterialRedemption.redeemCode,
        redeemedAt: registration.LinkedMaterialRedemption.redeemedAt?.toISOString() || null,
      } : null,
      answers: registration.Answers.map((answer) => ({ ...answer, value: answer.value.startsWith('[') ? (() => { try { const parsed = JSON.parse(answer.value); return Array.isArray(parsed) ? parsed : answer.value } catch { return answer.value } })() : answer.value })),
    })),
    pagination: { total, limit: 200 },
    summary: { activeCount, verifiedCount, cancelledCount },
  }, { headers: privateHeaders })
}
