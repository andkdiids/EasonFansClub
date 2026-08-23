import { randomBytes, randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { formatBeijingDateTimeMinute, getBeijingDateKey, shiftBeijingDateKey } from '@/lib/beijing-time'
import { drawDailyPrescriptionReward } from '@/lib/entertainment-rewards'
import type { DailyPrescriptionUser } from '@/lib/daily-prescription-types'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { profileImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'

export const EMPTY_LYRIC_MESSAGE = '今日处方暂未开具，请等待管理员补充歌词库'
export const PRESCRIPTION_HISTORY_PAGE_SIZE = 12

const dailyDrawInclude = {
  User: {
    select: {
      uid: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true, displayName: true, displayNameModerationStatus: true } },
    },
  },
  LyricPrescription: {
    select: {
      id: true,
      text: true,
      songTitle: true,
      albumTitle: true,
    },
  },
} satisfies Prisma.EntertainmentDailyDrawInclude

type DailyDrawWithLyric = Prisma.EntertainmentDailyDrawGetPayload<{
  include: typeof dailyDrawInclude
}>

const dailyDrawHistoryInclude = {
  User: {
    select: {
      uid: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true, displayName: true, displayNameModerationStatus: true } },
    },
  },
  PointLog: {
    select: {
      points: true,
      action: true,
      createdAt: true,
    },
  },
} satisfies Prisma.EntertainmentDailyDrawInclude

type DailyDrawHistoryRow = Prisma.EntertainmentDailyDrawGetPayload<{
  include: typeof dailyDrawHistoryInclude
}>

export type DailyPrescriptionHistoryRecord = {
  id: string
  userId: string
  user: DailyPrescriptionUser
  dateKey: string
  points: number
  rewarded: boolean
  rewardFromLedger: boolean
  prescriptionCode: string
  issuedAtBeijing: string
  lyric: { text: string; songTitle: string; albumTitle: string | null } | null
}

export type LyricCandidate = {
  id: string
  text: string
  songTitle: string
  albumTitle: string | null
}

export function selectLyricCandidate(
  candidates: readonly LyricCandidate[],
  recentLyricIds: ReadonlySet<string>,
  randomIndex: (maxExclusive: number) => number = randomInt,
) {
  if (candidates.length === 0) return null
  const preferred = candidates.filter((item) => !recentLyricIds.has(item.id))
  const pool = preferred.length > 0 ? preferred : candidates
  return pool[randomIndex(pool.length)] ?? pool[0] ?? null
}

function createPrescriptionCode() {
  return `ECFC-${randomBytes(4).toString('hex').toUpperCase()}`
}

function serializeDailyDraw(draw: DailyDrawWithLyric, totalPoints: number) {
  const lyric = draw.lyricText && draw.songTitle
    ? {
        id: draw.lyricPrescriptionId,
        text: draw.lyricText,
        songTitle: draw.songTitle,
        albumTitle: draw.albumTitle,
      }
    : draw.LyricPrescription

  return {
    id: draw.id,
    userId: draw.userId,
    user: serializePrescriptionUser(draw.User),
    dateKey: draw.dateKey,
    points: draw.points,
    totalPoints,
    prescriptionCode: draw.prescriptionCode,
    issuedAt: draw.createdAt.toISOString(),
    issuedAtBeijing: formatBeijingDateTimeMinute(draw.createdAt),
    lyric,
  }
}

export function serializePrescriptionUser(user: DailyDrawWithLyric['User']): DailyPrescriptionUser {
  return {
    // The relation is reloaded on every read, so old draws follow the current
    // public nickname while the permanent UID stays unchanged. No username
    // snapshot is stored or exposed by the prescription payload.
    nickname: getPublicUserDisplayName(user),
    uid: user.uid,
    avatarUrl: profileImageUrl(user.Profile?.avatarUrl) || profileImageUrl(user.avatarUrl),
  }
}

async function findExistingDraw(userId: string, dateKey: string) {
  return prisma.entertainmentDailyDraw.findUnique({
    where: { userId_dateKey: { userId, dateKey } },
    include: dailyDrawInclude,
  })
}

