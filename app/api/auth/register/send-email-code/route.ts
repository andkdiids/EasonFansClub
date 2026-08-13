import { NextResponse } from 'next/server'
import { sendRegistrationVerificationCode } from '@/lib/mail'
import { prisma } from '@/lib/prisma'
import { getRegistrationIdentityHash, createRegistrationCode, hashRegistrationCode, isHospitalOnlyDraft, REGISTRATION_CODE_TTL_MS } from '@/lib/registration-draft'
import { getEHospitalCheckConfig } from '@/lib/ehospital-check'
import { getRegistrationAvailabilityError, getRegistrationLimitEnabled, getRegistrationPolicy } from '@/lib/registration'
import { checkDailyRegistrationEmailCodeLimit, recordSuccessfulRegistrationEmailCodeSend } from '@/lib/registration-rate-limit'
import { getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { findActiveConflict } from '@/lib/users'
import { hashToken } from '@/lib/tokens'
import { normalizePhoneNumber } from '@/lib/phone-number'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function errorResponse(message: string, status: number, code: string, errors: Record<string, string> = {}, meta: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, message, code, errors, ...meta }, { status, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const policy = await getRegistrationPolicy()
  const availabilityError = getRegistrationAvailabilityError(policy.registrationAvailability)
  if (availabilityError) return errorResponse(availabilityError.message, availabilityError.status, availabilityError.code, {}, availabilityError.meta)

  const body = await request.json().catch(() => null)
  const registrationToken = normalizeText(body?.registrationToken)
  const requestedEmail = normalizeText(body?.email).toLowerCase()
  if (!registrationToken) return errorResponse('注册验证凭证缺失', 400, 'REGISTRATION_TOKEN_REQUIRED')
  if (requestedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
    return errorResponse('邮箱格式错误', 400, 'INVALID_EMAIL', { email: '邮箱格式错误' })
  }

  const draft = await prisma.registrationDraft.findUnique({ where: { tokenHash: hashToken(registrationToken) } })
  if (!draft || draft.completedAt) return errorResponse('注册验证已失效，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_NOT_FOUND')
  if (draft.expiresAt <= new Date()) return errorResponse('注册验证已过期，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_EXPIRED')
  if (isHospitalOnlyDraft(draft.nickname)) return errorResponse('请先填写注册资料', 409, 'REGISTRATION_DETAILS_REQUIRED', { form: '请先填写注册资料' })
  const draftPhone = normalizePhoneNumber(draft.phone)
  if (!draft.phone) return errorResponse('手机号格式错误', 400, 'INVALID_PHONE', { phone: '手机号格式错误' })
  if (!draftPhone) {
    return errorResponse('手机号格式错误', 400, 'INVALID_PHONE', { phone: '手机号格式错误' })
  }

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
  const phoneChanged = draft.phone !== draftPhone.e164
  if (emailChanged) {
    const duplicate = await findActiveConflict({ email })
    if (duplicate?.email === email) return errorResponse('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
  }

  const clientIp = getClientIp(request)
  let registrationLimitEnabled = false
  try {
    registrationLimitEnabled = await getRegistrationLimitEnabled()
    if (registrationLimitEnabled) {
      if (clientIp === 'unknown') {
        return errorResponse('暂时无法识别请求网络环境，请稍后重试', 503, 'REGISTRATION_IP_UNAVAILABLE')
      }
      const rate = await checkDailyRegistrationEmailCodeLimit(clientIp)
      if (rate.limited) {
        return errorResponse('今日该网络环境发送验证码次数已达上限，请明日再试。', 429, 'REGISTRATION_IP_DAILY_LIMIT_REACHED')
      }
    }
  } catch (error) {
    console.error('[send-email-code.rate-limit]', error)
    return errorResponse('注册限制服务暂时不可用，请稍后重试', 503, 'REGISTRATION_LIMIT_UNAVAILABLE')
  }

  const code = createRegistrationCode()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + REGISTRATION_CODE_TTL_MS)
  const updated = await prisma.registrationDraft.update({
    where: { id: draft.id },
    data: {
      email,
      phone: draftPhone.e164,
      identityHash: emailChanged || phoneChanged ? getRegistrationIdentityHash(email, draftPhone.e164) : draft.identityHash,
      emailCodeHash: hashRegistrationCode(registrationToken, 'EMAIL', code),
      emailCodeExpiresAt: expiresAt,
      emailVerifiedAt: emailChanged ? null : draft.emailVerifiedAt,
    },
  })

  try {
    const mailResult = await sendRegistrationVerificationCode(email, code)
    if (!mailResult.sent) {
      return errorResponse('邮件服务尚未配置，暂时无法发送验证码', 503, 'EMAIL_SERVICE_NOT_CONFIGURED')
    }
    if (registrationLimitEnabled) {
      try {
        await recordSuccessfulRegistrationEmailCodeSend(clientIp)
      } catch (error) {
        console.error('[send-email-code.rate-limit.record]', error)
        return errorResponse('注册限制服务暂时不可用，请稍后重试', 503, 'REGISTRATION_LIMIT_UNAVAILABLE')
      }
    }
    return NextResponse.json({
      ok: true,
      email: updated.email,
      emailVerified: Boolean(updated.emailVerifiedAt),
      emailSent: mailResult.sent,
      ...(process.env.NODE_ENV === 'production' ? {} : { devEmailCode: code }),
      expiresAt: expiresAt.toISOString(),
      message: `验证码已发送至：${email}`,
    }, { headers: noStoreHeaders })
  } catch (error) {
    console.error('[send-email-code]', error)
    if (error instanceof Error && error.message === 'TENCENT_EMAIL_NOT_CONFIGURED') {
      return errorResponse('邮件服务尚未配置，暂时无法发送验证码', 503, 'EMAIL_SERVICE_NOT_CONFIGURED')
    }
    return errorResponse('验证码发送失败，请稍后重试', 502, 'EMAIL_SEND_FAILED')
  }
}
