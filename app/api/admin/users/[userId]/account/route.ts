import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { maskLoginAccount, validateAdminLoginAccount } from '@/lib/login-account'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireSuperAdmin, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireSuperAdmin()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const reason = sanitizeText(body?.reason, 300)
  if (!reason) return NextResponse.json({ message: '请填写操作原因' }, { status: 400 })
  const { userId } = await context.params

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, uid: true, username: true, usernameNormalized: true, nickname: true } })
      if (!target) throw new Error('USER_NOT_FOUND')
      const validation = validateAdminLoginAccount(body?.account, body?.confirmAccount, target.usernameNormalized)
      if (validation.error) throw new Error(`VALIDATION:${validation.error}`)
      const conflict = await tx.user.findUnique({ where: { usernameNormalized: validation.usernameNormalized }, select: { id: true } })
      if (conflict && conflict.id !== target.id) throw new Error('ACCOUNT_ALREADY_EXISTS')

      const user = await tx.user.update({ where: { id: userId }, data: { username: validation.account, usernameNormalized: validation.usernameNormalized }, select: { id: true, uid: true, username: true, nickname: true } })
      await tx.notification.create({
        data: {
          recipientId: userId,
          type: 'SYSTEM',
          title: '登录账号已由管理员修改',
          content: '您的登录账号已由超级管理员修改。下次登录时请使用新的登录账号。如非本人申请，请及时联系管理员。',
          link: '/settings/security',
        },
      })
      await tx.adminActionLog.create({
        data: {
          adminId: guard.user.id,
          targetUserId: userId,
          action: 'USER_ACCOUNT_CHANGED',
          detail: { previousAccount: maskLoginAccount(target.username), newAccount: maskLoginAccount(validation.account), reason },
        },
      })
      return user
    })

    invalidateCurrentUserCache(userId)
    return NextResponse.json({ user: result, message: '登录账号修改成功' })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
    if (message.startsWith('VALIDATION:')) return NextResponse.json({ message: message.slice('VALIDATION:'.length) }, { status: 400 })
    if (message === 'ACCOUNT_ALREADY_EXISTS' || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      return NextResponse.json({ message: '该登录账号已被其他用户使用，账号不区分大小写。' }, { status: 409 })
    }
    throw error
  }
}
