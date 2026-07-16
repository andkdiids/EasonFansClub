import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 100

export async function GET(request: Request) {
  const guard = await requireAdmin('user_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const keyword = sanitizeText(searchParams.get('q'), 60)
  const uidKeyword = Number(keyword)
  const sort = searchParams.get('sort') === 'uid_desc' ? 'desc' : 'asc'
  const page = Math.max(Number(searchParams.get('page') || 1), 1)
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE)
  const skip = (page - 1) * limit
  const searchFilters: Prisma.UserWhereInput[] = keyword
    ? [
        ...(Number.isFinite(uidKeyword) ? [{ uid: uidKeyword }] : []),
        { username: { contains: keyword, mode: 'insensitive' } },
        { nickname: { contains: keyword, mode: 'insensitive' } },
        { email: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword, mode: 'insensitive' } },
        { profile: { displayName: { contains: keyword, mode: 'insensitive' } } },
      ]
    : []

  const users = await prisma.user.findMany({
    where: {
      uid: { gt: 0 },
      profile: { isNot: null },
      ...(keyword
        ? {
            OR: searchFilters,
          }
        : {}),
    },
    orderBy: { uid: sort },
    skip,
    take: limit + 1,
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      avatarUrl: true,
      profile: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
      role: true,
      status: true,
      level: true,
      exp: true,
      points: true,
      isDeleted: true,
      lastLoginAt: true,
      createdAt: true,
      securityQuestionRecoveryEnabled: true,
      _count: { select: { securityQuestions: true } },
      securityLogs: {
        where: { action: 'PASSWORD_RESET_SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  })
  const hasMore = users.length > limit
  const pageUsers = hasMore ? users.slice(0, limit) : users

  const failureKeys = pageUsers.map((user) => `account:${hashToken(user.id)}`)
  const failureRows = failureKeys.length ? await prisma.rateLimitLog.findMany({
    where: { key: { in: failureKeys }, action: 'password-reset:wrong-answer', expiresAt: { gt: new Date() } },
    select: { key: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  }) : []
  const failureState = new Map<string, { count: number; lastFailedAt: Date; lockedUntil: Date | null }>()
  for (const row of failureRows) {
    const current = failureState.get(row.key)
    failureState.set(row.key, {
      count: (current?.count || 0) + 1,
      lastFailedAt: current?.lastFailedAt || row.createdAt,
      lockedUntil: current?.lockedUntil && current.lockedUntil > row.expiresAt ? current.lockedUntil : row.expiresAt,
    })
  }

  return NextResponse.json({
    users: pageUsers.map(({ profile, _count, securityLogs, ...user }) => {
      const failures = failureState.get(`account:${hashToken(user.id)}`)
      return {
        ...user,
        nickname: profile?.displayName || user.nickname,
        avatarUrl: profile?.avatarUrl || user.avatarUrl,
        securityQuestionsSet: _count.securityQuestions === 3,
        lastPasswordResetAt: securityLogs[0]?.createdAt || null,
        securityQuestionFailureCount: failures?.count || 0,
        securityQuestionLastFailedAt: failures?.lastFailedAt || null,
        securityQuestionLockedUntil: failures && failures.count >= 5 ? failures.lockedUntil : null,
      }
    }),
    page,
    limit,
    hasMore,
  })
}
