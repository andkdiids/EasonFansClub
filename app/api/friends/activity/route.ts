import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getFriendIds } from '@/lib/friends'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { publicModerationText } from '@/lib/content-moderation'
import { normalizeStoredInternalPath } from '@/lib/url-safety'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const ALLOWED_TYPES = ['CHECKIN', 'POST'] as const

function positiveInteger(value: string | null, fallback: number, maximum?: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return maximum ? Math.min(parsed, maximum) : parsed
}

function parseDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(request: Request) {
  const viewer = await getCurrentUser()
  if (!viewer) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const page = positiveInteger(params.get('page'), 1)
  const limit = positiveInteger(params.get('limit'), DEFAULT_LIMIT, MAX_LIMIT)
  const requestedType = params.get('type')
  const type = ALLOWED_TYPES.includes(requestedType as (typeof ALLOWED_TYPES)[number]) ? requestedType : null
  const requestedStartDate = parseDate(params.get('startDate'))
  const requestedEndDate = parseDate(params.get('endDate'), true)
  if (params.get('startDate') && !requestedStartDate) return NextResponse.json({ message: '开始日期格式无效' }, { status: 400 })
  if (params.get('endDate') && !requestedEndDate) return NextResponse.json({ message: '结束日期格式无效' }, { status: 400 })
  if (requestedStartDate && requestedEndDate && requestedStartDate > requestedEndDate) {
    return NextResponse.json({ message: '开始日期不能晚于结束日期' }, { status: 400 })
  }

  const defaultStartDate = new Date()
  defaultStartDate.setDate(defaultStartDate.getDate() - 6)
  defaultStartDate.setHours(0, 0, 0, 0)
  const startDate = requestedStartDate || defaultStartDate
  const endDate = requestedEndDate
  const friendIds = await getFriendIds(viewer.id)
  if (!friendIds.length) {
    return NextResponse.json({
      activities: [],
      pagination: { page, limit, total: 0, totalPages: 1, hasPrevious: false, hasNext: false },
    })
  }

  const where = {
    actorId: { in: friendIds },
    type: type ? { equals: type } : { in: [...ALLOWED_TYPES] },
    createdAt: { gte: startDate, ...(endDate ? { lte: endDate } : {}) },
    User: { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } },
  }
  const [total, activities] = await Promise.all([
    prisma.friendActivity.count({ where }),
    prisma.friendActivity.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            usernameModerationStatus: true,
            nicknameModerationStatus: true,
            nicknameViolationDisplay: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
          },
        },
      },
    }),
  ])
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const remarkMap = await loadFriendRemarkMap(viewer.id, activities.map((item) => item.actorId))

  return NextResponse.json({
    activities: activities.map((item) => ({
      id: item.id,
      mood: item.mood,
      moodType: item.moodType,
      moodEmoji: item.moodEmoji,
      moodText: item.moodText,
      content: publicModerationText(item.content, item.moderationStatus),
      type: item.type,
      targetUrl: normalizeStoredInternalPath(item.targetUrl),
      createdAt: item.createdAt.toISOString(),
      actor: {
        ...item.User,
        nickname: getPublicUserDisplayName(item.User),
        avatarUrl: publicImageUrl(item.User.avatarUrl),
        profile: item.User.Profile ? {
          ...item.User.Profile,
          avatarUrl: publicImageUrl(item.User.Profile.avatarUrl),
          displayName: resolveFriendDisplayName({
            viewerId: viewer.id,
            targetUserId: item.actorId,
            fallbackName: getPublicUserDisplayName(item.User),
            remarkMap,
          }),
        } : item.User.Profile,
      },
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
