import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function GET(request: Request) {
  const guard = await requireAdmin('user_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const keyword = sanitizeText(searchParams.get('q'), 60)
  const uidKeyword = Number(keyword)
  const sort = searchParams.get('sort') === 'uid_desc' ? 'desc' : 'asc'
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
      profile: { isNot: null },
      ...(keyword
        ? {
            OR: searchFilters,
          }
        : {}),
    },
    orderBy: { uid: sort },
    take: 100,
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      email: true,
      phone: true,
      avatarUrl: true,
      profile: {
        select: {
          displayName: true,
          avatarUrl: true,
          backgroundUrl: true,
          bio: true,
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
    },
  })

  return NextResponse.json({
    users: users.map((user) => ({
      ...user,
      nickname: user.profile?.displayName || user.nickname,
      avatarUrl: user.profile?.avatarUrl || user.avatarUrl,
    })),
  })
}
