import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability } from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: guard.user.id },
      select: {
        email: true,
        emailVerifiedAt: true,
        securityQuestionRecoveryEnabled: true,
        UserSecurityQuestion: { select: { id: true } },
      },
    }),
    getAccountSecuritySettings(),
  ])
  if (!user) return NextResponse.json({ message: '账号不存在' }, { status: 404 })
  const recoveryAvailability = getSecurityQuestionRecoveryAvailability({
    globalEnabled: settings.enableSecurityQuestionRecovery,
    userEnabled: user.securityQuestionRecoveryEnabled,
    questionCount: user.UserSecurityQuestion ? 1 : 0,
  })
  return NextResponse.json({
    securityQuestionsSet: Boolean(user.UserSecurityQuestion),
    securityQuestionRecoveryEnabled: user.securityQuestionRecoveryEnabled,
    emailBound: Boolean(user.email),
    emailVerified: Boolean(user.emailVerifiedAt),
    emailPasswordResetEnabled: settings.enableEmailPasswordReset,
    securityQuestionRecoveryAvailable: recoveryAvailability.available,
    securityQuestionRecoveryReason: recoveryAvailability.reason,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  return NextResponse.json({ message: '账号恢复方式由系统统一管理，请联系管理员调整' }, { status: 403 })
}
