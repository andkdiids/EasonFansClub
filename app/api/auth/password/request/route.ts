import { NextResponse } from 'next/server'
import { sendPasswordResetLinkEmail } from '@/lib/mail'
import {
  buildPasswordResetUrl,
  createPasswordResetLinkToken,
  isValidPasswordResetEmail,
  normalizePasswordResetEmail,
  PASSWORD_RESET_LINK_MESSAGE,
} from '@/lib/password-reset-link'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function genericResponse() {
  return NextResponse.json({ message: PASSWORD_RESET_LINK_MESSAGE }, { headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const ipLimit = await consumeRateLimit(`ip:${getClientIp(request)}`, 'password-reset:link-request', 8, 60 * 60)
  if (ipLimit.limited) return NextResponse.json({ message: '发送过于频繁，请稍后再试', retryAfter: ipLimit.retryAfter }, { status: 429, headers: noStoreHeaders })

  const body = await request.json().catch(() => null)
  const email = normalizePasswordResetEmail(body?.email)
  if (!isValidPasswordResetEmail(email)) {
    return NextResponse.json({ message: '请输入有效邮箱', errors: { email: '请输入有效邮箱' } }, { status: 400, headers: noStoreHeaders })
  }

  const emailLimit = await consumeRateLimit(`email:${hashToken(email)}`, 'password-reset:link-request', 3, 60 * 60)
  if (emailLimit.limited) return genericResponse()

  const user = await prisma.user.findFirst({
    where: { email, isDeleted: false, status: 'ACTIVE' },
    select: { id: true, email: true },
  })
  if (!user?.email) return genericResponse()

  const now = new Date()
  const generated = createPasswordResetLinkToken(now)
  let recordId = ''
  try {
    const record = await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, type: 'EMAIL_LINK', stage: 'RESET_TOKEN', consumedAt: null },
        data: { consumedAt: now },
      })
      return tx.passwordResetToken.create({
        data: {
          userId: user.id,
          type: 'EMAIL_LINK',
          stage: 'RESET_TOKEN',
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
        },
      })
    })
    recordId = record.id
    const sent = await sendPasswordResetLinkEmail(user.email, buildPasswordResetUrl(generated.token))
    if (!sent.sent) throw new Error('TENCENT_EMAIL_NOT_CONFIGURED')
  } catch (error) {
    if (recordId) await prisma.passwordResetToken.deleteMany({ where: { id: recordId } }).catch(() => undefined)
    console.error('[auth.password.request]', error)
    return NextResponse.json({ message: '邮件服务暂时不可用，请稍后再试' }, { status: 503, headers: noStoreHeaders })
  }

  return genericResponse()
}
