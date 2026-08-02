import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const body = await request.json().catch(() => null)
  const token = String(body?.registrationToken ?? '').trim()
  if (!token) return NextResponse.json({ message: '注册验证凭证缺失' }, { status: 400, headers: noStoreHeaders })

  const draft = await prisma.registrationDraft.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      nickname: true,
      email: true,
      phone: true,
      expiresAt: true,
      completedAt: true,
      emailVerifiedAt: true,
      EHospitalCheckSession: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, score: true, expiresAt: true } },
    },
  })
  if (!draft) return NextResponse.json({ message: '注册验证已失效，请重新填写注册资料', code: 'REGISTRATION_DRAFT_NOT_FOUND' }, { status: 410, headers: noStoreHeaders })

  const session = draft.EHospitalCheckSession[0] || null
  return NextResponse.json({
    draft: { nickname: draft.nickname, email: draft.email, phone: draft.phone },
    emailVerified: Boolean(draft.emailVerifiedAt),
    completed: Boolean(draft.completedAt),
    expired: draft.expiresAt <= new Date(),
    hospital: session
      ? { sessionId: session.id, status: session.status, score: session.score, expiresAt: session.expiresAt.toISOString() }
      : null,
  }, { headers: noStoreHeaders })
}
