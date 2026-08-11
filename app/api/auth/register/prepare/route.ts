import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { hashSecurityQuestions, parseSecurityQuestions, validateSecurityQuestions } from '@/lib/account-security'
import { hashPassword, verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { getRegistrationIdentityHash, REGISTRATION_DRAFT_TTL_MS } from '@/lib/registration-draft'
import { getRegistrationAvailabilityError, getRegistrationPolicy } from '@/lib/registration'
import { rejectInvalidRequestOrigin } from '@/lib/security'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { findActiveConflict, findLoginAccountConflict } from '@/lib/users'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { getLoginAccountDisplay, validateLoginAccountValue } from '@/lib/login-account'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function errorResponse(message: string, status: number, code: string, errors: Record<string, string> = {}, meta: Record<string, unknown> = {}) {
  return NextResponse.json({ message, code, errors, ...meta }, { status, headers: noStoreHeaders })
}

function unicodeLength(value: string) {
  return Array.from(value).length
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const body = await request.json().catch(() => null)
  const policy = await getRegistrationPolicy()
  const availabilityError = getRegistrationAvailabilityError(policy.registrationAvailability)
  if (availabilityError) return errorResponse(availabilityError.message, availabilityError.status, availabilityError.code, {}, availabilityError.meta)

  // The registration flow now always uses email verification. Phone is required
  // as a login/recovery field and is deliberately not a verification channel.
  if (policy.registrationClosed || !policy.allowEmailRegistration) {
    return errorResponse('当前暂未开放邮箱验证注册', 403, 'EMAIL_REGISTRATION_DISABLED')
  }

  const rawNickname = body?.nickname || body?.username
  const nickname = getLoginAccountDisplay(rawNickname)
  const accountValidation = validateLoginAccountValue(rawNickname)
  const usernameNormalized = accountValidation.usernameNormalized
  const email = normalizeText(body?.email).toLowerCase()
  const phone = normalizeText(body?.phone).replace(/\s+/g, '')
  const password = normalizeText(body?.password)
  const confirmPassword = normalizeText(body?.confirmPassword)
  const acceptedAgreement = Boolean(body?.acceptedAgreement)
  const securityQuestions = parseSecurityQuestions(body?.securityQuestions)
  const errors: Record<string, string> = {}

  if (!nickname || unicodeLength(nickname) < 2 || unicodeLength(nickname) > 16 || accountValidation.error) {
    errors.nickname = '用户名 / 昵称需要 2-16 个字符'
  }
  if (!phone) return errorResponse('手机号不能为空', 400, 'PHONE_REQUIRED', { phone: '手机号不能为空' })
  if (!/^1\d{10}$/.test(phone)) errors.phone = '请输入 11 位中国大陆手机号'
  if (!email) errors.email = '请填写邮箱'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '请输入有效邮箱'
  if (!password || password.length < 8) errors.password = '密码至少需要 8 位'
  if (confirmPassword !== password) errors.confirmPassword = '两次输入的密码不一致'
  if (!acceptedAgreement) errors.acceptedAgreement = '请先勾选用户协议'
  if (policy.requireSecurityQuestionsForNewUsers) {
    const securityError = validateSecurityQuestions(securityQuestions)
    if (securityError) errors.securityQuestions = securityError
  }
  if (Object.keys(errors).length) return errorResponse('请检查注册信息', 400, 'INVALID_REGISTER_FIELDS', errors)

  const turnstile = await verifyTurnstileToken(body?.turnstileToken, request)
  if (!turnstile.success) return errorResponse(turnstile.message || '人机验证失败', 400, 'TURNSTILE_FAILED', { turnstileToken: turnstile.message || '人机验证失败' })

  const draftIdentityFilter = [{ email }, { phone }]
  const [duplicate, accountDuplicate, recoverableDraft, existingDrafts] = await Promise.all([
    findActiveConflict({ phone: phone || null, email }),
    findLoginAccountConflict(usernameNormalized),
    prisma.registrationDraft.findFirst({
      where: {
        email,
        phone,
        completedAt: null,
        expiresAt: { gt: new Date() },
        EHospitalCheckSession: { some: { status: 'PASSED' } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tokenHash: true,
        nickname: true,
        email: true,
        phone: true,
        passwordHash: true,
        expiresAt: true,
        emailVerifiedAt: true,
        EHospitalCheckSession: {
          where: { status: 'PASSED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, score: true, expiresAt: true },
        },
      },
    }),
    prisma.registrationDraft.findMany({
      where: { completedAt: null, expiresAt: { gt: new Date() }, OR: draftIdentityFilter },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ])
  if (duplicate?.phone && duplicate.phone === phone) return errorResponse('手机号已被注册', 409, 'PHONE_ALREADY_EXISTS', { phone: '手机号已被注册' })
  if (duplicate?.email === email) return errorResponse('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
  if (accountDuplicate) return errorResponse('该登录账号已被使用，账号不区分大小写', 409, 'USERNAME_ALREADY_EXISTS', { nickname: '该登录账号已被使用，账号不区分大小写' })
  if (recoverableDraft && (await verifyPassword(password, recoverableDraft.passwordHash)).valid) {
    const recoveredToken = createPlainToken(32)
    const rotated = await prisma.registrationDraft.updateMany({
      where: { id: recoverableDraft.id, tokenHash: recoverableDraft.tokenHash, completedAt: null, expiresAt: { gt: new Date() } },
      data: { tokenHash: hashToken(recoveredToken) },
    })
    const hospital = recoverableDraft.EHospitalCheckSession[0]
    if (rotated.count === 1 && hospital) {
      return NextResponse.json({
        registrationToken: recoveredToken,
        expiresAt: recoverableDraft.expiresAt.toISOString(),
        email: recoverableDraft.email,
        phone: recoverableDraft.phone,
        emailVerified: Boolean(recoverableDraft.emailVerifiedAt),
        recovered: true,
        draft: {
          nickname: recoverableDraft.nickname,
          email: recoverableDraft.email,
          phone: recoverableDraft.phone,
          acceptedAgreement: true,
        },
        hospital: {
          sessionId: hospital.id,
          status: hospital.status,
          score: hospital.score,
          expiresAt: hospital.expiresAt.toISOString(),
        },
        message: '已恢复此前通过的 E院体检，请继续邮箱验证',
      }, { headers: noStoreHeaders })
    }
  }
  const oldDraftIds = existingDrafts.map(({ id }) => id)
  if (oldDraftIds.length) {
    const invalidatedAt = new Date()
    await prisma.registrationDraft.updateMany({
      where: { id: { in: oldDraftIds }, completedAt: null, expiresAt: { gt: invalidatedAt } },
      data: { expiresAt: invalidatedAt },
    })
    console.info('[auth.register.prepare] superseded old drafts', {
      draftCount: oldDraftIds.length,
      reason: 'new registration flow started',
    })
  }
  const draftToken = createPlainToken(32)
  const passwordHash = await hashPassword(password)
  const hashedSecurityQuestions = policy.requireSecurityQuestionsForNewUsers
    ? await hashSecurityQuestions(securityQuestions)
    : []
  const now = new Date()
  const draft = await prisma.registrationDraft.create({
    data: {
      tokenHash: hashToken(draftToken),
      registrationType: 'EMAIL',
      username: nickname,
      usernameNormalized,
      nickname,
      email,
      phone,
      passwordHash,
      securityQuestions: hashedSecurityQuestions.length ? hashedSecurityQuestions : Prisma.JsonNull,
      acceptedAgreement,
      identityHash: getRegistrationIdentityHash(email, phone),
      emailCodeHash: null,
      emailCodeExpiresAt: null,
      emailVerifiedAt: null,
      expiresAt: new Date(now.getTime() + REGISTRATION_DRAFT_TTL_MS),
    },
  })

  console.info('[auth.register.prepare] draft created or renewed', {
    draftId: draft.id,
    tokenExists: Boolean(draftToken),
    expiresAt: draft.expiresAt.toISOString(),
  })

  return NextResponse.json({
    registrationToken: draftToken,
    expiresAt: draft.expiresAt.toISOString(),
    email: draft.email,
    phone: draft.phone,
    emailVerified: false,
    message: '注册资料已保存，请开始 E院体检',
  }, { headers: noStoreHeaders })
}
