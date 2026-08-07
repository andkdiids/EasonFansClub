import { NextResponse } from 'next/server'
import { ProfileWallVisibility } from '@prisma/client'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { createVerificationForUser, isValidEmail, normalizeEmail, sendVerificationEmail } from '@/lib/email-verification'
import { profileImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { containsSensitiveContent, requireUser, sanitizeText } from '@/lib/security'

const profileWallVisibilities = new Set<string>(Object.values(ProfileWallVisibility))

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const profile = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      nickname: true,
      uid: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      role: true,
      status: true,
      verificationStatus: true,
      level: true,
      exp: true,
      points: true,
      consecutiveDays: true,
      lastLoginAt: true,
      lastActiveAt: true,
      birthMonth: true,
      birthDay: true,
      birthdaySetAt: true,
      Profile: true,
      UserBadge: {
        where: { isHidden: false },
        orderBy: { displayOrder: 'asc' },
        include: { Badge: true },
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
  const { Profile, UserBadge, _count, ...user } = profile
  return NextResponse.json({
    profile: {
      ...user,
      profile: Profile,
      badges: UserBadge.map(({ Badge, ...item }) => ({ ...item, badge: Badge })),
      _count: {
        posts: _count.Post,
        replies: _count.Reply,
        followers: _count.Follow_Follow_followingIdToUser,
        following: _count.Follow_Follow_followerIdToUser,
      },
    },
  })
}

export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const nickname = sanitizeText(body?.nickname, 32)
  const bio = sanitizeText(body?.bio, 300)
  if (await containsSensitiveContent(bio)) return NextResponse.json({ message: '个人简介包含违禁词，无法保存' }, { status: 400 })
  const avatarUrl = sanitizeText(body?.avatarUrl, 500)
  const backgroundUrl = sanitizeText(body?.backgroundUrl, 500)
  const email = body?.email === undefined ? undefined : normalizeEmail(body.email)
  const phone = body?.phone === undefined ? undefined : sanitizeText(body.phone, 20).replace(/\s+/g, '')
  const requestedWallVisibility = body?.wallVisibility === undefined ? undefined : sanitizeText(body.wallVisibility, 20)
  const wallVisibility = requestedWallVisibility as ProfileWallVisibility | undefined

  const birthMonthRaw = body?.birthMonth === undefined || body?.birthMonth === null ? undefined : Number(body.birthMonth)
  const birthDayRaw = body?.birthDay === undefined || body?.birthDay === null ? undefined : Number(body.birthDay)

  const data: {
    nickname?: string
    bio?: string
    avatarUrl?: string | null
    backgroundUrl?: string | null
    email?: string | null
    phone?: string | null
    emailVerifiedAt?: Date | null
    phoneVerifiedAt?: Date | null
    birthMonth?: number
    birthDay?: number
    birthdaySetAt?: Date
  } = {}

  if (nickname) data.nickname = nickname
  if (body?.bio !== undefined) data.bio = bio
  // 头像/背景图只允许保存有效 COS 等地址；失效的 Supabase 地址一律清空
  if (body?.avatarUrl !== undefined) data.avatarUrl = profileImageUrl(avatarUrl)
  if (body?.backgroundUrl !== undefined) data.backgroundUrl = profileImageUrl(backgroundUrl)
  if (email !== undefined) {
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ message: '请输入有效邮箱' }, { status: 400 })
    }
    data.email = email || null
  }
  if (phone !== undefined) {
    if (phone && !/^1\d{10}$/.test(phone)) {
      return NextResponse.json({ message: '请输入 11 位中国大陆手机号' }, { status: 400 })
    }
    data.phone = phone || null
  }
  if (requestedWallVisibility !== undefined && !profileWallVisibilities.has(requestedWallVisibility)) {
    return NextResponse.json({ message: '留言墙隐私设置无效' }, { status: 400 })
  }

  const current = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: { nickname: true, nicknameChangedAt: true, email: true, phone: true, birthMonth: true, birthDay: true, birthdaySetAt: true },
  })

  if (!current) return NextResponse.json({ message: '账号不存在' }, { status: 404 })

  if (email !== undefined && data.email !== current.email) {
    if (data.email) {
      const existing = await prisma.user.findFirst({
        where: { email: data.email, isDeleted: false, NOT: { id: guard.user.id } },
        select: { id: true },
      })
      if (existing) return NextResponse.json({ message: '该邮箱已被绑定' }, { status: 409 })
    }
    data.emailVerifiedAt = null
  }

  if (phone !== undefined && data.phone !== current.phone) {
    if (data.phone) {
      const existing = await prisma.user.findFirst({
        where: { phone: data.phone, isDeleted: false, NOT: { id: guard.user.id } },
        select: { id: true },
      })
      if (existing) return NextResponse.json({ message: '该手机号已被绑定' }, { status: 409 })
    }
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

  const nicknameChanged = Boolean(nickname && current && nickname !== current.nickname)
  const canChangeNickname =
    !nicknameChanged ||
    !current?.nicknameChangedAt ||
    now.getTime() - current.nicknameChangedAt.getTime() >= 1000 * 60 * 60 * 24 * 30

  if (nicknameChanged && !canChangeNickname) {
    delete data.nickname
  }

  const profile = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: guard.user.id },
      data: {
        ...data,
        ...(nicknameChanged && canChangeNickname ? { nicknameChangedAt: now } : {}),
      },
      select: {
        id: true,
        uid: true,
        nickname: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        avatarUrl: true,
        backgroundUrl: true,
        bio: true,
      },
    })

    const profileRecord = await tx.profile.upsert({
      where: { userId: guard.user.id },
      update: {
        ...(data.nickname ? { displayName: data.nickname } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        ...(data.backgroundUrl !== undefined ? { backgroundUrl: data.backgroundUrl } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(wallVisibility !== undefined ? { wallVisibility } : {}),
      },
      create: {
        userId: guard.user.id,
        displayName: updated.nickname,
        avatarUrl: updated.avatarUrl,
        backgroundUrl: updated.backgroundUrl,
        bio: updated.bio,
        wallVisibility: wallVisibility || 'PUBLIC',
      },
      select: { wallVisibility: true },
    })

    return { ...updated, wallVisibility: profileRecord.wallVisibility }
  })

  invalidateCurrentUserCache(guard.user.id)

  let emailVerificationSent = false
  if (profile.email && profile.email !== current.email) {
    const verification = await createVerificationForUser(guard.user.id, profile.email)
    await sendVerificationEmail(profile.email, verification.verificationUrl, 'change-email')
    emailVerificationSent = true
  }

  return NextResponse.json({
    profile,
    emailVerificationSent,
    nicknameUpdated: !nicknameChanged || canChangeNickname,
    nicknameMessage: nicknameChanged && !canChangeNickname ? '昵称 30 天内只能修改一次，其他资料已保存' : undefined,
  })
}
