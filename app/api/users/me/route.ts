import { NextResponse } from 'next/server'
import { Prisma, ProfileWallVisibility, type VerificationStatus } from '@prisma/client'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { createVerificationForUser, isValidEmail, normalizeEmail, sendVerificationEmail } from '@/lib/email-verification'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'
import { validateLoginAccountValue, validateNicknameValue } from '@/lib/login-account'
import { getUsernameChangeAvailability } from '@/lib/username-change'
import { DEFAULT_PHONE_COUNTRY, getPhoneLookupVariants, isSupportedPhoneCountry, normalizePhoneNumber } from '@/lib/phone-number'
import { locationFromProfile, normalizeUserLocationInput } from '@/lib/user-location'
import { updateUserIpRegion } from '@/lib/ip-region'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, USERNAME_BANNED_WORD_MESSAGE, USERNAME_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { computeNicknameCooldownDays, generateUniqueViolationNickname } from '@/lib/nickname-violation'

const profileWallVisibilities = new Set<string>(Object.values(ProfileWallVisibility))

type UsernameChangeErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'USERNAME_CHANGE_COOLDOWN'
  | 'USERNAME_UNCHANGED'
  | 'USERNAME_ALREADY_EXISTS'

class UsernameChangeError extends Error {
  constructor(
    readonly code: UsernameChangeErrorCode,
    message: string,
    readonly nextAllowedAt: Date | null = null,
  ) {
    super(message)
  }
}

function serializeUsernameChange(lastChangedAt: Date | null | undefined, now = new Date()) {
  const availability = getUsernameChangeAvailability(lastChangedAt, now)
  return {
    lastChangedAt: availability.lastChangedAt?.toISOString() || null,
    nextAllowedAt: availability.nextAllowedAt?.toISOString() || null,
    canChange: availability.canChange,
  }
}

/**
 * 昵称修改冷却（需求 五）：冷却天数由 nicknameViolationCount 动态计算：
 *  - 0~1 次违规：30 天（普通修改 / 首次违规整改）
 *  - 2 次及以上违规：60 天（整改后再次违规）
 */
function getNicknameChangeAvailability(
  lastChangedAt: Date | null | undefined,
  cooldownDays: number,
  now = new Date(),
) {
  const canChange =
    !lastChangedAt ||
    now.getTime() - lastChangedAt.getTime() >= 1000 * 60 * 60 * 24 * cooldownDays
  const nextAllowedAt =
    lastChangedAt && !canChange
      ? new Date(lastChangedAt.getTime() + 1000 * 60 * 60 * 24 * cooldownDays)
      : null
  return { lastChangedAt, nextAllowedAt, canChange, cooldownDays }
}

function serializeNicknameChange(
  lastChangedAt: Date | null | undefined,
  cooldownDays: number,
  now = new Date(),
) {
  const availability = getNicknameChangeAvailability(lastChangedAt, cooldownDays, now)
  return {
    lastChangedAt: availability.lastChangedAt?.toISOString() || null,
    nextAllowedAt: availability.nextAllowedAt?.toISOString() || null,
    canChange: availability.canChange,
    cooldownDays: availability.cooldownDays,
  }
}

function usernameChangeErrorResponse(error: UsernameChangeError) {
  const status =
    error.code === 'ACCOUNT_NOT_FOUND'
      ? 404
      : error.code === 'USERNAME_ALREADY_EXISTS' || error.code === 'USERNAME_CHANGE_COOLDOWN'
        ? 409
        : 400

  return NextResponse.json({
    message: error.message,
    code: error.code,
    ...(error.nextAllowedAt ? { nextAllowedAt: error.nextAllowedAt.toISOString() } : {}),
  }, { status })
}

