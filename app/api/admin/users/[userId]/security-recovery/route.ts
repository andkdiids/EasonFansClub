import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getClientIp, rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const guard = await requireAdmin('account_security_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  if (typeof body?.securityQuestionRecoveryEnabled !== 'boolean') {
    return NextResponse.json({ message: '密保找回状态格式不正确' }, { status: 400 })
  }

  const { userId } = await context.params
  const nextEnabled = body.securityQuestionRecoveryEnabled
  const reason = sanitizeText(body?.reason, 180)
  const requestIp = getClientIp(request)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          uid: true,
          role: true,
          securityQuestionRecoveryEnabled: true,
          UserSecurityQuestion: { select: { id: true } },
        },
      })

      if (!target) throw new Error('USER_NOT_FOUND')
      if (target.uid <= 0 || target.role === 'SUPER_ADMIN') throw new Error('PROTECTED_ACCOUNT')
      if (nextEnabled && !target.UserSecurityQuestion) throw new Error('SECURITY_QUESTIONS_INCOMPLETE')

      const previousEnabled = target.securityQuestionRecoveryEnabled
      if (previousEnabled !== nextEnabled) {
        await tx.user.update({
          where: { id: target.id },
          data: { securityQuestionRecoveryEnabled: nextEnabled },
        })

        const action = nextEnabled
          ? 'SECURITY_QUESTION_RECOVERY_ENABLED_BY_ADMIN'
          : 'SECURITY_QUESTION_RECOVERY_DISABLED_BY_ADMIN'
        const metadata = {
          adminId: guard.user.id,
          previousEnabled,
          nextEnabled,
          reason: reason || null,
          requestIp,
        }

        await tx.accountSecurityLog.create({
          data: { userId: target.id, action, ipAddress: requestIp, metadata },
        })
        await tx.adminAction.create({
          data: {
            adminId: guard.user.id,
            targetUserId: target.id,
            action: 'UPDATE_SETTING',
            reason: reason || (nextEnabled ? '管理员启用用户密保找回' : '管理员停用用户密保找回'),
            metadata: { setting: 'securityQuestionRecoveryEnabled', ...metadata },
          },
        })
      }

      return {
        id: target.id,
        securityQuestionsSet: Boolean(target.UserSecurityQuestion),
        securityQuestionRecoveryEnabled: nextEnabled,
        changed: previousEnabled !== nextEnabled,
      }
    })

    return NextResponse.json({
      message: result.changed
        ? result.securityQuestionRecoveryEnabled ? '已启用该用户的密保问题找回' : '已停用该用户的密保问题找回'
        : '密保问题找回状态未发生变化',
      user: result,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
    if (code === 'PROTECTED_ACCOUNT') return NextResponse.json({ message: '不允许修改超级管理员或系统保留账号的密保找回状态' }, { status: 403 })
    if (code === 'SECURITY_QUESTIONS_INCOMPLETE') {
      return NextResponse.json({ message: '该用户尚未完整设置密保问题，无法启用密保找回。' }, { status: 409 })
    }
    throw error
  }
}
