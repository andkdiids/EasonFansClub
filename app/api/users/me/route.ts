import { NextResponse } from 'next/server'
import { Gender, Prisma, ProfileWallVisibility } from '@prisma/client'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/email-verification'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { activeUserBadgeWhere } from '@/lib/badge-validity'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'
import { normalizeLoginAccount, validateLoginAccountValue, validateNicknameValue } from '@/lib/login-account'
import { getUsernameChangeAvailability } from '@/lib/username-change'
import { DEFAULT_PHONE_COUNTRY, getPhoneLookupVariants, isSupportedPhoneCountry, normalizePhoneNumber } from '@/lib/phone-number'
import { locationFromProfile, normalizeUserLocationInput } from '@/lib/user-location'
import { updateUserIpRegion } from '@/lib/ip-region'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, USERNAME_BANNED_WORD_MESSAGE, USERNAME_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { computeNicknameCooldownDays, generateUniqueViolationNickname } from '@/lib/nickname-violation'
import { getNicknameChangeAvailability, serializeNicknameChange } from '@/lib/nickname-change'
import { isValidBirthdayParts, type BirthdayParts } from '@/lib/zodiac'
import {
  BIRTHDAY_ALREADY_SET,
  BIRTHDAY_ALREADY_SET_MESSAGE,
  BIRTHDATE_SELF_EDIT_EXHAUSTED,
  BIRTHDATE_SELF_EDIT_EXHAUSTED_MESSAGE,
  BirthdayAlreadySetError,
  BirthdaySelfEditExhaustedError,
  getBirthdayEditState,
  updateUserBirthdate,
} from '@/lib/birthday-immutability'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { getEquippedBadgesForUser } from '@/lib/badge-service'
import { writeUserOperationLog } from '@/lib/user-operation-log'
import { CUSTOM_GENDER_MAX_LENGTH, validateGenderInput } from '@/lib/gender'
import { refreshProfileCompletion } from '@/lib/growth-tasks/service'

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

type NicknameChangeErrorCode = 'NICKNAME_CHANGE_COOLDOWN' | 'NICKNAME_CHANGE_CONFLICT'

class NicknameChangeError extends Error {
  constructor(
    readonly code: NicknameChangeErrorCode,
    message: string,
    readonly nextAllowedAt: Date | null = null,
  ) {
    super(message)
  }
}

function profileFieldError(field: string, code: string, message: string, status = 400) {
  return NextResponse.json({
    field,
    code,
    message,
    errors: { [field]: message },
  }, { status })
}

function nicknameChangeErrorResponse(error: NicknameChangeError, now = new Date()) {
  const secondsRemaining = error.nextAllowedAt
    ? Math.max(1, Math.ceil((error.nextAllowedAt.getTime() - now.getTime()) / 1000))
    : null
  return NextResponse.json({
    field: 'nickname',
    code: error.code,
    message: error.message,
    errors: { nickname: error.message },
    ...(error.nextAllowedAt ? { nextAllowedAt: error.nextAllowedAt.toISOString() } : {}),
  }, {
    status: error.code === 'NICKNAME_CHANGE_COOLDOWN' ? 429 : 409,
    ...(secondsRemaining ? { headers: { 'Retry-After': String(secondsRemaining) } } : {}),
  })
}

function birthdayAlreadySetResponse() {
  return NextResponse.json({
    field: 'birthday',
    code: BIRTHDAY_ALREADY_SET,
    error: BIRTHDAY_ALREADY_SET,
    message: BIRTHDAY_ALREADY_SET_MESSAGE,
    errors: { birthday: BIRTHDAY_ALREADY_SET_MESSAGE },
  }, { status: 409 })
}