async function updateUsername(userId: string, rawUsername: unknown, request: Request) {
  const validation = validateLoginAccountValue(rawUsername)
  if (validation.error) {
    return NextResponse.json({ message: validation.error, code: 'USERNAME_INVALID' }, { status: 400 })
  }
  if ((await checkBannedWords(validation.account)).blocked) {
    return NextResponse.json({ error: USERNAME_CONTAINS_BANNED_WORD, message: USERNAME_BANNED_WORD_MESSAGE }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, uid: true, username: true, usernameNormalized: true, usernameChangedAt: true },
      })
      if (!current) throw new UsernameChangeError('ACCOUNT_NOT_FOUND', '账号不存在')

      if (validation.usernameNormalized === current.usernameNormalized) {
        throw new UsernameChangeError('USERNAME_UNCHANGED', '新用户名不能与当前用户名相同')
      }

      const now = new Date()
      const availability = getUsernameChangeAvailability(current.usernameChangedAt, now)
      if (!availability.canChange) {
        throw new UsernameChangeError('USERNAME_CHANGE_COOLDOWN', '用户名每个月只能修改一次', availability.nextAllowedAt)
      }

      const conflict = await tx.user.findUnique({
        where: { usernameNormalized: validation.usernameNormalized },
        select: { id: true },
      })
      if (conflict) throw new UsernameChangeError('USERNAME_ALREADY_EXISTS', '该用户名已被使用')

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          username: validation.account,
          usernameNormalized: validation.usernameNormalized,
          usernameChangedAt: now,
          usernameModerationStatus: 'NORMAL',
        },
        select: { id: true, uid: true, username: true, usernameChangedAt: true },
      })

      return {
        profile: updated,
        usernameChange: serializeUsernameChange(updated.usernameChangedAt, now),
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    invalidateCurrentUserCache(userId)
    void updateUserIpRegion(userId, request)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof UsernameChangeError) return usernameChangeErrorResponse(error)

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return usernameChangeErrorResponse(new UsernameChangeError('USERNAME_ALREADY_EXISTS', '该用户名已被使用'))
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      const latest = await prisma.user.findUnique({
        where: { id: userId },
        select: { usernameChangedAt: true },
      })
      const availability = getUsernameChangeAvailability(latest?.usernameChangedAt)
      if (latest && !availability.canChange) {
        return usernameChangeErrorResponse(new UsernameChangeError('USERNAME_CHANGE_COOLDOWN', '用户名每个月只能修改一次', availability.nextAllowedAt))
      }
      return NextResponse.json({ message: '用户名修改未完成，请稍后重试', code: 'USERNAME_CHANGE_CONFLICT' }, { status: 409 })
    }

    console.error('[users/me.username]', error)
    return NextResponse.json({ message: '用户名修改失败，请稍后重试', code: 'USERNAME_CHANGE_FAILED' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 240, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
    endpoint: '/api/users/me',
  })
  if (limited) return limited

  const profile = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: {
      email: true,
      phone: true,
      nickname: true,
      uid: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      birthMonth: true,
      birthDay: true,
      birthdaySetAt: true,
      birthdayPublic: true,
      showBadgeActivity: true,
      showBadgeProgressNotifications: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      bioModerationStatus: true,
      usernameChangedAt: true,
      nicknameChangedAt: true,
      nicknameViolationCount: true,
      Profile: {
        select: {
          displayName: true,
          avatarUrl: true,
          backgroundUrl: true,
          bio: true,
          displayNameModerationStatus: true,
          bioModerationStatus: true,
          locationCountryCode: true,
          locationCountry: true,
          locationRegionCode: true,
          locationRegion: true,
          wallVisibility: true,
        },
      },
      UserBadge: {
        where: { isHidden: false },
        orderBy: { displayOrder: 'asc' },
        select: {
          grantedAt: true,
          displayOrder: true,
          Badge: {
            select: {
              name: true,
              description: true,
              iconUrl: true,
            },
          },
        },
      },
      _count: {
        select: {
          Post: true,
          Reply: true,
          Follow_Follow_followingIdToUser: true,
          Follow_Follow_followerIdToUser: true,
        },
      },
    },
  })

  if (!profile) return NextResponse.json({ profile: null })
  const { Profile, UserBadge, _count, usernameChangedAt, nicknameChangedAt, nicknameViolationCount } = profile
  return NextResponse.json({
    profile: {
      email: profile.email,
      phone: profile.phone,
      emailVerifiedAt: profile.emailVerifiedAt,
      phoneVerifiedAt: profile.phoneVerifiedAt,
      nickname: profile.nickname,
      nicknameModerationStatus: profile.nicknameModerationStatus,
      nicknameViolationDisplay: profile.nicknameViolationDisplay,
      bioModerationStatus: profile.bioModerationStatus,
      uid: profile.uid,
      avatarUrl: publicImageUrl(profile.avatarUrl),
      backgroundUrl: publicImageUrl(profile.backgroundUrl),
      bio: profile.bio,
      birthMonth: profile.birthMonth,
      birthDay: profile.birthDay,
      birthdaySetAt: profile.birthdaySetAt,
      birthdayPublic: profile.birthdayPublic,
      showBadgeActivity: profile.showBadgeActivity,
      showBadgeProgressNotifications: profile.showBadgeProgressNotifications,
      profile: Profile ? {
        displayName: Profile.displayName,
        avatarUrl: publicImageUrl(Profile.avatarUrl),
        backgroundUrl: publicImageUrl(Profile.backgroundUrl),
        bio: Profile.bio,
        displayNameModerationStatus: Profile.displayNameModerationStatus,
        bioModerationStatus: Profile.bioModerationStatus,
        wallVisibility: Profile.wallVisibility,
        location: locationFromProfile(Profile),
      } : Profile,
      badges: UserBadge.map(({ Badge, grantedAt, displayOrder }) => {
        const imageUrl = publicImageUrl(Badge.iconUrl)
        return {
          grantedAt,
          displayOrder,
          badge: {
            name: Badge.name,
            description: Badge.description,
            iconUrl: imageUrl,
            imageUrl,
          },
        }
      }),
      _count: {
        posts: _count.Post,
        replies: _count.Reply,
        followers: _count.Follow_Follow_followingIdToUser,
        following: _count.Follow_Follow_followerIdToUser,
      },
    },
    usernameChange: serializeUsernameChange(usernameChangedAt),
    nicknameChange: serializeNicknameChange(nicknameChangedAt, computeNicknameCooldownDays(nicknameViolationCount ?? 0)),
  })
}

