import { NextResponse } from 'next/server'
import { Prisma, ProfileWallVisibility } from '@prisma/client'
import type { UserRole, UserStatus } from '@prisma/client'
import { deleteUserPermanently, getUserDeletionPreview } from '@/lib/admin-user-deletion'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { MySqlAdvisoryLockBusyError } from '@/lib/mysql-advisory-lock'
import { updateAdminUserContact } from '@/lib/admin-user-contact'
import { updateAdminUserProfile, type AdminUserProfilePatch } from '@/lib/admin-user-profile'
import { prisma } from '@/lib/prisma'
import { adjustRegistrationFeeBalance } from '@/lib/registration-fee'
import { publicImageUrl } from '@/lib/images'
import { validateLoginAccountValue, validateNicknameValue } from '@/lib/login-account'
import { checkBannedWords, NICKNAME_BANNED_WORD_MESSAGE, USERNAME_BANNED_WORD_MESSAGE, USERNAME_CONTAINS_BANNED_WORD } from '@/lib/content-moderation'
import { normalizeUserLocationInput } from '@/lib/user-location'
import { isValidBirthdayParts, type BirthdayParts } from '@/lib/zodiac'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { emitRealtime } from '@/lib/realtime'
import { createNotification } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { requireAdmin, sanitizeText } from '@/lib/security'
import {
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

  if (action === 'updateProfile') {
    const hasOwn = (key: string) => Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, key))
    const patch: AdminUserProfilePatch = {}

    if (hasOwn('username')) {
      const validation = validateLoginAccountValue(body.username)
      if (validation.error) return NextResponse.json({ message: validation.error, code: 'USERNAME_INVALID' }, { status: 400 })
      if ((await checkBannedWords(validation.account)).blocked) {
        return NextResponse.json({ error: USERNAME_CONTAINS_BANNED_WORD, message: USERNAME_BANNED_WORD_MESSAGE }, { status: 400 })
      }
      patch.username = { account: validation.account, usernameNormalized: validation.usernameNormalized }
    }

    if (hasOwn('nickname')) {
      const validation = validateNicknameValue(body.nickname)
      if (validation.error) return NextResponse.json({ message: validation.error, code: 'NICKNAME_INVALID' }, { status: 400 })
      if ((await checkBannedWords(validation.account)).blocked) {
        return NextResponse.json({ message: NICKNAME_BANNED_WORD_MESSAGE, code: USERNAME_CONTAINS_BANNED_WORD }, { status: 400 })
      }
      patch.nickname = validation.account
    }

    if (hasOwn('email') || hasOwn('phone')) {
      let contactPatch: ReturnType<typeof normalizeUserContactPatch>
      try {
        contactPatch = normalizeUserContactPatch({
          ...(hasOwn('email') ? { email: body.email } : {}),
          ...(hasOwn('phone') ? { phone: body.phone, phoneCountry: body.phoneCountry } : {}),
        })
      } catch (error) {
        if (error instanceof UserContactValidationError) {
          return NextResponse.json({ message: error.message, code: error.code }, { status: 400 })
        }
        throw error
      }
      if (hasOwn('email')) patch.email = contactPatch.email
      if (hasOwn('phone')) patch.phone = contactPatch.phone
      patch.phoneCountry = contactPatch.phoneCountry
    }

    if (hasOwn('bio')) patch.bio = sanitizeText(body.bio, 300)
    if (hasOwn('avatarUrl')) patch.avatarUrl = publicImageUrl(sanitizeText(body.avatarUrl, 500))
    if (hasOwn('backgroundUrl')) patch.backgroundUrl = publicImageUrl(sanitizeText(body.backgroundUrl, 500))
    if (hasOwn('birthdayPublic')) {
      if (typeof body.birthdayPublic !== 'boolean') return NextResponse.json({ message: '生日公开设置无效' }, { status: 400 })
      patch.birthdayPublic = body.birthdayPublic
    }
    if (hasOwn('showBadgeActivity')) {
      if (typeof body.showBadgeActivity !== 'boolean') return NextResponse.json({ message: '勋章动态设置无效' }, { status: 400 })
      patch.showBadgeActivity = body.showBadgeActivity
    }
    if (hasOwn('showBadgeProgressNotifications')) {
      if (typeof body.showBadgeProgressNotifications !== 'boolean') return NextResponse.json({ message: '勋章提醒设置无效' }, { status: 400 })
      patch.showBadgeProgressNotifications = body.showBadgeProgressNotifications
    }
    if (hasOwn('location')) {
      const location = normalizeUserLocationInput(body.location)
      if (location === undefined) return NextResponse.json({ message: '地区选择无效，请重新选择' }, { status: 400 })
      patch.location = location
    }
    if (hasOwn('wallVisibility')) {
      const wallVisibility = sanitizeText(body.wallVisibility, 20)
      if (!Object.values(ProfileWallVisibility).includes(wallVisibility as ProfileWallVisibility)) {
        return NextResponse.json({ message: '留言墙隐私设置无效' }, { status: 400 })
      }
      patch.wallVisibility = wallVisibility as AdminUserProfilePatch['wallVisibility']
    }

    const hasBirthMonth = hasOwn('birthMonth')
    const hasBirthDay = hasOwn('birthDay')
    if (hasBirthMonth || hasBirthDay) {
      const monthInput = hasBirthMonth ? body.birthMonth : null
      const dayInput = hasBirthDay ? body.birthDay : null
      const isEmpty = (value: unknown) => value == null || (typeof value === 'string' && value.trim() === '')
      const monthEmpty = isEmpty(monthInput)
      const dayEmpty = isEmpty(dayInput)
      if (monthEmpty && dayEmpty) {
        patch.birthday = null
      } else {
        if (monthEmpty) return NextResponse.json({ message: '请选择有效的出生月份' }, { status: 400 })
        if (dayEmpty) return NextResponse.json({ message: '请选择有效的出生日期' }, { status: 400 })
        const month = Number(monthInput)
        const day = Number(dayInput)
        if (!Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ message: '请选择有效的出生月份' }, { status: 400 })
        if (!Number.isInteger(day) || day < 1 || day > 31) return NextResponse.json({ message: '请选择有效的出生日期' }, { status: 400 })
        const birthday: BirthdayParts = { month, day }
        if (!isValidBirthdayParts(birthday)) return NextResponse.json({ message: '该日期不存在，请重新选择' }, { status: 400 })
        patch.birthday = birthday
      }
    }

    try {
      const result = await prisma.$transaction((tx) => updateAdminUserProfile(tx, {
        userId,
        adminId: guard.user.id,
        patch,
        reason: sanitizeText(body?.reason, 180) || '管理员编辑用户资料',
      }))
      invalidateCurrentUserCache(userId)
      if (result.changedFields.includes('username')) {
        await safeNotificationWrite(
          () => createNotification({
            data: {
              recipientId: userId,
              type: 'SYSTEM',
              title: '登录账号已由管理员修改',
              content: '您的登录账号已由管理员修改。下次登录时请使用新的登录账号。如非本人申请，请及时联系管理员。',
              link: '/settings/security',
            },
          }),
          { operation: 'admin-profile-login-account-changed', userId, notificationType: 'SYSTEM' },
        )
        emitRealtime(userId, 'notification')
      }
      if (result.birthdayChanged) {
        await triggerBadgeEvaluation(userId, 'USER_BIRTHDAY_UPDATED', new Date().toISOString())
      }
      return NextResponse.json({ user: result.user, changedFields: result.changedFields, message: result.changed ? '用户资料已更新' : '用户资料未发生变化' })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
      if (code === 'USERNAME_ALREADY_EXISTS') return NextResponse.json({ message: '该用户名已被使用', code }, { status: 409 })
      if (code === 'EMAIL_ALREADY_EXISTS') return NextResponse.json({ message: '该邮箱已绑定其他账号', code }, { status: 409 })
      if (code === 'PHONE_ALREADY_EXISTS') return NextResponse.json({ message: '该手机号已绑定其他账号', code }, { status: 409 })
      if (error instanceof MySqlAdvisoryLockBusyError) return NextResponse.json({ message: '资料修改正在处理中，请稍后重试', code: 'PROFILE_UPDATE_IN_PROGRESS' }, { status: 409 })
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target || '')
        if (target.includes('username')) return NextResponse.json({ message: '该用户名已被使用', code: 'USERNAME_ALREADY_EXISTS' }, { status: 409 })
        if (target.includes('phone')) return NextResponse.json({ message: '该手机号已绑定其他账号', code: 'PHONE_ALREADY_EXISTS' }, { status: 409 })
        if (target.includes('email')) return NextResponse.json({ message: '该邮箱已绑定其他账号', code: 'EMAIL_ALREADY_EXISTS' }, { status: 409 })
        return NextResponse.json({ message: '资料中的唯一字段已被其他用户使用', code: 'PROFILE_UNIQUE_CONFLICT' }, { status: 409 })
      }
      throw error
    }
  }

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
      const result = await prisma.$transaction((tx) => updateAdminUserContact(tx, {
        userId,
        adminId: guard.user.id,
        patch: contactPatch,
        reason: sanitizeText(body?.reason, 180) || '管理员修改用户联系方式',
      }))

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
      if (code === 'EMAIL_ALREADY_EXISTS') return NextResponse.json({ message: '该邮箱已绑定其他账号', code }, { status: 409 })
      if (code === 'PHONE_ALREADY_EXISTS') return NextResponse.json({ message: '该手机号已绑定其他账号', code }, { status: 409 })
      if (error instanceof MySqlAdvisoryLockBusyError) return NextResponse.json({ message: '已有联系方式修改正在处理中，请稍后重试', code: 'CONTACT_UPDATE_IN_PROGRESS' }, { status: 409 })
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target || '')
        if (target.includes('phone')) return NextResponse.json({ message: '该手机号已绑定其他账号', code: 'PHONE_ALREADY_EXISTS' }, { status: 409 })
        if (target.includes('email')) return NextResponse.json({ message: '该邮箱已绑定其他账号', code: 'EMAIL_ALREADY_EXISTS' }, { status: 409 })
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