export async function getEntertainmentDailyDrawStatus(userId: string, now = new Date()) {
  const todayDateKey = getBeijingDateKey(now)
  const [draw, availableLyricCount, user] = await Promise.all([
    findExistingDraw(userId, todayDateKey),
    prisma.lyricPrescription.count({ where: { enabled: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
  ])

  if (!user) throw new Error('USER_NOT_FOUND')

  return {
    todayDateKey,
    hasDrawn: Boolean(draw),
    remainingCount: draw ? 0 : 1,
    availableLyricCount,
    draw: draw ? serializeDailyDraw(draw, user.points) : null,
    totalPoints: user.points,
  }
}

function serializeDailyDrawHistory(draw: DailyDrawHistoryRow): DailyPrescriptionHistoryRecord {
  const points = draw.PointLog?.points ?? draw.points
  const lyric = draw.lyricText && draw.songTitle
    ? { text: draw.lyricText, songTitle: draw.songTitle, albumTitle: draw.albumTitle }
    : null

  return {
    id: draw.id,
    userId: draw.userId,
    user: serializePrescriptionUser(draw.User),
    dateKey: draw.dateKey,
    points,
    rewarded: points > 0,
    rewardFromLedger: Boolean(draw.PointLog),
    prescriptionCode: draw.prescriptionCode,
    issuedAtBeijing: formatBeijingDateTimeMinute(draw.createdAt),
    lyric,
  }
}

export async function getEntertainmentDailyDrawHistory(userId: string, requestedPage = 1) {
  const total = await prisma.entertainmentDailyDraw.count({ where: { userId } })
  const totalPages = Math.max(1, Math.ceil(total / PRESCRIPTION_HISTORY_PAGE_SIZE))
  const page = Math.min(
    totalPages,
    Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1),
  )
  const draws = await prisma.entertainmentDailyDraw.findMany({
    where: { userId },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
    skip: (page - 1) * PRESCRIPTION_HISTORY_PAGE_SIZE,
    take: PRESCRIPTION_HISTORY_PAGE_SIZE,
    include: dailyDrawHistoryInclude,
  })

  return {
    records: draws.map(serializeDailyDrawHistory),
    pagination: {
      page,
      pageSize: PRESCRIPTION_HISTORY_PAGE_SIZE,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  }
}

async function createDrawTransaction(userId: string, dateKey: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    const recentStartKey = shiftBeijingDateKey(dateKey, -7)
    const [recentDraws, recentRewardDraws, candidates] = await Promise.all([
      tx.entertainmentDailyDraw.findMany({
        where: {
          userId,
          dateKey: { gte: recentStartKey, lt: dateKey },
          lyricPrescriptionId: { not: null },
        },
        select: { lyricPrescriptionId: true },
      }),
      tx.entertainmentDailyDraw.findMany({
        where: { userId, dateKey: { lt: dateKey } },
        select: { points: true },
        orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
        take: 3,
      }),
      tx.lyricPrescription.findMany({
        where: { enabled: true },
        select: { id: true, text: true, songTitle: true, albumTitle: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const recentIds = new Set(
      recentDraws
        .map((item) => item.lyricPrescriptionId)
        .filter((id): id is string => Boolean(id)),
    )
    const lyric = selectLyricCandidate(candidates, recentIds)
    const requestedPoints = drawDailyPrescriptionReward(recentRewardDraws.map((draw) => draw.points))
    const createdDraw = await tx.entertainmentDailyDraw.create({
      data: {
        userId,
        dateKey,
        points: requestedPoints,
        prescriptionCode: createPrescriptionCode(),
        lyricPrescriptionId: lyric?.id ?? null,
        lyricText: lyric?.text ?? null,
        songTitle: lyric?.songTitle ?? null,
        albumTitle: lyric?.albumTitle ?? null,
        createdAt: now,
      },
      include: dailyDrawInclude,
    })
    const feeAward = await awardRegistrationFee(tx, {
      userId,
      requestedAmount: requestedPoints,
      action: 'ENTERTAINMENT_DAILY_DRAW',
      reason: '娱乐中心每日抽奖',
      businessKey: `entertainment-draw:${createdDraw.id}`,
      dailyDrawId: createdDraw.id,
      now,
    })
    if (feeAward.awardedAmount !== requestedPoints) {
      throw new Error('DAILY_PRESCRIPTION_REWARD_AMOUNT_MISMATCH')
    }
    const draw = await tx.entertainmentDailyDraw.update({
      where: { id: createdDraw.id },
      data: { points: feeAward.awardedAmount },
      include: dailyDrawInclude,
    })

    if (lyric) {
      await tx.lyricPrescription.update({
        where: { id: lyric.id },
        data: { displayCount: { increment: 1 } },
      })
    }

    return {
      ...serializeDailyDraw(draw, feeAward.totalPoints),
    }
  })
}

export async function issueEntertainmentDailyDraw(userId: string, now = new Date()) {
  const dateKey = getBeijingDateKey(now)
  const existing = await findExistingDraw(userId, dateKey)
  if (existing) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } })
    return { created: false, draw: serializeDailyDraw(existing, user.points) }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return { created: true, draw: await createDrawTransaction(userId, dateKey, now) }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrentDraw = await findExistingDraw(userId, dateKey)
        if (concurrentDraw) {
          const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } })
          return { created: false, draw: serializeDailyDraw(concurrentDraw, user.points) }
        }
        continue
      }
      throw error
    }
  }

  throw new Error('DAILY_DRAW_CONFLICT')
}
