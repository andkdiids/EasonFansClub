import { Prisma, type UserRole } from '@prisma/client'
import { NextResponse } from 'next/server'
import { createSessionToken } from '@/lib/auth'
import { authCookieName, getSessionCookieOptions } from '@/lib/auth-cookie'
import { appendLegacyHostCookieDeletion } from '@/lib/auth-session-cookie'
import { syncUserAchievements } from '@/lib/achievements'
import { chooseDefaultAvatar } from '@/lib/default-avatars'
import { getEHospitalCheckConfig } from '@/lib/ehospital-check'
import { getLoginAccountDisplay, validateLoginAccountValue } from '@/lib/login-account'
import { MySqlAdvisoryLockBusyError, createMySqlAdvisoryLockName, withMySqlAdvisoryLocks } from '@/lib/mysql-advisory-lock'
import { verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { isHospitalOnlyDraft } from '@/lib/registration-draft'
import { getRegistrationAvailabilityError, getRegistrationPolicy } from '@/lib/registration'
import { validateRegistrationPasswordFields } from '@/lib/registration-password'
import { rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'
import { MAX_UID } from '@/lib/uid'
import { findActiveConflict, findLoginAccountConflict } from '@/lib/users'
import { DEFAULT_PHONE_COUNTRY, getPhoneLookupVariants, isSupportedPhoneCountry, normalizePhoneNumber } from '@/lib/phone-number'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

class RegistrationConflictError extends Error {
  constructor(readonly field: 'email' | 'phone' | 'username') {
    super(`DUPLICATE_${field.toUpperCase()}`)
    this.name = 'RegistrationConflictError'
  }
}
function jsonError(message: string, status: number, code: string, errors: Record<string, string> = {}, meta: Record<string, unknown> = {}) {
  return NextResponse.json({ message, code, errors, ...meta }, { status, headers: noStoreHeaders })
}

function unicodeLength(value: string) {
  return Array.from(value).length
}

function parseStoredSecurityQuestions(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    return typeof row.question === 'string' && typeof row.answerHash === 'string' && typeof row.sortOrder === 'number'
      ? { question: row.question, answerHash: row.answerHash, sortOrder: row.sortOrder }
      : []
  })
}