function birthdayMutationErrorResponse(error: unknown) {
  if (error instanceof BirthdaySelfEditExhaustedError) {
    return NextResponse.json({
      field: 'birthday',
      code: BIRTHDATE_SELF_EDIT_EXHAUSTED,
      error: BIRTHDATE_SELF_EDIT_EXHAUSTED,
      message: BIRTHDATE_SELF_EDIT_EXHAUSTED_MESSAGE,
      errors: { birthday: BIRTHDATE_SELF_EDIT_EXHAUSTED_MESSAGE },
    }, { status: 409 })
  }
  if (error instanceof BirthdayAlreadySetError) return birthdayAlreadySetResponse()
  return null
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

  const now = new Date()
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
      gender: true,
      customGender: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      birthMonth: true,
      birthDay: true,
      birthdaySetAt: true,
      birthdateSelfEditCount: true,
      birthdayPublic: true,
      showBadgeActivity: true,
      showBadgeProgressNotifications: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      bioModerationStatus: true,
      usernameChangedAt: true,
      nicknameChangedAt: true,
      nicknameFreeChangeUsedAt: true,
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
        where: { isHidden: false, ...activeUserBadgeWhere(now) },
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
  const { Profile, UserBadge, _count, usernameChangedAt, nicknameChangedAt, nicknameFreeChangeUsedAt, nicknameViolationCount } = profile
  const birthdayState = getBirthdayEditState(profile)
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
      gender: profile.gender,
      customGender: profile.customGender,
      birthMonth: profile.birthMonth,
      birthDay: profile.birthDay,
      birthdaySetAt: profile.birthdaySetAt,
      birthdateSelfEditCount: birthdayState.birthdateSelfEditCount,
      hasBirthdate: birthdayState.hasBirthdate,
      canEditBirthdate: birthdayState.canEditBirthdate,
      birthdateCanEdit: birthdayState.canEditBirthdate,
      birthdateEditUsed: birthdayState.birthdateEditUsed,
      birthdayEditRemaining: birthdayState.birthdayEditRemaining,
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
    nicknameChange: serializeNicknameChange(
      nicknameChangedAt,
      nicknameFreeChangeUsedAt,
      computeNicknameCooldownDays(nicknameViolationCount ?? 0),
      now,
    ),
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

  const hasBodyField = (field: string) => Boolean(
    body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, field),
  )
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return profileFieldError('form', 'INVALID_INPUT', '资料格式无效，请重新提交')
  }

  const nicknameProvided = hasBodyField('nickname')
  const rawNickname = nicknameProvided && typeof body.nickname === 'string' ? body.nickname.trim() : ''
  const nickname = nicknameProvided ? sanitizeText(body.nickname, 32).trim() : undefined
  if (nicknameProvided && !rawNickname) {
    return profileFieldError('nickname', 'NICKNAME_REQUIRED', '请输入昵称')
  }
  const bio = sanitizeText(body?.bio, 300)

  // 昵称命中违禁词：不再拒绝，改为「系统自动替换」流程（需求 三 / 四）。
  // 保留真实昵称，标记违规并生成唯一展示昵称；bio 仍按原规则拦截。
  let nicknameViolation: { reason: string; matchedWords: string[] } | null = null
  if (nicknameProvided && nickname) {
    const result = await checkBannedWords(nickname)
    if (result.blocked) {
      nicknameViolation = { reason: 'BANNED_WORD', matchedWords: result.matchedWords }
    }
  }
  if (body?.bio !== undefined && (await checkBannedWords(bio)).blocked) {
    return profileFieldError('bio', CONTENT_CONTAINS_BANNED_WORD, BANNED_WORD_MESSAGE)
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
  const hasGenderFields = hasBodyField('gender') || hasBodyField('customGender')
  const genderBaseline = hasGenderFields && !hasBodyField('gender') || hasGenderFields && !hasBodyField('customGender')
    ? await prisma.user.findUnique({
        where: { id: guard.user.id },
        select: { gender: true, customGender: true },
      })
    : null
  let genderUpdate: { gender: Gender | null; customGender: string | null } | undefined
  if (hasGenderFields) {
    const rawCustomGender = hasBodyField('customGender') ? body.customGender : genderBaseline?.customGender
    const customGenderInput = typeof rawCustomGender === 'string'
      ? rawCustomGender.slice(0, Math.max(5000, CUSTOM_GENDER_MAX_LENGTH * 4))
      : rawCustomGender
    const genderValidation = validateGenderInput(
      hasBodyField('gender') ? body.gender : genderBaseline?.gender,
      customGenderInput,
    )
    if (genderValidation.error) {
      return profileFieldError(
        genderValidation.gender === 'CUSTOM' ? 'customGender' : 'gender',
        'INVALID_GENDER',
        genderValidation.error,
      )
    }
    if (genderValidation.customGender && (await checkBannedWords(genderValidation.customGender)).blocked) {
      return profileFieldError('customGender', CONTENT_CONTAINS_BANNED_WORD, BANNED_WORD_MESSAGE)
    }
    genderUpdate = {
      gender: genderValidation.gender as Gender | null,
      customGender: genderValidation.customGender,
    }
  }

  const hasLocation = Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'location'))
  const location = hasLocation ? normalizeUserLocationInput(body.location) : undefined
  if (hasLocation && location === undefined) {
    return profileFieldError('location', 'INVALID_LOCATION', '地区选择无效，请重新选择')
  }

  const hasBirthMonth = hasBodyField('birthMonth')
  const hasBirthDay = hasBodyField('birthDay')
  const birthdayFieldsProvided = hasBirthMonth || hasBirthDay
  let requestedBirthday: BirthdayParts | null | undefined
  if (birthdayFieldsProvided) {
    const monthInput = hasBirthMonth ? body.birthMonth : null
    const dayInput = hasBirthDay ? body.birthDay : null
    const isEmptyBirthdayInput = (value: unknown) => value == null || (typeof value === 'string' && value.trim() === '')
    const monthEmpty = isEmptyBirthdayInput(monthInput)
    const dayEmpty = isEmptyBirthdayInput(dayInput)

    if (monthEmpty && dayEmpty) {
      // An unconfigured form submits two empty fields when saving other data.
      // The shared birthday service treats that as a no-op, but rejects it if
      // a birthday already exists.
      requestedBirthday = null
    } else {
      if (monthEmpty) return profileFieldError('birthMonth', 'INVALID_BIRTHDAY', '请选择完整的出生月份')
      if (dayEmpty) return profileFieldError('birthDay', 'INVALID_BIRTHDAY', '请选择完整的出生日期')

      const birthMonthRaw = Number(monthInput)
      const birthDayRaw = Number(dayInput)
      if (!Number.isInteger(birthMonthRaw) || birthMonthRaw < 1 || birthMonthRaw > 12) {
        return profileFieldError('birthMonth', 'INVALID_BIRTHDAY', '请选择有效的出生月份')
      }
      if (!Number.isInteger(birthDayRaw) || birthDayRaw < 1 || birthDayRaw > 31) {
        return profileFieldError('birthDay', 'INVALID_BIRTHDAY', '请选择有效的出生日期')
      }
      if (!isValidBirthdayParts({ month: birthMonthRaw, day: birthDayRaw })) {
        return profileFieldError('birthday', 'INVALID_BIRTHDAY', '该日期不存在，请重新选择')
      }
      requestedBirthday = { month: birthMonthRaw, day: birthDayRaw }
    }
  }

  const data: {
    nickname?: string
    bio?: string
    nicknameModerationStatus?: 'NORMAL'
    bioModerationStatus?: 'NORMAL'
    avatarUrl?: string | null
    backgroundUrl?: string | null
    phone?: string | null
    phoneVerifiedAt?: Date | null
    birthdayPublic?: boolean
    showBadgeActivity?: boolean
    showBadgeProgressNotifications?: boolean
    gender?: Gender | null
    customGender?: string | null
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
      return profileFieldError('email', 'INVALID_EMAIL', '请输入有效邮箱')
    }
  }
  if (phone !== undefined) {
    if (phone && !normalizedPhone) {
      return profileFieldError('phone', 'INVALID_PHONE', '手机号格式不正确')
    }
    data.phone = normalizedPhone?.e164 || null
  }
  if (requestedWallVisibility !== undefined && !profileWallVisibilities.has(requestedWallVisibility)) {
    return profileFieldError('wallVisibility', 'INVALID_WALL_VISIBILITY', '留言墙隐私设置无效')
  }
  if (genderUpdate) Object.assign(data, genderUpdate)

  const current = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: {
      nickname: true,
      nicknameChangedAt: true,
      nicknameFreeChangeUsedAt: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      nicknameViolationCount: true,
      email: true,
      phone: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      gender: true,
      customGender: true,
      birthMonth: true,
      birthDay: true,
      birthdayPublic: true,
      showBadgeActivity: true,
      showBadgeProgressNotifications: true,
      Profile: {
        select: {
          displayName: true,
          avatarUrl: true,
          backgroundUrl: true,
          bio: true,
          wallVisibility: true,
          locationCountryCode: true,
          locationCountry: true,
          locationRegionCode: true,
          locationRegion: true,
        },
      },
    },
  })

  if (!current) return NextResponse.json({ message: '账号不存在' }, { status: 404 })

  const nicknameValidation = nicknameProvided ? validateNicknameValue(rawNickname) : null
  if (nicknameValidation?.error) return profileFieldError('nickname', 'INVALID_NICKNAME', nicknameValidation.error)

  const currentEmail = normalizeEmail(current.email)
  const emailChanged = email !== undefined && email !== currentEmail
  if (emailChanged) {
    return profileFieldError('email', 'EMAIL_VERIFICATION_REQUIRED', '请先发送并验证邮箱验证码后再绑定', 409)
  }

  const currentPhoneE164 = current.phone ? normalizePhoneNumber(current.phone, phoneCountry)?.e164 : null
  const phoneChanged = phone !== undefined && data.phone !== current.phone && data.phone !== currentPhoneE164
  if (phone !== undefined && data.phone) {
    const phoneVariants = getPhoneLookupVariants(data.phone, normalizedPhone?.country || phoneCountry)
    const existing = await prisma.user.findFirst({
      where: { phone: { in: phoneVariants }, isDeleted: false, NOT: { id: guard.user.id } },
      select: { id: true },
    })
    if (existing) return profileFieldError('phone', 'PHONE_TAKEN', '该手机号已被绑定', 409)
  }
  if (phoneChanged) {
    data.phoneVerifiedAt = null
  }

  const now = new Date()

  if (birthdayPublic !== undefined) data.birthdayPublic = birthdayPublic
  if (showBadgeActivity !== undefined) data.showBadgeActivity = showBadgeActivity
  if (showBadgeProgressNotifications !== undefined) data.showBadgeProgressNotifications = showBadgeProgressNotifications

  let nicknameChanged = Boolean(
    nicknameProvided
      && nickname
      && nicknameValidation
      && nicknameValidation.usernameNormalized !== normalizeLoginAccount(current.nickname),
  )
  const currentCooldownDays = computeNicknameCooldownDays(current?.nicknameViolationCount ?? 0)
  const nicknameAvailability = getNicknameChangeAvailability({
    lastChangedAt: current.nicknameChangedAt,
    freeChangeUsedAt: current.nicknameFreeChangeUsedAt,
    cooldownDays: currentCooldownDays,
    now,
  })

  if (nicknameChanged && !nicknameAvailability.canChange) {
    const nextAllowedAt = nicknameAvailability.nextAllowedAt
    const daysRemaining = nextAllowedAt
      ? Math.max(1, Math.ceil((nextAllowedAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : currentCooldownDays
    return nicknameChangeErrorResponse(
      new NicknameChangeError(
        'NICKNAME_CHANGE_COOLDOWN',
        `昵称每 ${currentCooldownDays} 天只能修改一次，距离下次修改还有 ${daysRemaining} 天`,
        nextAllowedAt,
      ),
      now,
    )
  }

  let birthdayChanged = false
  let birthdayMutation: Awaited<ReturnType<typeof updateUserBirthdate>> | null = null
  let nicknameUsedFreeOpportunity = false
  try {
    const profile = await prisma.$transaction(async (tx) => {
      if (birthdayFieldsProvided) {
        const result = await updateUserBirthdate(tx, {
          targetUserId: guard.user.id,
          birthdate: requestedBirthday || null,
          actor: 'SELF',
          now,
        })
        birthdayMutation = result
        birthdayChanged = result.changed
      }

      const mutationCurrent = await tx.user.findUnique({
        where: { id: guard.user.id },
        select: {
          nickname: true,
          nicknameChangedAt: true,
          nicknameFreeChangeUsedAt: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          nicknameViolationCount: true,
          email: true,
          phone: true,
          avatarUrl: true,
          backgroundUrl: true,
          bio: true,
          gender: true,
          customGender: true,
          birthdayPublic: true,
          showBadgeActivity: true,
          showBadgeProgressNotifications: true,
          Profile: {
            select: {
              wallVisibility: true,
              locationCountryCode: true,
              locationCountry: true,
              locationRegionCode: true,
              locationRegion: true,
            },
          },
        },
      })
      if (!mutationCurrent) throw new Error('USER_NOT_FOUND')

      nicknameChanged = Boolean(
        nicknameProvided
          && nickname
          && nicknameValidation
          && nicknameValidation.usernameNormalized !== normalizeLoginAccount(mutationCurrent.nickname),
      )
      const mutationNicknameAvailability = getNicknameChangeAvailability({
        lastChangedAt: mutationCurrent.nicknameChangedAt,
        freeChangeUsedAt: mutationCurrent.nicknameFreeChangeUsedAt,
        cooldownDays: computeNicknameCooldownDays(mutationCurrent.nicknameViolationCount ?? 0),
        now,
      })
      if (nicknameChanged && !mutationNicknameAvailability.canChange) {
        throw new NicknameChangeError(
          'NICKNAME_CHANGE_COOLDOWN',
          `昵称每 ${mutationNicknameAvailability.cooldownDays} 天只能修改一次，距离下次修改还有 ${Math.max(1, Math.ceil(((mutationNicknameAvailability.nextAllowedAt?.getTime() || now.getTime()) - now.getTime()) / (1000 * 60 * 60 * 24)))} 天`,
          mutationNicknameAvailability.nextAllowedAt,
        )
      }
      nicknameUsedFreeOpportunity = nicknameChanged && mutationNicknameAvailability.opportunityAvailable

    // 昵称处理：违规 → 系统自动替换并生成唯一展示昵称；正常 / 修正 → 清除违规标记。
    const isNicknameViolation = nicknameChanged && Boolean(nicknameViolation)
    const nicknameUpdate: Prisma.UserUpdateInput = {}
    if (nicknameChanged && nickname) {
      if (isNicknameViolation) {
        const count = (mutationCurrent.nicknameViolationCount || 0) + 1
        const display = await generateUniqueViolationNickname(tx, Math.random)
        nicknameUpdate.nickname = nickname
        nicknameUpdate.nicknameModerationStatus = 'VIOLATION'
        nicknameUpdate.nicknameViolationDisplay = display
        nicknameUpdate.nicknameViolationCount = count
        nicknameUpdate.nicknameChangedAt = now
        if (nicknameUsedFreeOpportunity) nicknameUpdate.nicknameFreeChangeUsedAt = now
      } else {
        nicknameUpdate.nickname = nickname
        nicknameUpdate.nicknameModerationStatus = 'NORMAL'
        nicknameUpdate.nicknameViolationDisplay = null
        nicknameUpdate.nicknameChangedAt = now
        if (nicknameUsedFreeOpportunity) nicknameUpdate.nicknameFreeChangeUsedAt = now
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
        gender: true,
        customGender: true,
        nicknameModerationStatus: true,
        nicknameViolationDisplay: true,
        nicknameViolationCount: true,
        nicknameChangedAt: true,
        nicknameFreeChangeUsedAt: true,
        showBadgeActivity: true,
        showBadgeProgressNotifications: true,
         birthMonth: true,
         birthDay: true,
         birthdaySetAt: true,
         birthdateSelfEditCount: true,
         birthdayPublic: true,
      },
    })

    // 修正违规：关闭最近一条尚未解决的违规记录（需求 三 / 六）。
    if (nicknameChanged && !isNicknameViolation && mutationCurrent.nicknameModerationStatus === 'VIOLATION') {
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
    if (nicknameChanged && isNicknameViolation) {
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

    // The User row only retains the current value. Persist successful
    // old/new changes in the same transaction so the admin timeline never
    // invents history and never records a failed profile update.
    if (nicknameChanged) {
      await writeUserOperationLog(tx, {
        userId: guard.user.id,
        category: 'ACCOUNT',
        action: 'NICKNAME_CHANGED',
        summary: '用户修改昵称',
        metadata: {
          oldNickname: mutationCurrent.nickname,
          newNickname: updated.nickname,
          displayNickname: updated.nicknameViolationDisplay,
          source: 'USER_SELF',
          usedFreeChange: nicknameUsedFreeOpportunity,
        },
        source: nicknameViolation ? 'NICKNAME_MODERATION' : 'USER_PROFILE',
        operatorType: 'USER',
        operatorUserId: guard.user.id,
        targetType: 'USER',
        targetId: guard.user.id,
      })
    }
    if (birthdayChanged && birthdayMutation) {
      await writeUserOperationLog(tx, {
        userId: guard.user.id,
        category: 'ACCOUNT',
        action: 'BIRTHDAY_CHANGED',
        summary: '用户修改生日',
        metadata: {
          oldBirthday: birthdayMutation.previousBirthday
            ? `${birthdayMutation.previousBirthday.month}月${birthdayMutation.previousBirthday.day}日`
            : null,
          newBirthday: birthdayMutation.birthday
            ? `${birthdayMutation.birthday.month}月${birthdayMutation.birthday.day}日`
            : null,
          source: 'USER_SELF',
        },
        source: 'USER_PROFILE',
        operatorType: 'USER',
        operatorUserId: guard.user.id,
        targetType: 'USER',
        targetId: guard.user.id,
      })
    }

    const valuesEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
    const writeFieldChange = async (field: string, oldValue: unknown, newValue: unknown) => {
      if (valuesEqual(oldValue, newValue)) return
      await writeUserOperationLog(tx, {
        userId: guard.user.id,
        category: 'ACCOUNT',
        action: 'PROFILE_FIELD_CHANGED',
        summary: `用户修改${field}`,
        metadata: { field, oldValue: oldValue ?? null, newValue: newValue ?? null, source: 'USER_PROFILE' },
        source: 'USER_PROFILE',
        operatorType: 'USER',
        operatorUserId: guard.user.id,
        targetType: 'USER',
        targetId: guard.user.id,
      })
    }
    if (body?.bio !== undefined) await writeFieldChange('个人简介', mutationCurrent.bio, updated.bio)
    if (body?.avatarUrl !== undefined) await writeFieldChange('头像', mutationCurrent.avatarUrl, updated.avatarUrl)
    if (body?.backgroundUrl !== undefined) await writeFieldChange('背景图', mutationCurrent.backgroundUrl, updated.backgroundUrl)
    if (phone !== undefined) await writeFieldChange('手机号', mutationCurrent.phone, updated.phone)
    if (hasGenderFields) {
      await writeFieldChange('性别', mutationCurrent.gender, updated.gender)
      await writeFieldChange('自定义性别', mutationCurrent.customGender, updated.customGender)
    }
    if (birthdayPublic !== undefined) await writeFieldChange('生日公开设置', mutationCurrent.birthdayPublic, updated.birthdayPublic)
    if (showBadgeActivity !== undefined) await writeFieldChange('勋章动态设置', mutationCurrent.showBadgeActivity, updated.showBadgeActivity)
    if (showBadgeProgressNotifications !== undefined) {
      await writeFieldChange('勋章进度提醒设置', mutationCurrent.showBadgeProgressNotifications, updated.showBadgeProgressNotifications)
    }

    const profileRecord = await tx.profile.upsert({
      where: { userId: guard.user.id },
      update: {
        ...(nicknameChanged && nickname && !isNicknameViolation ? { displayName: nickname, displayNameModerationStatus: 'NORMAL' as const } : {}),
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

    if (requestedWallVisibility !== undefined) {
      await writeFieldChange('留言墙隐私设置', mutationCurrent.Profile?.wallVisibility, profileRecord.wallVisibility)
    }
    if (hasLocation) {
      await writeFieldChange(
        '地区',
        mutationCurrent.Profile
          ? {
              countryCode: mutationCurrent.Profile.locationCountryCode,
              countryName: mutationCurrent.Profile.locationCountry,
              regionCode: mutationCurrent.Profile.locationRegionCode,
              regionName: mutationCurrent.Profile.locationRegion,
            }
          : null,
        profileRecord.locationCountryCode
          ? {
              countryCode: profileRecord.locationCountryCode,
              countryName: profileRecord.locationCountry,
              regionCode: profileRecord.locationRegionCode,
              regionName: profileRecord.locationRegion,
            }
          : null,
      )
    }

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
      gender: updated.gender,
      customGender: updated.customGender,
      nicknameModerationStatus: updated.nicknameModerationStatus,
      nicknameViolationDisplay: updated.nicknameViolationDisplay,
      nicknameChangedAt: updated.nicknameChangedAt,
      nicknameFreeChangeUsedAt: updated.nicknameFreeChangeUsedAt,
      nicknameViolationCount: updated.nicknameViolationCount,
      showBadgeActivity: updated.showBadgeActivity,
      showBadgeProgressNotifications: updated.showBadgeProgressNotifications,
      birthMonth: updated.birthMonth,
      birthDay: updated.birthDay,
      birthdaySetAt: updated.birthdaySetAt,
      ...getBirthdayEditState(updated),
      birthdayPublic: updated.birthdayPublic,
      wallVisibility: profileRecord.wallVisibility,
      location: profileRecord.locationCountryCode ? {
        countryCode: profileRecord.locationCountryCode,
        countryName: profileRecord.locationCountry || profileRecord.locationCountryCode,
        regionCode: profileRecord.locationRegionCode,
        regionName: profileRecord.locationRegion,
      } : null,
    }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  invalidateCurrentUserCache(guard.user.id)
  void updateUserIpRegion(guard.user.id, request)
  if (genderUpdate) {
    await refreshProfileCompletion(guard.user.id, now).catch((error) => {
      console.error('[users.me.profile-completion]', { userId: guard.user.id, error })
    })
  }
  let equippedBadges: Awaited<ReturnType<typeof getEquippedBadgesForUser>> | undefined
  // Wait for the unified birthday reconciliation before returning so the
  // client can replace its equipped-badge state without a full reload.
  if (birthdayChanged) await triggerBadgeEvaluation(guard.user.id, 'USER_BIRTHDAY_UPDATED', profile.birthdaySetAt?.toISOString() || new Date().toISOString())
  if (birthdayChanged) {
    equippedBadges = await getEquippedBadgesForUser(guard.user.id).catch((error) => {
      console.error('[users.me.birthday.equipped-badges]', { userId: guard.user.id, error })
      return []
    })
  }

  profile.avatarUrl = publicImageUrl(profile.avatarUrl)
  profile.backgroundUrl = publicImageUrl(profile.backgroundUrl)

    return NextResponse.json({
    profile,
    nicknameUpdated: true,
    nicknameChange: serializeNicknameChange(
      profile.nicknameChangedAt,
      profile.nicknameFreeChangeUsedAt,
      computeNicknameCooldownDays(profile.nicknameViolationCount ?? 0),
      now,
    ),
    nicknameViolation: nicknameChanged && Boolean(nicknameViolation),
    nicknameMessage: nicknameChanged && nicknameViolation
        ? '昵称包含违禁词，已被系统替换为临时展示昵称，整改后可重新修改'
        : undefined,
    ...(equippedBadges ? { equippedBadges, equippedBadge: equippedBadges[0] || null } : {}),
    })
  } catch (error) {
    const birthdayErrorResponse = birthdayMutationErrorResponse(error)
    if (birthdayErrorResponse) return birthdayErrorResponse
    if (error instanceof NicknameChangeError) return nicknameChangeErrorResponse(error, now)
    if (error instanceof Error && error.message === 'INVALID_BIRTHDAY') {
      return profileFieldError('birthday', 'INVALID_BIRTHDAY', '请选择有效的生日')
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      if (nicknameChanged) {
        const latest = await prisma.user.findUnique({
          where: { id: guard.user.id },
          select: {
            nicknameChangedAt: true,
            nicknameFreeChangeUsedAt: true,
            nicknameViolationCount: true,
          },
        })
        if (latest) {
          const latestAvailability = getNicknameChangeAvailability({
            lastChangedAt: latest.nicknameChangedAt,
            freeChangeUsedAt: latest.nicknameFreeChangeUsedAt,
            cooldownDays: computeNicknameCooldownDays(latest.nicknameViolationCount ?? 0),
            now,
          })
          if (!latestAvailability.canChange) {
            return nicknameChangeErrorResponse(new NicknameChangeError(
              'NICKNAME_CHANGE_COOLDOWN',
              `昵称每 ${latestAvailability.cooldownDays} 天只能修改一次，请稍后再试`,
              latestAvailability.nextAllowedAt,
            ), now)
          }
        }
      }
      return NextResponse.json({
        code: 'PROFILE_UPDATE_CONFLICT',
        message: '资料正在被其他请求更新，请刷新后重试',
      }, { status: 409 })
    }
    console.error('[users.me.profile]', error)
    return NextResponse.json({
      code: 'PROFILE_UPDATE_FAILED',
      message: '保存失败，请稍后重试',
    }, { status: 500 })
  }
}
