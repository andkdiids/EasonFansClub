import { randomBytes, randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { formatBeijingDateTimeMinute, getBeijingDateKey, shiftBeijingDateKey } from '@/lib/beijing-time'
import { drawDailyPrescriptionReward } from '@/lib/entertainment-rewards'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'

export const EMPTY_LYRIC_MESSAGE = '今日处方暂未开具，请等待管理员补充歌词库'

const dailyDrawInclude = {
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
    dateKey: draw.dateKey,
    points: draw.points,
    totalPoints,
    prescriptionCode: draw.prescriptionCode,
    issuedAt: draw.createdAt.toISOString(),
    issuedAtBeijing: formatBeijingDateTimeMinute(draw.createdAt),
    lyric,
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

async function createDrawTransaction(userId: string, dateKey: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    const recentStartKey = shiftBeijingDateKey(dateKey, -7)
    const [recentDraws, candidates] = await Promise.all([
      tx.entertainmentDailyDraw.findMany({
        where: {
          userId,
          dateKey: { gte: recentStartKey, lt: dateKey },
          lyricPrescriptionId: { not: null },
        },
        select: { lyricPrescriptionId: true },
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
    const requestedPoints = drawDailyPrescriptionReward()
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
