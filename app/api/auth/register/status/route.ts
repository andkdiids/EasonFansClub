import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRegistrationAvailabilityError, getRegistrationPolicy, serializeRegistrationAvailability, serializeRegistrationControlSettings } from '@/lib/registration'
import { rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export const dynamic = 'force-dynamic'

export async function GET() {
  const policy = await getRegistrationPolicy()
  const registrationControl = serializeRegistrationControlSettings(policy.registrationControl)
  return NextResponse.json({
    ok: true,
    data: serializeRegistrationAvailability(policy.registrationAvailability),
    closedTitle: registrationControl.closedTitle,
    closedMessage: registrationControl.closedMessage,
  }, { headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const policy = await getRegistrationPolicy()
  const availabilityError = getRegistrationAvailabilityError(policy.registrationAvailability)
  if (availabilityError) return NextResponse.json({ message: availabilityError.message, code: availabilityError.code, ...availabilityError.meta }, { status: availabilityError.status, headers: noStoreHeaders })

  const body = await request.json().catch(() => null)
  const token = String(body?.registrationToken ?? '').trim()
  if (!token) return NextResponse.json({ message: '注册验证凭证缺失' }, { status: 400, headers: noStoreHeaders })

  const draft = await prisma.registrationDraft.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      nickname: true,
      email: true,
      phone: true,
      acceptedAgreement: true,
      expiresAt: true,
      completedAt: true,
      emailVerifiedAt: true,
      EHospitalCheckSession: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, score: true, expiresAt: true } },
    },
  })
  if (!draft) return NextResponse.json({ message: '注册验证已失效，请重新填写注册资料', code: 'REGISTRATION_DRAFT_NOT_FOUND' }, { status: 410, headers: noStoreHeaders })

  const session = draft.EHospitalCheckSession[0] || null
  return NextResponse.json({
    draft: { nickname: draft.nickname, email: draft.email, phone: draft.phone, acceptedAgreement: draft.acceptedAgreement },
    emailVerified: Boolean(draft.emailVerifiedAt),
    completed: Boolean(draft.completedAt),
    expired: draft.expiresAt <= new Date(),
    hospital: session
      ? { sessionId: session.id, status: session.status, score: session.score, expiresAt: session.expiresAt.toISOString() }
      : null,
  }, { headers: noStoreHeaders })
}
