import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability, verifySecurityAnswers } from '@/lib/account-security'
import { validateNewPassword } from '@/lib/account-password'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const wrongAnswerAction = 'account-password:wrong-security-answer'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const ip = getClientIp(request)
  const requestLimit = await consumeRateLimit(`ip:${ip}`, 'account-password-security-reset', 20, 15 * 60)
  if (requestLimit.limited) return NextResponse.json({ message: '密保答案错误或请求暂时受限。' }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(requestLimit.retryAfter || 1) },
  })

  const body = await request.json().catch(() => null)
  const validationError = validateNewPassword(body?.password, body?.confirmPassword)
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400 })
  const answer = typeof body?.answer === 'string' ? body.answer : ''
  if (!answer.trim()) return NextResponse.json({ message: '请输入密保答案' }, { status: 400 })

  const [settings, user] = await Promise.all([
    getAccountSecuritySettings(),
    prisma.user.findUnique({
      where: { id: guard.user.id },
      select: { id: true, passwordHash: true, mustSetupSecurity: true, securityQuestionRecoveryEnabled: true, UserSecurityQuestion: { select: { sortOrder: true, answerHash: true } } },
    }),
  ])
  if (!user) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const availability = getSecurityQuestionRecoveryAvailability({ globalEnabled: settings.enableSecurityQuestionRecovery, userEnabled: user.securityQuestionRecoveryEnabled, questionCount: user.UserSecurityQuestion ? 1 : 0 })
  if (user.mustSetupSecurity || !availability.available) return NextResponse.json({ message: '当前账号不能使用密保重置，请先完成密保设置。' }, { status: 403 })

  const accountKey = `account:${hashToken(user.id)}`
  const lock = await consumeRateLimit(accountKey, wrongAnswerAction, 5, 30 * 60)
  if (lock.limited) return NextResponse.json({ message: '密保答案错误或请求暂时受限。', retryAfter: lock.retryAfter }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(lock.retryAfter || 1) },
  })
  const valid = await verifySecurityAnswers(user.UserSecurityQuestion ? [user.UserSecurityQuestion] : [], [{ answer }])
  if (!valid) {
    return NextResponse.json({ message: '密保答案错误或请求暂时受限。' }, { status: 400 })
  }
  const samePassword = await verifyPassword(body.password, user.passwordHash)
  if (samePassword.valid) return NextResponse.json({ message: '新密码不能与当前密码相同' }, { status: 400 })

  const passwordHash = await bcrypt.hash(body.password, 12)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } })
    await tx.rateLimitLog.deleteMany({ where: { key: accountKey, action: wrongAnswerAction } })
    await tx.notification.create({ data: { recipientId: user.id, type: 'SYSTEM', title: '密码重置成功', content: '您的登录密码已通过密保问题完成重置。如非本人操作，请及时联系管理员。', link: '/settings/security' } })
    await tx.accountSecurityLog.create({ data: { userId: user.id, action: 'PASSWORD_RESET_WITH_SECURITY_QUESTION', ipAddress: ip, userAgent: request.headers.get('user-agent')?.slice(0, 500), metadata: { method: 'SECURITY_QUESTION' } } })
  })
  emitRealtime(user.id, 'notification')
  invalidateCurrentUserCache(user.id)
  return NextResponse.json({ message: '密码重置成功' })
}
