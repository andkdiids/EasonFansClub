import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { hashSecurityQuestions, parseSecurityQuestions, validateSecurityQuestions } from '@/lib/account-security'
import { hashPassword, verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { getHospitalOnlyDraftValues, getRegistrationIdentityHash, isHospitalOnlyDraft, REGISTRATION_DRAFT_TTL_MS } from '@/lib/registration-draft'
import { getRegistrationAvailabilityError, getRegistrationPolicy } from '@/lib/registration'
import { validateRegistrationPasswordFields } from '@/lib/registration-password'
import { getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { findActiveConflict, findLoginAccountConflict } from '@/lib/users'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { getLoginAccountDisplay, validateLoginAccountValue } from '@/lib/login-account'
import { DEFAULT_PHONE_COUNTRY, getPhoneLookupVariants, isSupportedPhoneCountry, normalizePhoneNumber } from '@/lib/phone-number'
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

  if (body?.hospitalOnly === true) {
    if (!policy.ehospitalCheckEnabled) return errorResponse('E院体检当前未开放', 403, 'EHOSPITAL_CHECK_DISABLED')
    const turnstile = await verifyTurnstileToken(body?.turnstileToken, request)
    if (!turnstile.success) return errorResponse(turnstile.message || '人机验证失败', 400, 'TURNSTILE_FAILED', { turnstileToken: turnstile.message || '人机验证失败' })

    const clientIp = getClientIp(request)
    const identityHash = getRegistrationIdentityHash('hospital-only', clientIp)
    const draftToken = createPlainToken(32)
    const placeholder = getHospitalOnlyDraftValues(identityHash)
    const passwordHash = await hashPassword(createPlainToken(32))
    const now = new Date()
    const draft = await prisma.registrationDraft.create({
      data: {
        tokenHash: hashToken(draftToken),
        registrationType: 'EMAIL',
        ...placeholder,
        passwordHash,
        securityQuestions: Prisma.JsonNull,
        acceptedAgreement: false,
        emailCodeHash: null,
        emailCodeExpiresAt: null,
        emailVerifiedAt: null,
        expiresAt: new Date(now.getTime() + REGISTRATION_DRAFT_TTL_MS),
      },
    })

    return NextResponse.json({
      registrationToken: draftToken,
      expiresAt: draft.expiresAt.toISOString(),
      email: '',
      phone: '',
      emailVerified: false,
      hospitalOnly: true,
      message: '请先完成 E院体检，体检通过后填写注册资料',
    }, { headers: noStoreHeaders })
  }

  const rawNickname = body?.nickname || body?.username
  const suppliedRegistrationToken = normalizeText(body?.registrationToken)
  const nickname = getLoginAccountDisplay(rawNickname)
  const accountValidation = validateLoginAccountValue(rawNickname)
  const usernameNormalized = accountValidation.usernameNormalized
  const email = normalizeText(body?.email).toLowerCase()
  const rawPhone = normalizeText(body?.phone)
  const requestedPhoneCountry = isSupportedPhoneCountry(body?.phoneCountry) ? body.phoneCountry : DEFAULT_PHONE_COUNTRY
  const normalizedPhone = normalizePhoneNumber(rawPhone, requestedPhoneCountry)
  const phone = normalizedPhone?.e164 || rawPhone.replace(/\s+/g, '')
  const password = normalizeText(body?.password)
  const confirmPassword = normalizeText(body?.confirmPassword)
  const acceptedAgreement = Boolean(body?.acceptedAgreement)
  const securityQuestions = parseSecurityQuestions(body?.securityQuestions)
  const errors: Record<string, string> = {}

  if (!nickname || unicodeLength(nickname) < 2 || unicodeLength(nickname) > 16) errors.nickname = '用户名格式不正确'
  else if (accountValidation.error) errors.nickname = accountValidation.error
  if (!rawPhone) errors.phone = '手机号格式错误'
  else if (!normalizedPhone) errors.phone = '手机号格式错误'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '邮箱格式错误'
  Object.assign(errors, validateRegistrationPasswordFields(password, confirmPassword))
  if (!acceptedAgreement) errors.acceptedAgreement = '请先勾选用户协议'
  if (policy.requireSecurityQuestionsForNewUsers) {
    const securityError = validateSecurityQuestions(securityQuestions)
    if (securityError) errors.securityQuestions = securityError
  }
  if (Object.keys(errors).length) return errorResponse('请检查注册信息', 400, 'INVALID_REGISTER_FIELDS', errors)

  const turnstile = await verifyTurnstileToken(body?.turnstileToken, request)
  if (!turnstile.success) return errorResponse(turnstile.message || '人机验证失败', 400, 'TURNSTILE_FAILED', { turnstileToken: turnstile.message || '人机验证失败' })

  const existingHospitalDraft = suppliedRegistrationToken
    ? await prisma.registrationDraft.findUnique({
      where: { tokenHash: hashToken(suppliedRegistrationToken) },
      select: { id: true, nickname: true, completedAt: true, expiresAt: true },
    })
    : null
  if (suppliedRegistrationToken && (!existingHospitalDraft || existingHospitalDraft.completedAt || existingHospitalDraft.expiresAt <= new Date())) {
    return errorResponse('注册验证已过期，请重新开始 E院体检', 410, 'REGISTRATION_DRAFT_EXPIRED')
  }
  if (suppliedRegistrationToken && existingHospitalDraft && !isHospitalOnlyDraft(existingHospitalDraft.nickname)) {
    return errorResponse('注册验证状态不允许重新保存资料，请重新开始注册', 409, 'REGISTRATION_DRAFT_INVALID')
  }

  const phoneVariants = getPhoneLookupVariants(phone, normalizedPhone?.country || requestedPhoneCountry)
  const draftIdentityFilter = [{ email }, ...phoneVariants.map((phoneValue) => ({ phone: phoneValue }))]
  const [duplicate, accountDuplicate, recoverableDraft, existingDrafts] = await Promise.all([
    findActiveConflict({ phone: phone || null, email }),
    findLoginAccountConflict(usernameNormalized),
    prisma.registrationDraft.findFirst({
      where: {
        email,
        phone: { in: phoneVariants },
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
  if (duplicate?.phone && phoneVariants.includes(duplicate.phone)) return errorResponse('手机号已被注册', 409, 'PHONE_ALREADY_EXISTS', { phone: '手机号已被注册' })
  if (duplicate?.email === email) return errorResponse('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
  if (accountDuplicate) return errorResponse('该登录账号已被使用，账号不区分大小写', 409, 'USERNAME_ALREADY_EXISTS', { nickname: '该登录账号已被使用，账号不区分大小写' })
  if (!existingHospitalDraft && recoverableDraft && (await verifyPassword(password, recoverableDraft.passwordHash)).valid) {
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
  const passwordHash = await hashPassword(password)
  const hashedSecurityQuestions = policy.requireSecurityQuestionsForNewUsers
    ? await hashSecurityQuestions(securityQuestions)
    : []

  if (existingHospitalDraft) {
    const now = new Date()
    const updated = await prisma.registrationDraft.update({
      where: { id: existingHospitalDraft.id },
      data: {
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
    const hospital = await prisma.eHospitalCheckSession.findFirst({
      where: { registrationDraftId: updated.id, status: 'PASSED', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, score: true, expiresAt: true },
    })
    return NextResponse.json({
      registrationToken: suppliedRegistrationToken,
      expiresAt: updated.expiresAt.toISOString(),
      email: updated.email,
      phone: updated.phone,
      emailVerified: false,
      draft: { nickname: updated.nickname, email: updated.email, phone: updated.phone, acceptedAgreement: updated.acceptedAgreement },
      hospital: hospital ? { sessionId: hospital.id, status: hospital.status, score: hospital.score, expiresAt: hospital.expiresAt.toISOString() } : null,
      message: '注册资料已保存，请发送邮箱验证码',
    }, { headers: noStoreHeaders })
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
