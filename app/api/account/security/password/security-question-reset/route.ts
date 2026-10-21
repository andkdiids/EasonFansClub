import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability, verifySecurityAnswers, type AccountSecuritySettings } from '@/lib/account-security'
import { validateNewPassword } from '@/lib/account-password'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'
import { PasswordChangeConflictError, commitPasswordChange } from '@/lib/password-security-transaction'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { consumeRateLimitFailClosed, getClientIp, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { hashToken } from '@/lib/tokens'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'

const wrongAnswerAction = 'account-password:wrong-security-answer'
const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const ip = getClientIp(request)
  const requestLimit = await consumeRateLimitFailClosed(`ip:${ip}`, 'account-password-security-reset', 20, 15 * 60).catch(() => null)
  if (!requestLimit) return NextResponse.json({ message: '暂时无法安全验证密保，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (requestLimit.limited) return NextResponse.json({ message: '密保答案错误或请求暂时受限。' }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(requestLimit.retryAfter || 1) },
  })

  const body = await request.json().catch(() => null)
  const validationError = validateNewPassword(body?.password, body?.confirmPassword)
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400, headers: noStoreHeaders })
  const answer = typeof body?.answer === 'string' ? body.answer : ''
  if (!answer.trim()) return NextResponse.json({ message: '请输入密保答案' }, { status: 400, headers: noStoreHeaders })

  let settings: AccountSecuritySettings
  let user: {
    id: string
    passwordHash: string
    mustSetupSecurity: boolean
    securityQuestionRecoveryEnabled: boolean
    UserSecurityQuestion: { sortOrder: number; answerHash: string } | null
  } | null
  try {
    [settings, user] = await Promise.all([
      getAccountSecuritySettings(),
      prisma.user.findUnique({
        where: { id: guard.user.id },
        select: { id: true, passwordHash: true, mustSetupSecurity: true, securityQuestionRecoveryEnabled: true, UserSecurityQuestion: { select: { sortOrder: true, answerHash: true } } },
      }),
    ])
  } catch {
    return NextResponse.json({ message: '暂时无法安全验证密保，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!user) return NextResponse.json({ message: '当前登录状态无效，请重新登录' }, { status: 401, headers: noStoreHeaders })
  const availability = getSecurityQuestionRecoveryAvailability({ globalEnabled: settings.enableSecurityQuestionRecovery, userEnabled: user.securityQuestionRecoveryEnabled, questionCount: user.UserSecurityQuestion ? 1 : 0 })
  if (user.mustSetupSecurity || !availability.available) return NextResponse.json({ message: '当前账号不能使用密保重置，请先完成密保设置。' }, { status: 403, headers: noStoreHeaders })

  const accountKey = `account:${hashToken(user.id)}`
  const lock = await consumeRateLimitFailClosed(accountKey, wrongAnswerAction, 5, 30 * 60).catch(() => null)
  if (!lock) return NextResponse.json({ message: '暂时无法安全验证密保，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (lock.limited) return NextResponse.json({ message: '密保答案错误或请求暂时受限。', retryAfter: lock.retryAfter }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(lock.retryAfter || 1) },
  })
  let valid = false
  try {
    valid = await verifySecurityAnswers(user.UserSecurityQuestion ? [user.UserSecurityQuestion] : [], [{ answer }])
  } catch {
    return NextResponse.json({ message: '暂时无法安全验证密保，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!valid) return NextResponse.json({ message: '密保答案错误或请求暂时受限。' }, { status: 400, headers: noStoreHeaders })
  const samePassword = await verifyPassword(body.password, user.passwordHash)
  if (samePassword.valid) return NextResponse.json({ message: '新密码不能与当前密码相同' }, { status: 400, headers: noStoreHeaders })

  const passwordHash = await bcrypt.hash(body.password, 12)
  try {
    await prisma.$transaction(async (tx) => {
      await commitPasswordChange(tx, {
        userId: user.id,
        expectedPasswordHash: user.passwordHash,
        passwordHash,
        action: 'PASSWORD_RESET_WITH_SECURITY_QUESTION',
        method: 'SECURITY_QUESTION',
        ipAddress: ip,
        userAgent: request.headers.get('user-agent')?.slice(0, 500) || null,
      })
      await tx.rateLimitLog.deleteMany({ where: { key: accountKey, action: wrongAnswerAction } })
    }, { timeout: 15_000, maxWait: 5_000 })
  } catch (error) {
    if (error instanceof PasswordChangeConflictError) return NextResponse.json({ message: '密码状态已变化，请重新验证后再试' }, { status: 409, headers: noStoreHeaders })
    return NextResponse.json({ message: '暂时无法安全修改密码，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  await safeNotificationWrite(
    () => createNotification({ data: { recipientId: user.id, type: 'SYSTEM', title: '密码重置成功', content: '您的登录密码已通过密保问题完成重置。如非本人操作，请及时联系管理员。', link: '/settings/security' } }),
    { operation: 'password-reset-security-question', userId: user.id, notificationType: 'SYSTEM' },
  )
  emitRealtime(user.id, 'notification')
  invalidateCurrentUserCache(user.id)
  return NextResponse.json({ message: '密码重置成功，请使用新密码重新登录' }, { headers: noStoreHeaders })
}