async function authenticatedResponse(
  request: Request,
  user: { id: string; uid: number; username: string; nickname: string; role: UserRole },
  status: number,
  extra: Record<string, unknown> = {},
) {
  const sessionUser = {
    id: user.id,
    uid: user.uid,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
  }
  const token = await createSessionToken(sessionUser)
  const response = NextResponse.json({ user: sessionUser, registrationType: 'EMAIL', ...extra }, { status, headers: noStoreHeaders })
  const cookieOptions = getSessionCookieOptions(request)
  response.cookies.set(authCookieName, token, cookieOptions)
  if (cookieOptions.domain) appendLegacyHostCookieDeletion(response, request)
  return response
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  try {
    const body = await request.json().catch(() => null)
    const policy = await getRegistrationPolicy()
    const availabilityError = getRegistrationAvailabilityError(policy.registrationAvailability)
    if (availabilityError) return jsonError(availabilityError.message, availabilityError.status, availabilityError.code, {}, availabilityError.meta)

    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || ''
    const idempotencyKeyHash = idempotencyKey.length >= 16 && idempotencyKey.length <= 128 ? hashToken(idempotencyKey) : null
    if (idempotencyKeyHash) {
      const replayUser = await prisma.user.findUnique({
        where: { registrationIdempotencyKeyHash: idempotencyKeyHash },
        select: { id: true, uid: true, username: true, nickname: true, role: true },
      })
      if (replayUser) return authenticatedResponse(request, replayUser, 200, { message: '注册已完成，正在进入私家E院', idempotentReplay: true })
    }

    if (policy.registrationClosed || !policy.allowEmailRegistration) {
      return jsonError('当前暂未开放邮箱验证注册', 403, 'EMAIL_REGISTRATION_DISABLED')
    }

    const registrationToken = normalizeText(body?.registrationToken)
    if (!registrationToken) return jsonError('请先完成 E院体检和邮箱验证', 409, 'REGISTRATION_VERIFICATION_REQUIRED', { form: '请先完成 E院体检和邮箱验证' })
    const draft = await prisma.registrationDraft.findUnique({ where: { tokenHash: hashToken(registrationToken) } })
    if (!draft || draft.completedAt) return jsonError('注册验证已失效，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_NOT_FOUND', { form: '注册验证已失效，请重新填写注册资料' })
    if (draft.expiresAt <= new Date()) return jsonError('注册验证已过期，请重新填写注册资料', 410, 'REGISTRATION_DRAFT_EXPIRED', { form: '注册验证已过期，请重新填写注册资料' })
    if (isHospitalOnlyDraft(draft.nickname)) return jsonError('请先填写注册资料', 409, 'REGISTRATION_DETAILS_REQUIRED', { form: '请先填写注册资料' })
    const requestedPhoneCountry = isSupportedPhoneCountry(body?.phoneCountry) ? body.phoneCountry : DEFAULT_PHONE_COUNTRY
    const rawSubmittedPhone = normalizeText(body?.phone)
    const submittedPhone = normalizePhoneNumber(rawSubmittedPhone, requestedPhoneCountry)
    const draftPhone = normalizePhoneNumber(draft.phone, requestedPhoneCountry)
    if (!rawSubmittedPhone || !draft.phone) return jsonError('手机号格式错误', 400, 'INVALID_PHONE', { phone: '手机号格式错误' })
    if (!submittedPhone || !draftPhone) return jsonError('手机号格式错误', 400, 'INVALID_PHONE', { phone: '手机号格式错误' })
    if (submittedPhone.e164 !== draftPhone.e164) return jsonError('注册手机号已变化，请重新开始验证', 400, 'PHONE_CHANGED', { phone: '注册手机号已变化，请重新开始验证' })
    if (!draft.emailVerifiedAt) return jsonError('请先完成邮箱验证码验证', 409, 'EMAIL_VERIFICATION_REQUIRED', { emailCode: '请先完成邮箱验证码验证' })

    const hospitalConfig = await getEHospitalCheckConfig()
    if (hospitalConfig.enabled) {
      const hospitalSession = await prisma.eHospitalCheckSession.findFirst({
        where: { registrationDraftId: draft.id, status: 'PASSED', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (!hospitalSession) return jsonError('请先完成并通过 E院体检', 409, 'HOSPITAL_CHECK_REQUIRED', { hospitalCheck: '请先完成并通过 E院体检' })
    }

    const username = draft.username
    const accountValidation = validateLoginAccountValue(username)
    const usernameNormalized = accountValidation.usernameNormalized
    const nickname = getLoginAccountDisplay(body?.nickname || username)
    const submittedAccountValidation = validateLoginAccountValue(nickname)
    const email = draft.email
    const phone = draftPhone.e164
    const phoneVariants = getPhoneLookupVariants(phone, draftPhone.country)
    const password = normalizeText(body?.password)
    const confirmPassword = normalizeText(body?.confirmPassword)
    const errors: Record<string, string> = {}
    if (!nickname || unicodeLength(nickname) < 2 || unicodeLength(nickname) > 16) errors.nickname = '用户名格式不正确'
    else if (submittedAccountValidation.error) errors.nickname = submittedAccountValidation.error
    else if (accountValidation.error || nickname !== draft.nickname) errors.nickname = '注册资料已变化，请重新开始验证'
    if (body?.email && normalizeText(body.email).toLowerCase() !== email) errors.email = '注册邮箱已变化，请重新发送验证码'
    Object.assign(errors, validateRegistrationPasswordFields(password, confirmPassword))
    if (!errors.password && password && !(await verifyPassword(password, draft.passwordHash)).valid) errors.password = '注册资料已变化，请重新开始验证'
    if (Object.keys(errors).length) return jsonError('请检查注册信息', 400, 'INVALID_REGISTER_FIELDS', errors)

    const [duplicate, accountDuplicate] = await Promise.all([
      findActiveConflict({ phone: phone || null, email }),
      findLoginAccountConflict(usernameNormalized),
    ])
    if (duplicate?.phone && phoneVariants.includes(duplicate.phone)) return jsonError('手机号已被注册', 409, 'PHONE_ALREADY_EXISTS', { phone: '手机号已被注册' })
    if (duplicate?.email === email) return jsonError('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
    if (accountDuplicate) return jsonError('该登录账号已被使用，账号不区分大小写', 409, 'USERNAME_ALREADY_EXISTS', { nickname: '该登录账号已被使用，账号不区分大小写' })

    const storedSecurityQuestions = parseStoredSecurityQuestions(draft.securityQuestions)

    const registrationLockNames = [
      createMySqlAdvisoryLockName('registration:email', email),
      createMySqlAdvisoryLockName('registration:phone', phone),
      createMySqlAdvisoryLockName('registration:username', draft.usernameNormalized),
    ]
    const user = await prisma.$transaction(async (tx) => withMySqlAdvisoryLocks(
      tx,
      registrationLockNames,
      async () => {
      const concurrentDuplicate = await tx.user.findFirst({
        where: {
          status: 'ACTIVE',
          isDeleted: false,
          OR: [{ email }, ...phoneVariants.map((phoneValue) => ({ phone: phoneValue }))],
        },
        select: { email: true, phone: true },
      })
      if (concurrentDuplicate?.email === email) throw new RegistrationConflictError('email')
      if (concurrentDuplicate?.phone && phoneVariants.includes(concurrentDuplicate.phone)) throw new RegistrationConflictError('phone')
      const concurrentUsername = await tx.user.findUnique({ where: { usernameNormalized: draft.usernameNormalized }, select: { id: true } })
      if (concurrentUsername) throw new RegistrationConflictError('username')

      const defaultAvatarUrl = await chooseDefaultAvatar(tx)
      const created = await tx.user.create({
        data: {
          username,
          usernameNormalized: draft.usernameNormalized,
          nickname: draft.nickname,
          email,
          phone: phone || null,
          emailVerifiedAt: draft.emailVerifiedAt,
          verificationStatus: 'VERIFIED',
          passwordHash: draft.passwordHash,
          avatarUrl: defaultAvatarUrl,
          status: 'ACTIVE',
          isDeleted: false,
          securityQuestionRecoveryEnabled: storedSecurityQuestions.length >= 1,
          registrationIdempotencyKeyHash: idempotencyKeyHash,
          Profile: { create: { displayName: draft.nickname } },
        },
        select: { id: true, uid: true, username: true, nickname: true, role: true },
      })
      // User.uid is a database auto-increment column with a unique index. The
      // insert is the atomic allocator; reject an out-of-range allocation and
      // roll back instead of serializing every registration on one row.
      if (created.uid > MAX_UID) throw new Error('UID_LIMIT_REACHED')

      if (storedSecurityQuestions.length) {
        await tx.userSecurityQuestion.createMany({ data: storedSecurityQuestions.map((item) => ({ ...item, userId: created.id })) })
      }
      await tx.pointLog.create({ data: { userId: created.id, action: 'REGISTER', points: 0, before: 0, after: 0, reason: '邮箱验证注册账号' } })
      await tx.eHospitalCheckAttempt.updateMany({ where: { registrationDraftId: draft.id, userId: null }, data: { userId: created.id } })
      await tx.registrationDraft.update({ where: { id: draft.id }, data: { completedAt: new Date() } })
      return created
      },
    ))

    void syncUserAchievements(user.id, ['REGISTER']).catch((achievementError) => console.error('[achievements:register]', achievementError))
    return authenticatedResponse(request, user, 201, { message: '注册成功，正在进入欢迎页', emailVerified: true })
  } catch (error) {
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || ''
    if (idempotencyKey.length >= 16 && idempotencyKey.length <= 128) {
      const existing = await prisma.user.findUnique({ where: { registrationIdempotencyKeyHash: hashToken(idempotencyKey) }, select: { id: true, uid: true, username: true, nickname: true, role: true } }).catch(() => null)
      if (existing) return authenticatedResponse(request, existing, 200, { message: '注册已完成，正在进入私家E院', idempotentReplay: true })
    }
    console.error('[auth.register]', error)
    if (error instanceof MySqlAdvisoryLockBusyError) return jsonError('已有注册请求处理中，请稍后再试', 409, 'REGISTRATION_IN_PROGRESS', { form: '已有注册请求处理中，请稍后再试' })
    if (error instanceof RegistrationConflictError) {
      console.info('[auth.register] duplicate user prevented', { field: error.field })
      if (error.field === 'email') return jsonError('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
      if (error.field === 'phone') return jsonError('手机号已被注册', 409, 'PHONE_ALREADY_EXISTS', { phone: '手机号已被注册' })
      return jsonError('该登录账号已被使用，账号不区分大小写', 409, 'USERNAME_ALREADY_EXISTS', { nickname: '该登录账号已被使用，账号不区分大小写' })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String(error.meta?.target || '')
      if (target.includes('email')) return jsonError('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
      if (target.includes('phone')) return jsonError('手机号已被注册', 409, 'PHONE_ALREADY_EXISTS', { phone: '手机号已被注册' })
    }
    if (error instanceof Error && error.message === 'UID_LIMIT_REACHED') return jsonError('成员 UID 已达到上限', 409, 'UID_LIMIT_REACHED', { form: '成员 UID 已达到上限' })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && String(error.meta?.target || '').includes('usernameNormalized')) return jsonError('该登录账号已被使用，账号不区分大小写', 409, 'USERNAME_ALREADY_EXISTS', { nickname: '该登录账号已被使用，账号不区分大小写' })
    return jsonError('注册失败，请稍后再试', 500, 'REGISTER_FAILED', { form: '注册失败，请稍后再试' })
  }
}
