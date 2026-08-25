import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import type { UserRole, UserStatus } from '@prisma/client'
import { deleteUserPermanently, getUserDeletionPreview } from '@/lib/admin-user-deletion'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { MySqlAdvisoryLockBusyError, withMySqlAdvisoryLocks } from '@/lib/mysql-advisory-lock'
import { prisma } from '@/lib/prisma'
import { adjustRegistrationFeeBalance } from '@/lib/registration-fee'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { getPhoneLookupVariants } from '@/lib/phone-number'
import {
  canonicalEmailValue,
  canonicalPhoneValue,
  getUserContactAdvisoryLockNames,
  maskContactValue,
  normalizeUserContactPatch,
  UserContactValidationError,
} from '@/lib/user-contact'

type RouteContext = { params: Promise<{ userId: string }> }
const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export const dynamic = 'force-dynamic'

async function requireUserDeletionPermission() {
  const guard = await requireAdmin()
  if (!guard.user) return guard

  const canDelete = (await hasAdminPermission(guard.user, 'user_delete')) || (await hasAdminPermission(guard.user, 'user_manage'))
  if (!canDelete) {
    return {
      user: null,
      response: NextResponse.json({ message: '当前管理员未获得永久删除用户权限' }, { status: 403 }),
    }
  }

  return guard
}

function deletionErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const messages: Record<string, string> = {
    USER_NOT_FOUND: '用户不存在',
    UID_CONFIRM_MISMATCH: 'UID 确认不匹配',
    ADMIN_NOT_FOUND: '管理员身份无效',
    SELF_DELETE_REQUIRES_CONFIRMATION: '删除自己的账号需要额外确认',
    LAST_SUPER_ADMIN: '不能删除最后一个超级管理员',
  }

  return NextResponse.json({ message: messages[message] || '删除失败，请稍后重试' }, { status: message === 'USER_NOT_FOUND' ? 404 : 400 })
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireUserDeletionPermission()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const preview = await getUserDeletionPreview(userId)
  if (!preview) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  return NextResponse.json({ preview }, { headers: noStoreHeaders })
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('user_manage')
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const body = await request.json().catch(() => null)
  const action = sanitizeText(body?.action, 40)

  if (action === 'updateEmail' || action === 'updatePhone' || action === 'updateContact') {
    const contactInput = action === 'updateEmail'
      ? { email: body?.email }
      : action === 'updatePhone'
        ? { phone: body?.phone, phoneCountry: body?.phoneCountry }
        : { email: body?.email, phone: body?.phone, phoneCountry: body?.phoneCountry }

    let contactPatch: ReturnType<typeof normalizeUserContactPatch>
    try {
      contactPatch = normalizeUserContactPatch(contactInput)
    } catch (error) {
      if (error instanceof UserContactValidationError) {
        return NextResponse.json({ message: error.message, code: error.code }, { status: 400 })
      }
      throw error
    }

    try {
      const result = await prisma.$transaction(async (tx) => withMySqlAdvisoryLocks(
        tx,
        getUserContactAdvisoryLockNames(userId, contactPatch),
        async () => {
          const target = await tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              uid: true,
              email: true,
              phone: true,
              emailVerifiedAt: true,
              phoneVerifiedAt: true,
              verificationStatus: true,
            },
          })
          if (!target) throw new Error('USER_NOT_FOUND')

          const nextEmail = contactPatch.email === undefined ? target.email : contactPatch.email
          const nextPhone = contactPatch.phone === undefined ? target.phone : contactPatch.phone
          const currentEmail = canonicalEmailValue(target.email)
          const currentPhone = canonicalPhoneValue(target.phone, contactPatch.phoneCountry)
          const canonicalNextEmail = canonicalEmailValue(nextEmail)
          const canonicalNextPhone = canonicalPhoneValue(nextPhone, contactPatch.phoneCountry)
          const emailChanged = contactPatch.email !== undefined && canonicalNextEmail !== currentEmail
          const phoneChanged = contactPatch.phone !== undefined && canonicalNextPhone !== currentPhone

          const phoneVariants = canonicalNextPhone
            ? getPhoneLookupVariants(canonicalNextPhone, contactPatch.phoneCountry)
            : []
          const contactFilters = [
            ...(canonicalNextEmail ? [{ email: canonicalNextEmail }] : []),
            ...phoneVariants.map((phone) => ({ phone })),
          ]
          if (contactFilters.length) {
            const conflict = await tx.user.findFirst({
              where: { isDeleted: false, NOT: { id: userId }, OR: contactFilters },
              select: { id: true, email: true, phone: true },
            })
            if (conflict) {
              if (canonicalNextEmail && canonicalEmailValue(conflict.email) === canonicalNextEmail) throw new Error('EMAIL_ALREADY_EXISTS')
              if (canonicalNextPhone && phoneVariants.includes(canonicalPhoneValue(conflict.phone, contactPatch.phoneCountry) || '')) throw new Error('PHONE_ALREADY_EXISTS')
            }
          }

          const data: Prisma.UserUpdateInput = {}
          if (contactPatch.email !== undefined) {
            data.email = nextEmail
            if (emailChanged) {
              data.emailVerifiedAt = null
              data.verificationStatus = nextEmail ? 'PENDING' : 'NONE'
            }
          }
          if (contactPatch.phone !== undefined) {
            data.phone = nextPhone
            if (phoneChanged) data.phoneVerifiedAt = null
          }

          const storedValueChanged = target.email !== nextEmail || target.phone !== nextPhone
          if (emailChanged) {
            const now = new Date()
            await tx.emailVerification.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } })
            if (canonicalNextEmail) {
              await tx.emailVerification.updateMany({ where: { email: canonicalNextEmail, usedAt: null }, data: { usedAt: now } })
            }
          }
          if (phoneChanged) {
            const invalidatedPhones = new Set<string>([
              ...getPhoneLookupVariants(target.phone, contactPatch.phoneCountry),
              ...phoneVariants,
            ])
            if (invalidatedPhones.size) {
              await tx.smsCode.updateMany({ where: { phone: { in: [...invalidatedPhones] }, usedAt: null }, data: { usedAt: new Date() } })
            }
          }

          const user = await tx.user.update({
            where: { id: userId },
            data,
            select: {
              id: true,
              uid: true,
              email: true,
              phone: true,
              emailVerifiedAt: true,
              phoneVerifiedAt: true,
              verificationStatus: true,
              updatedAt: true,
            },
          })

          if (storedValueChanged || emailChanged || phoneChanged) {
            await tx.adminActionLog.create({
              data: {
                adminId: guard.user.id,
                targetUserId: userId,
                action: 'UPDATE_USER_CONTACT',
                detail: {
                  previousPhone: maskContactValue(target.phone),
                  newPhone: maskContactValue(user.phone),
                  previousEmail: maskContactValue(target.email),
                  newEmail: maskContactValue(user.email),
                  phoneChanged,
                  emailChanged,
                  reason: sanitizeText(body?.reason, 180) || '管理员修改用户联系方式',
                },
              },
            })
          }

          return { changed: storedValueChanged || emailChanged || phoneChanged, user }
        },
      ))

      invalidateCurrentUserCache(userId)
      const message = action === 'updateEmail'
        ? result.changed ? '绑定邮箱已修改' : '绑定邮箱未发生变化'
        : action === 'updatePhone'
          ? result.changed ? '绑定手机号已修改' : '绑定手机号未发生变化'
          : result.changed ? '联系方式已修改' : '联系方式未发生变化'
      return NextResponse.json({ user: result.user, message })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
      if (code === 'EMAIL_ALREADY_EXISTS') return NextResponse.json({ message: '该邮箱已被其他用户绑定', code }, { status: 409 })
      if (code === 'PHONE_ALREADY_EXISTS') return NextResponse.json({ message: '该手机号已被其他用户绑定', code }, { status: 409 })
      if (error instanceof MySqlAdvisoryLockBusyError) return NextResponse.json({ message: '已有联系方式修改正在处理中，请稍后重试', code: 'CONTACT_UPDATE_IN_PROGRESS' }, { status: 409 })
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ message: '手机号或邮箱已被其他用户绑定', code: 'CONTACT_ALREADY_EXISTS' }, { status: 409 })
      }
      throw error
    }
  }

  if (action === 'delete') {
    const deleteGuard = await requireUserDeletionPermission()
    if (!deleteGuard.user) return deleteGuard.response

    try {
      const result = await deleteUserPermanently({
        adminId: deleteGuard.user.id,
        userId,
        confirmUid: sanitizeText(body?.confirmUid, 16),
        deletePublicContent: Boolean(body?.deletePublicContent),
        confirmSelf: Boolean(body?.confirmSelf),
      })
      return NextResponse.json(result)
    } catch (error) {
      return deletionErrorResponse(error)
    }
  }

  const data: {
    role?: UserRole
    canPlayFullMusic?: boolean
    status?: UserStatus
    level?: number
    isDeleted?: boolean
    deletedAt?: Date | null
    nicknameChangedAt?: Date | null
  } = {}

  if (body?.role) {
    data.role = body.role
    if (body.role !== 'ADMIN' && body.role !== 'SUPER_ADMIN') data.canPlayFullMusic = false
  }
  if (body?.level !== undefined) data.level = Number(body.level)
  if (body?.exp !== undefined || body?.experience !== undefined || body?.experiencePoints !== undefined) {
    return NextResponse.json({ message: '经验值只能通过每日挂号或精华帖子奖励增加' }, { status: 400 })
  }
  const targetPoints = body?.points === undefined ? undefined : Number(body.points)
  if (targetPoints !== undefined && (!Number.isSafeInteger(targetPoints) || targetPoints < 0)) {
    return NextResponse.json({ message: '挂号费余额必须是非负整数' }, { status: 400 })
  }

  if (action === 'ban') {
    data.status = 'BANNED'
  } else if (action === 'unban') {
    data.status = 'ACTIVE'
    data.isDeleted = false
    data.deletedAt = null
  } else if (action === 'merge') {
    data.status = 'MERGED'
  } else if (action === 'disable') {
    data.status = 'DISABLED'
  } else if (action === 'resetNicknameCooldown') {
    data.nicknameChangedAt = null
  } else if (body?.status === 'DELETED') {
    return NextResponse.json({ message: '删除用户请使用永久删除确认流程' }, { status: 400 })
  } else if (body?.status) {
    data.status = body.status
  }

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    })

    if (!existing) {
      throw new Error('USER_NOT_FOUND')
    }

    if (targetPoints !== undefined) {
      await adjustRegistrationFeeBalance(tx, {
        userId,
        targetPoints,
        reason: sanitizeText(body?.reason, 180) || '管理员调整挂号费',
        businessKey: sanitizeText(body?.idempotencyKey, 120) || undefined,
      })
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        uid: true,
        nickname: true,
        role: true,
        status: true,
        level: true,
        exp: true,
        points: true,
        isDeleted: true,
      },
    })

    if (data.status === 'DELETED') {
      if (existing.phone) {
        await tx.smsCode.updateMany({
          where: { phone: existing.phone, usedAt: null },
          data: { usedAt: new Date() },
        })
      }
      await tx.onlineSession.deleteMany({ where: { userId } })
    }

    await tx.adminAction.create({
      data: {
        adminId: guard.user.id,
        targetUserId: userId,
        action: data.status === 'DELETED' ? 'DELETE_USER' : data.status === 'BANNED' ? 'BAN_USER' : 'UPDATE_USER_POINTS',
        reason: sanitizeText(body?.reason, 180) || '管理员更新用户状态',
        metadata: { action, data, ...(targetPoints !== undefined ? { targetPoints } : {}) },
      },
    })

    return updated
  })

  return NextResponse.json({ user })
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireUserDeletionPermission()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const body = await request.json().catch(() => null)

  try {
    const result = await deleteUserPermanently({
      adminId: guard.user.id,
      userId,
      confirmUid: sanitizeText(body?.confirmUid, 16),
      deletePublicContent: Boolean(body?.deletePublicContent),
      confirmSelf: Boolean(body?.confirmSelf),
    })
    return NextResponse.json(result)
  } catch (error) {
    return deletionErrorResponse(error)
  }
}
