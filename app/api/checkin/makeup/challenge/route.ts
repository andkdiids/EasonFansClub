import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, sanitizeText, unauthenticatedResponse } from '@/lib/security'
import {
  assertUserMakeupAvailable,
  CHECK_IN_MAKEUP_PLAYBACK_SECONDS,
  CheckInMakeupError,
  createChallengeOptions,
  getShanghaiMonthKey,
  parseChallengeOptions,
  serializePendingChallenge,
} from '@/lib/checkin-makeup'

function serialize(challenge: {
  id: string; targetDateKey: string; status: string; options: Prisma.JsonValue; playbackSeconds: number; correctOptionId: string; CheckIn?: { id: string } | null
}) {
  const base = serializePendingChallenge(challenge)
  if (challenge.status === 'PENDING') return base
  const correctAnswer = parseChallengeOptions(challenge.options).find((option) => option.id === challenge.correctOptionId)?.label || null
  return { ...base, correctAnswer, madeUp: Boolean(challenge.CheckIn) }
}

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return NextResponse.json({ message: '请求来源校验失败' }, { status: 403 })
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录后再开始挑战')
  const body = await request.json().catch(() => null) as { targetDate?: unknown } | null
  const targetDateKey = sanitizeText(body?.targetDate, 10)
  const now = new Date()
  const monthKey = getShanghaiMonthKey(now)
  try {
    const existing = await prisma.makeupChallenge.findUnique({ where: { userId_monthKey: { userId: user.id, monthKey } }, include: { CheckIn: { select: { id: true } } } })
    if (existing) {
      if (existing.targetDateKey !== targetDateKey) {
        throw new CheckInMakeupError('本月免费挑战已经绑定其他补签日期', 409, 'MONTHLY_CHALLENGE_EXISTS')
      }
      return NextResponse.json({ challenge: serialize(existing), monthlyChallengeUsed: existing.status !== 'PENDING' })
    }

    await prisma.$transaction(async (tx) => { await assertUserMakeupAvailable(tx, user.id, targetDateKey, now) })
    const where: Prisma.GuessSongQuestionWhereInput = {
      enabled: true,
      processingStatus: 'READY',
      OR: [
        { sourceAudioPath: { not: null } },
        { MusicSong: { sourceAudioPath: { not: null } } },
      ],
    }
    const count = await prisma.guessSongQuestion.count({ where })
    if (!count) throw new CheckInMakeupError('免费挑战题库暂时没有可播放歌曲', 503, 'NO_PLAYABLE_QUESTION')
    const question = await prisma.guessSongQuestion.findFirst({
      where,
      skip: Math.floor(Math.random() * count),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        correctAnswer: true,
        wrongOption1: true,
        wrongOption2: true,
        wrongOption3: true,
        sourceAudioPath: true,
        MusicSong: { select: { sourceAudioPath: true } },
      },
    })
    const audioStoragePath = question?.sourceAudioPath || question?.MusicSong?.sourceAudioPath
    if (!question || !audioStoragePath) throw new CheckInMakeupError('免费挑战题库暂时不可用', 503, 'NO_PLAYABLE_QUESTION')
    const { options, correctOptionId } = createChallengeOptions(question)
    let challenge
    try {
      challenge = await prisma.makeupChallenge.create({
        data: {
          userId: user.id,
          targetDate: new Date(`${targetDateKey}T00:00:00+08:00`),
          targetDateKey,
          monthKey,
          questionId: question.id,
          correctOptionId,
          options,
          audioStoragePath,
          playbackSeconds: CHECK_IN_MAKEUP_PLAYBACK_SECONDS,
        },
      })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      challenge = await prisma.makeupChallenge.findUniqueOrThrow({ where: { userId_monthKey: { userId: user.id, monthKey } } })
    }
    if (challenge.targetDateKey !== targetDateKey) throw new CheckInMakeupError('本月免费挑战已经绑定其他补签日期', 409, 'MONTHLY_CHALLENGE_EXISTS')
    return NextResponse.json({ challenge: serialize(challenge), monthlyChallengeUsed: challenge.status !== 'PENDING' }, { status: 201 })
  } catch (error) {
    if (error instanceof CheckInMakeupError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status })
    console.error('[checkin.makeup.challenge.create]', error)
    return NextResponse.json({ message: '挑战创建失败，请稍后重试' }, { status: 500 })
  }
}
