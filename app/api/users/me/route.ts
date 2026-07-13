import { NextResponse } from 'next/server'
import { createVerificationForUser, isValidEmail, normalizeEmail, sendVerificationEmail } from '@/lib/email-verification'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, requireUser, sanitizeText } from '@/lib/security'

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
      profile: true,
      badges: {
        where: { isHidden: false },
        orderBy: { displayOrder: 'asc' },
        include: { badge: true },
      },
      _count: {
        select: {
          posts: true,
          replies: true,
          followers: true,
          following: true,
        },
      },
    },
  })

  return NextResponse.json({ profile })
}

export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const nickname = sanitizeText(body?.nickname, 32)
  const bio = await filterSensitiveWords(sanitizeText(body?.bio, 300))
  const avatarUrl = sanitizeText(body?.avatarUrl, 500)
  const backgroundUrl = sanitizeText(body?.backgroundUrl, 500)
  const email = body?.email === undefined ? undefined : normalizeEmail(body.email)
  const phone = body?.phone === undefined ? undefined : sanitizeText(body.phone, 20).replace(/\s+/g, '')

  const data: {
    nickname?: string
    bio?: string
    avatarUrl?: string | null
    backgroundUrl?: string | null
    email?: string | null
    phone?: string | null
    emailVerifiedAt?: Date | null
    phoneVerifiedAt?: Date | null
  } = {}

  if (nickname) data.nickname = nickname
  if (body?.bio !== undefined) data.bio = bio
  if (body?.avatarUrl !== undefined) data.avatarUrl = publicImageUrl(avatarUrl) || null
  if (body?.backgroundUrl !== undefined) data.backgroundUrl = publicImageUrl(backgroundUrl) || null
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

  const current = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: { nickname: true, nicknameChangedAt: true, email: true, phone: true },
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

    await tx.profile.upsert({
      where: { userId: guard.user.id },
      update: {
        ...(data.nickname ? { displayName: data.nickname } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        ...(data.backgroundUrl !== undefined ? { backgroundUrl: data.backgroundUrl } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
      },
      create: {
        userId: guard.user.id,
        displayName: updated.nickname,
        avatarUrl: updated.avatarUrl,
        backgroundUrl: updated.backgroundUrl,
        bio: updated.bio,
      },
    })

    return updated
  })

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
