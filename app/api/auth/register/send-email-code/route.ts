import { NextResponse } from 'next/server'
import { sendRegistrationVerificationCode } from '@/lib/mail'
import { prisma } from '@/lib/prisma'
import { getRegistrationIdentityHash, createRegistrationCode, hashRegistrationCode, REGISTRATION_CODE_TTL_MS } from '@/lib/registration-draft'
import { getEHospitalCheckConfig } from '@/lib/ehospital-check'
import { consumeRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { findActiveConflict } from '@/lib/users'
import { hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function errorResponse(message: string, status: number, code: string, errors: Record<string, string> = {}) {
  return NextResponse.json({ message, code, errors }, { status, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const body = await request.json().catch(() => null)
  const registrationToken = normalizeText(body?.registrationToken)
  const requestedEmail = normalizeText(body?.email).toLowerCase()
  if (!registrationToken) return errorResponse('注册验证凭证缺失', 400, 'REGISTRATION_TOKEN_REQUIRED')
  if (requestedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
    return errorResponse('请输入有效邮箱', 400, 'INVALID_EMAIL', { email: '请输入有效邮箱' })
  }

  const draft = await prisma.registrationDraft.findUnique({ where: { tokenHash: hashToken(registrationToken) } })
  if (!draft || draft.completedAt) return errorResponse('注册验证已失效，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_NOT_FOUND')
  if (draft.expiresAt <= new Date()) return errorResponse('注册验证已过期，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_EXPIRED')

  const config = await getEHospitalCheckConfig()
  if (config.enabled) {
    const passedSession = await prisma.eHospitalCheckSession.findFirst({
      where: { registrationDraftId: draft.id, status: 'PASSED', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!passedSession) return errorResponse('请先完成并通过 E院体检', 409, 'HOSPITAL_CHECK_REQUIRED', { hospitalCheck: '请先完成并通过 E院体检' })
  }

  const email = requestedEmail || draft.email
  const emailChanged = email !== draft.email
  if (emailChanged) {
    const duplicate = await findActiveConflict({ email })
    if (duplicate?.email === email) return errorResponse('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
  }

  const rate = await consumeRateLimit(`registration-draft:${draft.id}`, 'register:email-code', 6, 10 * 60)
  if (rate.limited) {
    return NextResponse.json({ message: '验证码发送过于频繁，请稍后再试', retryAfter: rate.retryAfter }, { status: 429, headers: noStoreHeaders })
  }

  const code = createRegistrationCode()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + REGISTRATION_CODE_TTL_MS)
  const updated = await prisma.registrationDraft.update({
    where: { id: draft.id },
    data: {
      email,
      identityHash: emailChanged ? getRegistrationIdentityHash(email, draft.phone) : draft.identityHash,
      emailCodeHash: hashRegistrationCode(registrationToken, 'EMAIL', code),
      emailCodeExpiresAt: expiresAt,
      emailVerifiedAt: emailChanged ? null : draft.emailVerifiedAt,
    },
  })

  try {
    const mailResult = await sendRegistrationVerificationCode(email, code)
    return NextResponse.json({
      email: updated.email,
      emailVerified: Boolean(updated.emailVerifiedAt),
      emailSent: mailResult.sent,
      ...(process.env.NODE_ENV === 'production' ? {} : { devEmailCode: code }),
      expiresAt: expiresAt.toISOString(),
      message: `验证码已发送至：${email}`,
    }, { headers: noStoreHeaders })
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_SEND_NOT_CONFIGURED') {
      return errorResponse('邮件服务尚未配置，暂时无法发送验证码', 503, 'EMAIL_SERVICE_NOT_CONFIGURED')
    }
    return errorResponse('验证码发送失败，请稍后重试', 502, 'EMAIL_SEND_FAILED')
  }
}
