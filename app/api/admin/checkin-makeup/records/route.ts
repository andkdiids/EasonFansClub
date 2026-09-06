import { NextResponse } from 'next/server'
import { Prisma, type CheckInType } from '@prisma/client'
import { parseCheckInDateKey } from '@/lib/checkin-history'
import { MAKEUP_CHECK_IN_TYPES } from '@/lib/checkin-type-meta'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type RecordsTypeFilter = 'ALL' | 'FREE_QUIZ' | 'PAID' | 'ADMIN'

function parseTypeFilter(value: string | null): RecordsTypeFilter {
  if (value === 'FREE_QUIZ' || value === 'PAID' || value === 'ADMIN') return value
  return 'ALL'
}

function resolveTypeFilter(filter: RecordsTypeFilter): CheckInType[] {
  if (filter === 'ALL') return [...MAKEUP_CHECK_IN_TYPES]
  if (filter === 'FREE_QUIZ') return ['MAKEUP_FREE_QUIZ']
  if (filter === 'PAID') return ['MAKEUP_PAID']
  return ['MAKEUP_ADMIN']
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback
}

export async function GET(request: Request) {
  const guard = await requireAdmin('checkin_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const query = sanitizeText(searchParams.get('q'), 60).trim()
  const typeFilter = parseTypeFilter(searchParams.get('type'))
  const rawTargetDate = sanitizeText(searchParams.get('targetDateKey') ?? searchParams.get('targetDate'), 10).trim()
  const targetDateKey = rawTargetDate && parseCheckInDateKey(rawTargetDate) ? rawTargetDate : null
  const page = parsePositiveInt(searchParams.get('page'), 1, 10_000)
  const pageSize = parsePositiveInt(searchParams.get('pageSize'), 20, 50)

  const where: Prisma.CheckInWhereInput = { type: { in: resolveTypeFilter(typeFilter) } }
  if (targetDateKey) where.checkinDateKey = targetDateKey
  const numericQuery = Number(query)
  const hasNumericQuery = Number.isSafeInteger(numericQuery) && numericQuery > 0
  if (query) {
    where.User = {
      isDeleted: false,
      OR: [
        ...(hasNumericQuery ? [{ uid: numericQuery }] : []),
        { nickname: { contains: query } },
        { username: { contains: query } },
        ...(query ? [{ Profile: { displayName: { contains: query } } }] : []),
      ],
    }
  } else {
    where.User = { isDeleted: false }
  }

  const [total, rows] = await Promise.all([
    prisma.checkIn.count({ where }),
    prisma.checkIn.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        checkinDateKey: true,
        type: true,
        madeUpAt: true,
        makeupCost: true,
        createdAt: true,
        User: {
          select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } },
        },
        MakeupChallenge: { select: { id: true, status: true, targetDateKey: true } },
      },
    }),
  ])

  // 管理员执行补签的审计记录已由 POST 写入 AdminActionLog（action=CHECK_IN_ADMIN_MAKEUP，
  // detail.checkInId 关联到具体 CheckIn），这里直接复用，不另建一套审计。
  const targetUserIds = [...new Set(rows.map((row) => row.User.id))]
  const logs = targetUserIds.length
    ? await prisma.adminActionLog.findMany({
        where: { action: 'CHECK_IN_ADMIN_MAKEUP', targetUserId: { in: targetUserIds } },
        orderBy: { createdAt: 'desc' },
        select: { adminId: true, targetUserId: true, detail: true },
      })
    : []
  const adminUserIds = [...new Set(logs.map((log) => log.adminId))]
  const adminUsers = adminUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: adminUserIds } },
        select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } },
      })
    : []
  const adminNameById = new Map(adminUsers.map((admin) => [admin.id, admin.nickname?.trim() || '管理员']))
  const adminUidById = new Map(adminUsers.map((admin) => [admin.id, admin.uid]))
  const logByCheckInId = new Map<string, { adminId: string; reason?: string }>()
  logs.forEach((log) => {
    const detail = log.detail && typeof log.detail === 'object' && !Array.isArray(log.detail)
      ? log.detail as Record<string, unknown>
      : {}
    const checkInId = typeof detail.checkInId === 'string' ? detail.checkInId : null
    const reason = typeof detail.reason === 'string' ? detail.reason : undefined
    if (checkInId && !logByCheckInId.has(checkInId)) {
      logByCheckInId.set(checkInId, { adminId: log.adminId, reason })
    }
  })

  const records = rows.map((row) => {
    const log = logByCheckInId.get(row.id)
    const targetName = row.User.nickname?.trim() || row.User.Profile?.displayName?.trim() || 'E院用户'
    return {
      checkInId: row.id,
      dateKey: row.checkinDateKey,
      type: row.type,
      madeUpAt: row.madeUpAt?.toISOString() || null,
      makeupCost: row.makeupCost,
      createdAt: row.createdAt.toISOString(),
      targetUser: {
        id: row.User.id,
        uid: row.User.uid,
        nickname: targetName,
        avatarUrl: row.User.Profile?.avatarUrl || null,
      },
      operator: log
        ? { uid: adminUidById.get(log.adminId) ?? null, nickname: adminNameById.get(log.adminId) || '管理员', reason: log.reason || null }
        : null,
      challenge: row.MakeupChallenge ? { id: row.MakeupChallenge.id, status: row.MakeupChallenge.status, targetDateKey: row.MakeupChallenge.targetDateKey } : null,
    }
  })

  return NextResponse.json({
    records,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    filters: { type: typeFilter, targetDateKey },
  })
}
