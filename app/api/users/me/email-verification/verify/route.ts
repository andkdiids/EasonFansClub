import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import {
  hashProfileEmailVerificationCode,
  isValidEmail,
  normalizeEmail,
} from '@/lib/email-verification'
import { createMySqlAdvisoryLockName, MySqlAdvisoryLockBusyError, withMySqlAdvisoryLocks } from '@/lib/mysql-advisory-lock'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { getUserContactAdvisoryLockNames, maskContactValue } from '@/lib/user-contact'
import { writeUserOperationLog } from '@/lib/user-operation-log'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

class EmailVerificationError extends Error {
  constructor(readonly code: 'EMAIL_CODE_EXPIRED' | 'EMAIL_CODE_INVALID' | 'EMAIL_TAKEN' | 'USER_NOT_FOUND' | 'EMAIL_CODE_USED', message: string) {
    super(message)
    this.name = 'EmailVerificationError'
  }
}

function errorResponse(message: string, code: string, status: number, field?: string) {
  return NextResponse.json({
    message,
    code,
    ...(field ? { field, errors: { [field]: message } } : {}),
  }, { status, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 10, windowSeconds: 15 * 60 },
    user: { limit: 8, windowSeconds: 15 * 60 },
    endpoint: '/api/users/me/email-verification/verify',
  }, '验证码尝试次数过多，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!email || !isValidEmail(email)) return errorResponse('请输入正确的邮箱地址', 'INVALID_EMAIL', 400, 'email')
  if (!/^\d{6}$/.test(code)) return errorResponse('验证码格式不正确，请输入 6 位验证码', 'INVALID_EMAIL_CODE', 400, 'code')

  const latest = await prisma.emailVerification.findFirst({
    where: { userId: guard.user.id, email, usedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tokenHash: true, expiresAt: true },
  })
  const now = new Date()
  if (!latest || latest.expiresAt.getTime() <= now.getTime()) {
    return errorResponse('验证码已过期，请重新获取', 'EMAIL_CODE_EXPIRED', 400, 'code')
  }
  if (latest.tokenHash !== hashProfileEmailVerificationCode(guard.user.id, email, code)) {
    return errorResponse('验证码不正确，请重新输入', 'EMAIL_CODE_INVALID', 400, 'code')
  }

  const lockNames = [
    ...getUserContactAdvisoryLockNames(guard.user.id, { email }),
    createMySqlAdvisoryLockName('user-contact-email', email),
  ]

  try {
    const updated = await prisma.$transaction(async (tx) => withMySqlAdvisoryLocks(
      tx,
      lockNames,
      async () => {
        const current = await tx.user.findUnique({
          where: { id: guard.user.id },
          select: { id: true, email: true, emailVerifiedAt: true },
        })
        if (!current) throw new EmailVerificationError('USER_NOT_FOUND', '账号不存在')

        const currentVerification = await tx.emailVerification.findUnique({
          where: { id: latest.id },
          select: { id: true, tokenHash: true, expiresAt: true, usedAt: true },
        })
        if (!currentVerification || currentVerification.usedAt || currentVerification.expiresAt.getTime() <= Date.now()) {
          throw new EmailVerificationError('EMAIL_CODE_USED', '验证码已失效，请重新获取')
        }
        if (currentVerification.tokenHash !== hashProfileEmailVerificationCode(guard.user.id, email, code)) {
          throw new EmailVerificationError('EMAIL_CODE_INVALID', '验证码不正确，请重新输入')
        }

        const existing = await tx.user.findFirst({
          where: { email, isDeleted: false, status: 'ACTIVE', NOT: { id: guard.user.id } },
          select: { id: true },
        })
        if (existing) throw new EmailVerificationError('EMAIL_TAKEN', '该邮箱已被其他账号使用')

        const claimed = await tx.emailVerification.updateMany({
          where: { id: currentVerification.id, usedAt: null },
          data: { usedAt: now },
        })
        if (claimed.count !== 1) throw new EmailVerificationError('EMAIL_CODE_USED', '验证码已失效，请重新获取')

        const updatedUser = await tx.user.update({
          where: { id: guard.user.id },
          data: {
            email,
            emailVerifiedAt: now,
            verificationStatus: 'VERIFIED',
          },
          select: { id: true, email: true, emailVerifiedAt: true },
        })

        await writeUserOperationLog(tx, {
          userId: guard.user.id,
          category: 'ACCOUNT',
          action: current.email ? 'EMAIL_CHANGED' : 'EMAIL_BOUND',
          summary: current.email ? '用户完成邮箱变更验证' : '用户完成邮箱绑定验证',
          metadata: {
            oldEmail: maskContactValue(current.email),
            newEmail: maskContactValue(email),
            verifiedAt: now.toISOString(),
          },
          source: 'PROFILE_EMAIL_VERIFY',
          operatorType: 'USER',
          operatorUserId: guard.user.id,
          targetType: 'USER',
          targetId: guard.user.id,
        })

        return updatedUser
      },
    ), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({
      message: '邮箱绑定成功',
      code: 'EMAIL_VERIFIED',
      profile: {
        email: updated.email,
        emailVerifiedAt: updated.emailVerifiedAt?.toISOString() || null,
      },
    }, { headers: noStoreHeaders })
  } catch (error) {
    if (error instanceof EmailVerificationError) {
      const status = error.code === 'EMAIL_TAKEN' ? 409 : error.code === 'USER_NOT_FOUND' ? 404 : 400
      const field = error.code === 'EMAIL_TAKEN' ? 'email' : 'code'
      return errorResponse(error.message, error.code, status, field)
    }
    if (error instanceof MySqlAdvisoryLockBusyError) {
      return errorResponse('邮箱正在被其他请求处理，请稍后重试', 'EMAIL_UPDATE_BUSY', 409)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return errorResponse('邮箱正在被其他请求处理，请稍后重试', 'EMAIL_UPDATE_CONFLICT', 409)
    }
    console.error('[users.me.email-verification.verify]', error instanceof Error ? error.message : 'unknown_error')
    return errorResponse('邮箱验证失败，请稍后重试', 'EMAIL_VERIFY_FAILED', 500)
  }
}
