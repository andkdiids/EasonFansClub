import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { syncUserAchievements } from '@/lib/achievements'
import {
  canSendEmailVerification,
  createVerificationForUser,
  isValidEmail,
  normalizeEmail,
  sendVerificationEmail,
} from '@/lib/email-verification'
import { hashPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { getRegistrationPolicy, type RegistrationType } from '@/lib/registration'
import { checkRateLimit, consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { findActiveConflict, findLoginAccountConflict } from '@/lib/users'
import { MAX_UID } from '@/lib/uid'
import { normalizeText } from '@/lib/validators'
import { hashSecurityQuestions, parseSecurityQuestions } from '@/lib/account-security'
import { hashToken } from '@/lib/tokens'
import { getLoginAccountDisplay, validateLoginAccountValue } from '@/lib/login-account'
import { chooseDefaultAvatar } from '@/lib/default-avatars'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }
const registerRequestLimit = {
  action: 'register:request',
  limit: 10,
  windowSeconds: 30 * 60,
} as const
const registerSuccessLimit = {
  action: 'register:success',
  limit: 3,
  windowSeconds: 60 * 60,
} as const

function unicodeLength(value: string) {
  return Array.from(value).length
}

function jsonError(
  message: string,
  status: number,
  code: string,
  errors: Record<string, string> = {},
  meta: Record<string, unknown> = {},
) {
  return NextResponse.json({ message, code, errors, ...meta }, { status, headers: noStoreHeaders })
}

function parseRegistrationType(value: unknown): RegistrationType | null {
  return value === 'PHONE' || value === 'EMAIL' ? value : null
}
export async function POST(request: Request) {
const originError = rejectInvalidRequestOrigin(request)

if (originError) return originError

  try {
    const body = await request.json().catch(() => null)
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || ''
    const idempotencyKeyHash = idempotencyKey.length >= 16 && idempotencyKey.length <= 128 ? hashToken(idempotencyKey) : null
    if (idempotencyKeyHash) {
  const replayUser = await prisma.user.findUnique({
    where: { registrationIdempotencyKeyHash: idempotencyKeyHash },
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      role: true,
      email: true,
      phone: true,
    },
  })

      if (replayUser) {
        return NextResponse.json({
          user: replayUser,
          registrationType: replayUser.email ? 'EMAIL' : 'PHONE',
          message: '注册成功，请登录您的账号。',
          idempotentReplay: true,
        }, { status: 200, headers: noStoreHeaders })
      }
    }
    const registrationType = parseRegistrationType(body?.registrationType)
const policy = await getRegistrationPolicy()
    const clientIp = getClientIp(request)
    const ipRateLimitKey = `ip:${clientIp}`

    if (!policy.allowRegister || policy.registrationMode === 'CLOSED') {
      return jsonError('网站目前处于内测阶段，暂未开放注册，请关注后续公告。', 403, 'REGISTRATION_CLOSED')
    }
    if (!registrationType) {
      return jsonError('注册方式不正确', 400, 'INVALID_REGISTRATION_TYPE', { registrationType: '注册方式不正确' })
    }
    if (registrationType === 'PHONE' && !policy.allowPhoneRegistration) {
      return jsonError('当前未开放手机号注册', 403, 'PHONE_REGISTRATION_DISABLED', { registrationType: '当前未开放手机号注册' })
    }
    if (registrationType === 'EMAIL' && !policy.allowEmailRegistration) {
      return jsonError('当前未开放邮箱注册', 403, 'EMAIL_REGISTRATION_DISABLED', { registrationType: '当前未开放邮箱注册' })
    }

  const requestLimit = await consumeRateLimit(
  ipRateLimitKey,
  registerRequestLimit.action,
  registerRequestLimit.limit,
  registerRequestLimit.windowSeconds,
)

    if (requestLimit.limited) {
      return jsonError('操作过于频繁，请稍后再试。', 429, 'REGISTER_REQUEST_RATE_LIMITED', {}, {
        retryAfter: requestLimit.retryAfter,
      })
    }

    const username = getLoginAccountDisplay(body?.nickname || body?.username)
    const accountValidation = validateLoginAccountValue(username)
    const usernameNormalized = accountValidation.usernameNormalized
    const nickname = username
    const email = registrationType === 'EMAIL' ? normalizeEmail(body?.email) : ''
    const phone = registrationType === 'PHONE' ? normalizeText(body?.phone).replace(/\s+/g, '') : ''
    const password = normalizeText(body?.password)
    const confirmPassword = normalizeText(body?.confirmPassword)
    const acceptedAgreement = Boolean(body?.acceptedAgreement)
    const securityQuestions = parseSecurityQuestions(body?.securityQuestions)

    const errors: Record<string, string> = {}
    if (!nickname) errors.nickname = '请填写用户名/昵称'
    if (nickname && (unicodeLength(nickname) < 2 || unicodeLength(nickname) > 16 || accountValidation.error)) errors.nickname = '用户名长度需要 2-16 个字符'
    if (registrationType === 'PHONE') {
      if (!phone) errors.phone = '请填写手机号'
      if (phone && !/^1\d{10}$/.test(phone)) errors.phone = '请输入 11 位中国大陆手机号'
    }
    if (registrationType === 'EMAIL') {
      if (!email) errors.email = '请填写邮箱'
      if (email && !isValidEmail(email)) errors.email = '请输入有效邮箱'
    }
    if (!password || password.length < 8) errors.password = '密码至少需要 8 位'
    if (confirmPassword !== password) errors.confirmPassword = '两次输入的密码不一致'
    if (!acceptedAgreement) errors.acceptedAgreement = '请先勾选用户协议'
    if (policy.requireSecurityQuestionsForNewUsers) {
  const firstQuestion = securityQuestions[0]

  if (
    !firstQuestion ||
    !firstQuestion.question?.trim() ||
    !firstQuestion.answer?.trim()
  ) {
    errors.securityQuestions = '请完整填写密保问题和答案'
  }
}
    if (Object.keys(errors).length) {
      return jsonError('请检查注册信息', 400, 'INVALID_REGISTER_FIELDS', errors)
    }

const turnstile = await verifyTurnstileToken(body?.turnstileToken, request)
    if (!turnstile.success) {
      return jsonError(turnstile.message || '人机验证失败', 400, turnstile.message === '请先完成人机验证' ? 'TURNSTILE_REQUIRED' : 'TURNSTILE_FAILED', {
        turnstileToken: turnstile.message || '人机验证失败',
      })
    }

    if (registrationType === 'EMAIL' && process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
      return jsonError('邮件服务尚未配置，暂时无法开放邮箱注册', 503, 'EMAIL_SERVICE_NOT_CONFIGURED')
    }

const [duplicate, accountDuplicate] = await Promise.all([
  findActiveConflict({
    phone: registrationType === 'PHONE' ? phone : null,
    email: registrationType === 'EMAIL' ? email : null,
  }),
  findLoginAccountConflict(usernameNormalized),
])

    if (duplicate) {
      if (registrationType === 'PHONE' && duplicate.phone === phone) {
        return jsonError('手机号已被注册', 409, 'PHONE_ALREADY_EXISTS', { phone: '手机号已被注册' })
      }
      if (registrationType === 'EMAIL' && duplicate.email === email) {
        return jsonError('邮箱已被注册', 409, 'EMAIL_ALREADY_EXISTS', { email: '邮箱已被注册' })
      }
    }
    if (accountDuplicate) return jsonError('该登录账号已被使用，账号不区分大小写。', 409, 'USERNAME_ALREADY_EXISTS', { nickname: '该登录账号已被使用，账号不区分大小写。' })

    if (registrationType === 'EMAIL' && !(await canSendEmailVerification(email))) {
      return jsonError('验证邮件发送过于频繁，请 10 分钟后再试', 429, 'EMAIL_VERIFICATION_COOLDOWN', {
        email: '验证邮件发送过于频繁，请 10 分钟后再试',
      })
    }

const successLimit = await checkRateLimit(
  ipRateLimitKey,
  registerSuccessLimit.action,
  registerSuccessLimit.limit,
)

if (successLimit.limited) {
  return jsonError('当前网络注册账号数量较多，请稍后再试。', 429, 'REGISTER_SUCCESS_RATE_LIMITED', {}, {
    retryAfter: successLimit.retryAfter,
  })
}

const passwordHash = await hashPassword(password)

const hashedSecurityQuestions =
  policy.requireSecurityQuestionsForNewUsers
    ? await hashSecurityQuestions(securityQuestions.slice(0, 1))
    : []

    const successLimitExpiresAt = new Date(Date.now() + registerSuccessLimit.windowSeconds * 1000)
    const user = await prisma.$transaction(async (tx) => {
      const latest = await tx.user.findFirst({
        orderBy: { uid: 'desc' },
        select: { uid: true },
      })
      if ((latest?.uid ?? -1) >= MAX_UID) {
        throw new Error('UID_LIMIT_REACHED')
      }
      const defaultAvatarUrl = await chooseDefaultAvatar(tx)
      const created = await tx.user.create({
        data: {
          username,
          usernameNormalized,
          nickname,
          email: registrationType === 'EMAIL' ? email : null,
          phone: registrationType === 'PHONE' ? phone : null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          passwordHash,
          avatarUrl: defaultAvatarUrl,
          status: 'ACTIVE',
          isDeleted: false,
          securityQuestionRecoveryEnabled: hashedSecurityQuestions.length >= 1,
          registrationIdempotencyKeyHash: idempotencyKeyHash,
          Profile: {
            create: {
              displayName: nickname,
            },
          },
        },
        select: {
          id: true,
          uid: true,
          username: true,
          nickname: true,
          role: true,
        },
      })
  
      if (hashedSecurityQuestions.length) {
        await tx.userSecurityQuestion.createMany({
          data: hashedSecurityQuestions.map((item) => ({ ...item, userId: created.id })),
        })
      }

      await tx.pointLog.create({
        data: {
          userId: created.id,
          action: 'REGISTER',
          points: 0,
          before: 0,
          after: 0,
          reason: registrationType === 'PHONE' ? '手机号注册账号' : '邮箱注册账号',
        },
      })
      await tx.rateLimitLog.create({
        data: {
          key: ipRateLimitKey,
          action: registerSuccessLimit.action,
          expiresAt: successLimitExpiresAt,
        },
      })

      return created
    })
    let devVerificationUrl = ''
    let emailSent = false
    if (registrationType === 'EMAIL') {
      const verification = await createVerificationForUser(user.id, email)
      const emailResult = await sendVerificationEmail(email, verification.verificationUrl)
      emailSent = emailResult.sent
      devVerificationUrl = process.env.NODE_ENV === 'production' ? '' : verification.verificationUrl
    }

    void syncUserAchievements(user.id, ['REGISTER']).catch((achievementError) => {
  console.error('[achievements:register]', achievementError)
})

    return NextResponse.json(
      {
        user,
        registrationType,
        message: registrationType === 'PHONE'
          ? '注册成功，可以使用手机号和密码登录。手机号尚未经过短信验证，请尽快绑定并验证邮箱。'
          : '注册成功，请先查收邮件完成邮箱验证。',
        emailSent,
        devVerificationUrl,
      },
      { status: 201, headers: noStoreHeaders },
    )
  } catch (error) {
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || ''
    if (idempotencyKey.length >= 16 && idempotencyKey.length <= 128) {
      const existing = await prisma.user.findUnique({
        where: { registrationIdempotencyKeyHash: hashToken(idempotencyKey) },
        select: { id: true, uid: true, username: true, nickname: true, role: true, email: true, phone: true },
      }).catch(() => null)
      if (existing) {
        return NextResponse.json({
          user: existing,
          registrationType: existing.email ? 'EMAIL' : 'PHONE',
          message: '注册成功，请登录您的账号。',
          idempotentReplay: true,
        }, { status: 200, headers: noStoreHeaders })
      }
    }
    console.error('[auth.register]', error)
    if (error instanceof Error && error.message === 'UID_LIMIT_REACHED') {
      return jsonError('成员 UID 已达到 5 位上限', 409, 'UID_LIMIT_REACHED', { form: '成员 UID 已达到 5 位上限' })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && String(error.meta?.target || '').includes('usernameNormalized')) {
      return jsonError('该登录账号已被使用，账号不区分大小写。', 409, 'USERNAME_ALREADY_EXISTS', { nickname: '该登录账号已被使用，账号不区分大小写。' })
    }

    return jsonError('注册失败，请稍后再试', 500, 'REGISTER_FAILED', { form: '注册失败，请稍后再试' })
  }
}