export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
    endpoint: '/api/users/me',
  }, '资料修改过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'newUsername')) {
    return updateUsername(guard.user.id, body.newUsername, request)
  }

  const rawNickname = typeof body?.nickname === 'string' ? body.nickname : ''
  const nickname = sanitizeText(body?.nickname, 32)
  const bio = sanitizeText(body?.bio, 300)

  // 昵称命中违禁词：不再拒绝，改为「系统自动替换」流程（需求 三 / 四）。
  // 保留真实昵称，标记违规并生成唯一展示昵称；bio 仍按原规则拦截。
  let nicknameViolation: { reason: string; matchedWords: string[] } | null = null
  if (nickname) {
    const result = await checkBannedWords(nickname)
    if (result.blocked) {
      nicknameViolation = { reason: 'BANNED_WORD', matchedWords: result.matchedWords }
    }
  }
  if (body?.bio !== undefined && (await checkBannedWords(bio)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }
  const avatarUrl = sanitizeText(body?.avatarUrl, 500)
  const backgroundUrl = sanitizeText(body?.backgroundUrl, 500)
  const email = body?.email === undefined ? undefined : normalizeEmail(body.email)
  const phone = body?.phone === undefined ? undefined : sanitizeText(body.phone, 20).replace(/\s+/g, '')
  const phoneCountry = isSupportedPhoneCountry(body?.phoneCountry) ? body.phoneCountry : DEFAULT_PHONE_COUNTRY
  const normalizedPhone = phone ? normalizePhoneNumber(phone, phoneCountry) : null
  const requestedWallVisibility = body?.wallVisibility === undefined ? undefined : sanitizeText(body.wallVisibility, 20)
  const wallVisibility = requestedWallVisibility as ProfileWallVisibility | undefined
  // 生日公开开关：只控制生日祝福卡片是否展示生日日期，不影响生日纪念通知与卡片本身。
  const birthdayPublic = typeof body?.birthdayPublic === 'boolean' ? body.birthdayPublic : undefined
  const showBadgeActivity = typeof body?.showBadgeActivity === 'boolean' ? body.showBadgeActivity : undefined
  const showBadgeProgressNotifications = typeof body?.showBadgeProgressNotifications === 'boolean' ? body.showBadgeProgressNotifications : undefined
  const hasLocation = Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'location'))
  const location = hasLocation ? normalizeUserLocationInput(body.location) : undefined
  if (hasLocation && location === undefined) {
    return NextResponse.json({ message: '地区选择无效，请重新选择' }, { status: 400 })
  }

  const birthMonthRaw = body?.birthMonth === undefined || body?.birthMonth === null ? undefined : Number(body.birthMonth)
  const birthDayRaw = body?.birthDay === undefined || body?.birthDay === null ? undefined : Number(body.birthDay)

  const data: {
    nickname?: string
    bio?: string
    nicknameModerationStatus?: 'NORMAL'
    bioModerationStatus?: 'NORMAL'
    avatarUrl?: string | null
    backgroundUrl?: string | null
    email?: string | null
    phone?: string | null
    emailVerifiedAt?: Date | null
    phoneVerifiedAt?: Date | null
    verificationStatus?: VerificationStatus
    birthMonth?: number
    birthDay?: number
    birthdaySetAt?: Date
    birthdayPublic?: boolean
    showBadgeActivity?: boolean
    showBadgeProgressNotifications?: boolean
  } = {}

  if (body?.bio !== undefined) {
    data.bio = bio
    data.bioModerationStatus = 'NORMAL'
  }
  // 头像/背景图只允许保存有效 COS 等地址；失效的 Supabase 地址一律清空
  if (body?.avatarUrl !== undefined) data.avatarUrl = publicImageUrl(avatarUrl)
  if (body?.backgroundUrl !== undefined) data.backgroundUrl = publicImageUrl(backgroundUrl)
  if (email !== undefined) {
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ message: '请输入有效邮箱' }, { status: 400 })
    }
    data.email = email || null
  }
  if (phone !== undefined) {
    if (phone && !normalizedPhone) {
      return NextResponse.json({ message: '手机号格式不正确', code: 'INVALID_PHONE', errors: { phone: '手机号格式不正确' } }, { status: 400 })
    }
    data.phone = normalizedPhone?.e164 || null
  }
  if (requestedWallVisibility !== undefined && !profileWallVisibilities.has(requestedWallVisibility)) {
    return NextResponse.json({ message: '留言墙隐私设置无效' }, { status: 400 })
  }

  const current = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: {
      nickname: true,
      nicknameChangedAt: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      nicknameViolationCount: true,
      email: true,
      phone: true,
      birthMonth: true,
      birthDay: true,
      birthdaySetAt: true,
    },
  })

  if (!current) return NextResponse.json({ message: '账号不存在' }, { status: 404 })

  if (rawNickname && rawNickname !== current.nickname) {
    const nicknameValidation = validateNicknameValue(rawNickname)
    if (nicknameValidation.error) return NextResponse.json({ message: nicknameValidation.error }, { status: 400 })
  }

  const currentEmail = normalizeEmail(current.email)
  const emailChanged = email !== undefined && data.email !== currentEmail
  if (emailChanged) {
    if (data.email) {
      const existing = await prisma.user.findFirst({
        where: { email: data.email, isDeleted: false, NOT: { id: guard.user.id } },
        select: { id: true },
      })
      if (existing) return NextResponse.json({ message: '该邮箱已被绑定' }, { status: 409 })
    }
    data.emailVerifiedAt = null
    data.verificationStatus = data.email ? 'PENDING' : 'NONE'
  }

  const currentPhoneE164 = current.phone ? normalizePhoneNumber(current.phone, phoneCountry)?.e164 : null
  const phoneChanged = phone !== undefined && data.phone !== current.phone && data.phone !== currentPhoneE164
  if (phone !== undefined && data.phone) {
    const phoneVariants = getPhoneLookupVariants(data.phone, normalizedPhone?.country || phoneCountry)
    const existing = await prisma.user.findFirst({
      where: { phone: { in: phoneVariants }, isDeleted: false, NOT: { id: guard.user.id } },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ message: '该手机号已被绑定' }, { status: 409 })
  }
  if (phoneChanged) {
    data.phoneVerifiedAt = null
  }

  const now = new Date()

  // 生日：填写一次后不可修改。仅在尚未设置时接受首次填写。
  const birthdayAlreadySet = Boolean(current?.birthdaySetAt)
  if (!birthdayAlreadySet && birthMonthRaw !== undefined && birthDayRaw !== undefined) {
    if (!Number.isInteger(birthMonthRaw) || birthMonthRaw < 1 || birthMonthRaw > 12) {
      return NextResponse.json({ message: '请选择有效的出生月份' }, { status: 400 })
    }
    if (!Number.isInteger(birthDayRaw) || birthDayRaw < 1 || birthDayRaw > 31) {
      return NextResponse.json({ message: '请选择有效的出生日期' }, { status: 400 })
    }
    // 校验该日期真实存在（含闰年 2 月 29 日，用闰年 2020 校验）。
    const probe = new Date(2020, birthMonthRaw - 1, birthDayRaw)
    if (probe.getMonth() !== birthMonthRaw - 1 || probe.getDate() !== birthDayRaw) {
      return NextResponse.json({ message: '该日期不存在，请重新选择' }, { status: 400 })
    }
    data.birthMonth = birthMonthRaw
    data.birthDay = birthDayRaw
    data.birthdaySetAt = now
  }

  if (birthdayPublic !== undefined) data.birthdayPublic = birthdayPublic
  if (showBadgeActivity !== undefined) data.showBadgeActivity = showBadgeActivity
  if (showBadgeProgressNotifications !== undefined) data.showBadgeProgressNotifications = showBadgeProgressNotifications

  const nicknameChanged = Boolean(nickname && current && nickname !== current.nickname)
  const currentCooldownDays = computeNicknameCooldownDays(current?.nicknameViolationCount ?? 0)
  const canChangeNickname =
    !nicknameChanged ||
    !current?.nicknameChangedAt ||
    now.getTime() - current.nicknameChangedAt.getTime() >= 1000 * 60 * 60 * 24 * currentCooldownDays

  if (nicknameChanged && !canChangeNickname) {
    const nextAllowedAt = new Date(current.nicknameChangedAt!.getTime() + 1000 * 60 * 60 * 24 * currentCooldownDays)
    const daysRemaining = Math.max(1, Math.ceil((nextAllowedAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    return NextResponse.json({
      code: 'NICKNAME_CHANGE_COOLDOWN',
      message: `昵称每 ${currentCooldownDays} 天只能修改一次，距离下次修改还有 ${daysRemaining} 天`,
      nextAllowedAt: nextAllowedAt.toISOString(),
    }, { status: 429, headers: { 'Retry-After': String(daysRemaining * 24 * 60 * 60) } })
  }

  const profile = await prisma.$transaction(async (tx) => {
    // 昵称处理：违规 → 系统自动替换并生成唯一展示昵称；正常 / 修正 → 清除违规标记。
    const isNicknameViolation = Boolean(nicknameViolation)
    const nicknameUpdate: Prisma.UserUpdateInput = {}
    if (nickname) {
      if (isNicknameViolation) {
        const count = (current?.nicknameViolationCount || 0) + 1
        const display = await generateUniqueViolationNickname(tx, Math.random)
        nicknameUpdate.nickname = nickname
        nicknameUpdate.nicknameModerationStatus = 'VIOLATION'
        nicknameUpdate.nicknameViolationDisplay = display
        nicknameUpdate.nicknameViolationCount = count
        nicknameUpdate.nicknameChangedAt = now
      } else {
        nicknameUpdate.nickname = nickname
        nicknameUpdate.nicknameModerationStatus = 'NORMAL'
        nicknameUpdate.nicknameViolationDisplay = null
        nicknameUpdate.nicknameChangedAt = now
      }
    }

    const updated = await tx.user.update({
      where: { id: guard.user.id },
      data: {
        ...data,
        ...nicknameUpdate,
      },
      select: {
        uid: true,
        nickname: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        avatarUrl: true,
        backgroundUrl: true,
        bio: true,
        nicknameModerationStatus: true,
        nicknameViolationDisplay: true,
        nicknameViolationCount: true,
        showBadgeActivity: true,
        showBadgeProgressNotifications: true,
      },
    })

    // 修正违规：关闭最近一条尚未解决的违规记录（需求 三 / 六）。
    if (nickname && !isNicknameViolation && current?.nicknameModerationStatus === 'VIOLATION') {
      const openLog = await tx.nicknameViolationLog.findFirst({
        where: { userId: guard.user.id, resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (openLog) {
        await tx.nicknameViolationLog.update({
          where: { id: openLog.id },
          data: { resolvedAt: now, resolvedNickname: nickname },
        })
      }
    }

    // 昵称违规：写一条违规记录（需求 六）。
    if (nickname && isNicknameViolation) {
      await tx.nicknameViolationLog.create({
        data: {
          userId: guard.user.id,
          originalNickname: nickname,
          reason: nicknameViolation!.reason,
          generatedDisplayName: updated.nicknameViolationDisplay!,
          violationCount: updated.nicknameViolationCount!,
        },
      })
    }

    const profileRecord = await tx.profile.upsert({
      where: { userId: guard.user.id },
      update: {
        ...(nickname && !isNicknameViolation ? { displayName: nickname, displayNameModerationStatus: 'NORMAL' as const } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        ...(data.backgroundUrl !== undefined ? { backgroundUrl: data.backgroundUrl } : {}),
        ...(data.bio !== undefined ? { bio: data.bio, bioModerationStatus: 'NORMAL' as const } : {}),
        ...(wallVisibility !== undefined ? { wallVisibility } : {}),
        ...(location !== undefined ? {
          locationCountryCode: location?.countryCode || null,
          locationCountry: location?.countryName || null,
          locationRegionCode: location?.regionCode || null,
          locationRegion: location?.regionName || null,
        } : {}),
      },
      create: {
        userId: guard.user.id,
        displayName: updated.nickname,
        avatarUrl: updated.avatarUrl,
        backgroundUrl: updated.backgroundUrl,
        bio: updated.bio,
        wallVisibility: wallVisibility || 'PUBLIC',
        ...(location ? {
          locationCountryCode: location.countryCode,
          locationCountry: location.countryName,
          locationRegionCode: location.regionCode,
          locationRegion: location.regionName,
        } : {}),
      },
      select: {
        wallVisibility: true,
        locationCountryCode: true,
        locationCountry: true,
        locationRegionCode: true,
        locationRegion: true,
      },
    })

    return {
      uid: updated.uid,
      nickname: updated.nickname,
      email: updated.email,
      phone: updated.phone,
      emailVerifiedAt: updated.emailVerifiedAt,
      phoneVerifiedAt: updated.phoneVerifiedAt,
      avatarUrl: updated.avatarUrl,
      backgroundUrl: updated.backgroundUrl,
      bio: updated.bio,
      nicknameModerationStatus: updated.nicknameModerationStatus,
      nicknameViolationDisplay: updated.nicknameViolationDisplay,
      showBadgeActivity: updated.showBadgeActivity,
      showBadgeProgressNotifications: updated.showBadgeProgressNotifications,
      wallVisibility: profileRecord.wallVisibility,
      location: profileRecord.locationCountryCode ? {
        countryCode: profileRecord.locationCountryCode,
        countryName: profileRecord.locationCountry || profileRecord.locationCountryCode,
        regionCode: profileRecord.locationRegionCode,
        regionName: profileRecord.locationRegion,
      } : null,
    }
  })

  invalidateCurrentUserCache(guard.user.id)
  void updateUserIpRegion(guard.user.id, request)

  profile.avatarUrl = publicImageUrl(profile.avatarUrl)
  profile.backgroundUrl = publicImageUrl(profile.backgroundUrl)

  let emailVerificationSent = false
  if (profile.email && emailChanged) {
    const verification = await createVerificationForUser(guard.user.id, profile.email)
    await sendVerificationEmail(profile.email, verification.verificationUrl, 'change-email')
    emailVerificationSent = true
  }

  return NextResponse.json({
    profile,
    emailVerificationSent,
    nicknameUpdated: !nicknameChanged || canChangeNickname,
    nicknameViolation: Boolean(nicknameViolation),
    nicknameMessage: nicknameChanged && !canChangeNickname
      ? `昵称每 ${currentCooldownDays} 天只能修改一次，其他资料已保存`
      : nicknameViolation
        ? '昵称包含违禁词，已被系统替换为临时展示昵称，整改后可重新修改'
        : undefined,
  })
}
