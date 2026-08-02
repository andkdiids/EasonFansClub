import { randomInt } from 'node:crypto'
import { Prisma, type GuessSongMode } from '@prisma/client'
import {
  GUESS_SONG_ANSWER_SECONDS,
  GUESS_SONG_INITIAL_LIVES,
  GUESS_SONG_MODE_CONFIG,
  calculateGuessSongScore,
  isGuessSongMode,
} from '@/lib/guess-song-config'
import { getGuessSongPeriod } from '@/lib/guess-song-period'
import { getGuessSongRanks, recordGuessSongLeaderboard } from '@/lib/guess-song-leaderboard'
import {
  getGuessSongQuizConfigOrDefault,
  GUESS_SONG_QUESTION_TYPE_AUTO,
  GUESS_SONG_QUESTION_TYPE_MANUAL,
  GUESS_SONG_QUIZ_CONFIG_ID,
} from '@/lib/guess-song-quiz-config'
import {
  createGuessSongSignedUrl,
  getGuessSongSignedUrlExpires,
} from '@/lib/guess-song-storage'
import { prisma } from '@/lib/prisma'
import { createUUID } from '@/lib/utils/uuid'

type OptionSnapshot = { key: string; label: string }

type EligibleQuestion = {
  id: string
  songTitle: string
  correctAnswer: string
  wrongOption1: string
  wrongOption2: string
  wrongOption3: string
  GuessSongAudioVariant: Array<{ id: string; durationSeconds: number; storagePath: string }>
}

export class GuessSongServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'GUESS_SONG_ERROR',
  ) {
    super(message)
    this.name = 'GuessSongServiceError'
  }
}

function shuffle<T>(items: readonly T[]) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function createOptions(question: EligibleQuestion) {
  const options = shuffle([
    { label: question.correctAnswer, correct: true },
    { label: question.wrongOption1, correct: false },
    { label: question.wrongOption2, correct: false },
    { label: question.wrongOption3, correct: false },
  ]).map((option) => ({ ...option, key: createUUID() }))
  return {
    options: options.map(({ key, label }) => ({ key, label })),
    correctOptionKey: options.find((option) => option.correct)?.key || options[0].key,
  }
}

function parseOptions(value: Prisma.JsonValue): OptionSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const key = 'key' in item ? item.key : null
    const label = 'label' in item ? item.label : null
    return typeof key === 'string' && typeof label === 'string' ? [{ key, label }] : []
  })
}

function sessionExpiry(mode: GuessSongMode, now: Date) {
  return new Date(now.getTime() + GUESS_SONG_MODE_CONFIG[mode].sessionMinutes * 60_000)
}

async function createSessionQuestion(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string
    question: EligibleQuestion
    position: number
    durationSeconds: number
    maxPlayCount: number
  },
) {
  const { options, correctOptionKey } = createOptions(input.question)
  return tx.guessSongSessionQuestion.create({
    data: {
      sessionId: input.sessionId,
      questionId: input.question.id,
      publicId: createUUID(),
      position: input.position,
      playbackDurationSeconds: input.durationSeconds,
      maxPlayCount: input.maxPlayCount,
      optionsSnapshot: options,
      correctOptionKey,
    },
  })
}

/** Manual questions keep their original rules; AUTO questions serve every mode
    but only while their album is published and auto generation is enabled. */
function eligibleSourceFilter(mode: GuessSongMode, autoEnabled: boolean): Prisma.GuessSongQuestionWhereInput[] {
  const autoBranch: Prisma.GuessSongQuestionWhereInput[] = autoEnabled
    ? [{ questionType: GUESS_SONG_QUESTION_TYPE_AUTO, MusicSong: { MusicAlbum: { status: 'PUBLISHED' } } }]
    : []
  if (mode === 'ENDLESS') {
    return [{ questionType: GUESS_SONG_QUESTION_TYPE_MANUAL }, ...autoBranch]
  }
  return [{ questionType: GUESS_SONG_QUESTION_TYPE_MANUAL, difficulty: mode }, ...autoBranch]
}

async function findEligibleQuestions(mode: GuessSongMode, autoEnabled: boolean) {
  const config = GUESS_SONG_MODE_CONFIG[mode]
  return prisma.guessSongQuestion.findMany({
    where: mode === 'ENDLESS'
      ? {
          enabled: true,
          allowEndless: true,
          processingStatus: 'READY',
          OR: eligibleSourceFilter(mode, autoEnabled),
          GuessSongAudioVariant: { some: { durationSeconds: GUESS_SONG_MODE_CONFIG.ENDLESS.durationSeconds, purpose: 'GAME' } },
        }
      : {
          enabled: true,
          processingStatus: 'READY',
          OR: eligibleSourceFilter(mode, autoEnabled),
          GuessSongAudioVariant: { some: { durationSeconds: config.durationSeconds ?? undefined, purpose: 'GAME' } },
        },
    select: {
      id: true,
      songTitle: true,
      correctAnswer: true,
      wrongOption1: true,
      wrongOption2: true,
      wrongOption3: true,
      GuessSongAudioVariant: { where: { purpose: 'GAME' }, select: { id: true, durationSeconds: true, storagePath: true } },
    },
  })
}

async function createNextEndlessQuestion(
  tx: Prisma.TransactionClient,
  sessionId: string,
  position: number,
  previousQuestionId: string | undefined,
  autoEnabled: boolean,
) {
  const candidates = await tx.guessSongQuestion.findMany({
    where: {
      enabled: true,
      allowEndless: true,
      processingStatus: 'READY',
      OR: eligibleSourceFilter('ENDLESS', autoEnabled),
      GuessSongAudioVariant: { some: { durationSeconds: GUESS_SONG_MODE_CONFIG.ENDLESS.durationSeconds, purpose: 'GAME' } },
    },
    select: {
      id: true,
      songTitle: true,
      correctAnswer: true,
      wrongOption1: true,
      wrongOption2: true,
      wrongOption3: true,
      GuessSongAudioVariant: { where: { purpose: 'GAME' }, select: { id: true, durationSeconds: true, storagePath: true } },
    },
  })
  if (candidates.length === 0) throw new GuessSongServiceError('无尽模式题库暂不可用', 409, 'QUESTION_POOL_EMPTY')
  const withoutPrevious = candidates.filter((question) => question.id !== previousQuestionId)
  const pool = withoutPrevious.length > 0 ? withoutPrevious : candidates
  const question = pool[randomInt(pool.length)]
  return createSessionQuestion(tx, {
    sessionId,
    question,
    position,
    durationSeconds: GUESS_SONG_MODE_CONFIG.ENDLESS.durationSeconds,
    maxPlayCount: GUESS_SONG_MODE_CONFIG.ENDLESS.maxPlayCount,
  })
}

export async function createOrResumeGuessSongSession(
  userId: string,
  requestedMode: unknown,
  now = new Date(),
) {
  if (!isGuessSongMode(requestedMode)) throw new GuessSongServiceError('请选择有效游戏模式')
  const mode = requestedMode
  const active = await prisma.guessSongSession.findFirst({
    where: { userId, mode, status: 'IN_PROGRESS' },
    orderBy: { createdAt: 'desc' },
  })
  if (active && active.expiresAt > now) {
    return { resumed: true, session: await getGuessSongSessionState(userId, active.id, now) }
  }
  if (active) {
    await prisma.guessSongSession.update({ where: { id: active.id }, data: { status: 'EXPIRED', activeKey: null } })
  }

  const quizConfig = await getGuessSongQuizConfigOrDefault()
  const candidates = await findEligibleQuestions(mode, quizConfig.enabled)
  const config = GUESS_SONG_MODE_CONFIG[mode]
  const questionCount = mode === 'ENDLESS' ? null : quizConfig.questionCount ?? config.questionCount ?? 10
  if (mode !== 'ENDLESS' && candidates.length < (questionCount ?? 10)) {
    throw new GuessSongServiceError(
      `${config.label}模式至少需要 ${questionCount} 道已启用且音频就绪的题目，当前只有 ${candidates.length} 道`,
      409,
      'QUESTION_POOL_INSUFFICIENT',
    )
  }
  if (mode === 'ENDLESS' && candidates.length === 0) {
    throw new GuessSongServiceError('无尽模式暂无可用题目', 409, 'QUESTION_POOL_EMPTY')
  }

  try {
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.guessSongSession.create({
        data: {
          userId,
          activeKey: `${userId}:${mode}`,
          mode,
          livesRemaining: mode === 'ENDLESS' ? GUESS_SONG_INITIAL_LIVES : 0,
          questionCount,
          expiresAt: sessionExpiry(mode, now),
          startedAt: now,
        },
      })

      if (mode === 'ENDLESS') {
        await createNextEndlessQuestion(tx, created.id, 1, undefined, quizConfig.enabled)
      } else {
        const selected = shuffle(candidates).slice(0, questionCount ?? 10)
        for (let index = 0; index < selected.length; index += 1) {
          await createSessionQuestion(tx, {
            sessionId: created.id,
            question: selected[index],
            position: index + 1,
            durationSeconds: config.durationSeconds ?? 7,
            maxPlayCount: config.maxPlayCount,
          })
        }
      }
      return created
    })
    return { resumed: false, session: await getGuessSongSessionState(userId, session.id, now) }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await prisma.guessSongSession.findUnique({
        where: { activeKey: `${userId}:${mode}` },
      })
      if (concurrent) {
        return { resumed: true, session: await getGuessSongSessionState(userId, concurrent.id, now) }
      }
    }
    throw error
  }
}

export async function getGuessSongSessionState(userId: string, sessionId: string, now = new Date()) {
  const session = await prisma.guessSongSession.findUnique({
    where: { id: sessionId },
  }).catch(() => null)

  if (!session || session.userId !== userId) {
    throw new GuessSongServiceError('场次不存在或不属于当前用户', 404, 'SESSION_NOT_FOUND')
  }
  if (session.status === 'IN_PROGRESS' && session.expiresAt <= now) {
    await prisma.guessSongSession.update({ where: { id: session.id }, data: { status: 'EXPIRED', activeKey: null } })
    throw new GuessSongServiceError('本场游戏已过期，请重新开始', 410, 'SESSION_EXPIRED')
  }

  const currentQuestion = await prisma.guessSongSessionQuestion.findUnique({
    where: { sessionId_position: { sessionId, position: session.currentPosition } },
  })
  const config = GUESS_SONG_MODE_CONFIG[session.mode]
  return {
    id: session.id,
    mode: session.mode,
    modeLabel: config.label,
    status: session.status,
    score: session.score,
    correctCount: session.correctCount,
    wrongCount: session.wrongCount,
    currentStreak: session.currentStreak,
    maxStreak: session.maxStreak,
    livesRemaining: session.livesRemaining,
    totalPlayCount: session.totalPlayCount,
    currentPosition: session.currentPosition,
    totalQuestions: session.questionCount ?? config.questionCount,
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    question: session.status === 'IN_PROGRESS' && currentQuestion
      ? {
          publicId: currentQuestion.publicId,
          position: currentQuestion.position,
          playbackDurationSeconds: currentQuestion.playbackDurationSeconds,
          maxPlayCount: currentQuestion.maxPlayCount,
          playCount: currentQuestion.playCount,
          remainingPlayCount: currentQuestion.maxPlayCount - currentQuestion.playCount,
          options: parseOptions(currentQuestion.optionsSnapshot),
          answerDeadlineAt: currentQuestion.answerDeadlineAt?.toISOString() ?? null,
        }
      : null,
  }
}

async function getPlayableVariant(userId: string, sessionId: string, publicQuestionId: string, now: Date) {
  const sessionQuestion = await prisma.guessSongSessionQuestion.findUnique({
    where: { publicId: publicQuestionId },
    include: {
      GuessSongSession: true,
      GuessSongQuestion: {
        include: {
          GuessSongAudioVariant: true,
        },
      },
    },
  })
  if (!sessionQuestion || sessionQuestion.sessionId !== sessionId || sessionQuestion.GuessSongSession.userId !== userId) {
    throw new GuessSongServiceError('当前题目不存在或不属于本场游戏', 404, 'QUESTION_NOT_FOUND')
  }
  if (sessionQuestion.GuessSongSession.status !== 'IN_PROGRESS') {
    throw new GuessSongServiceError('本场游戏已经结束', 409, 'SESSION_FINISHED')
  }
  if (sessionQuestion.GuessSongSession.expiresAt <= now) {
    await prisma.guessSongSession.update({ where: { id: sessionId }, data: { status: 'EXPIRED', activeKey: null } })
    throw new GuessSongServiceError('本场游戏已过期', 410, 'SESSION_EXPIRED')
  }
  if (sessionQuestion.position !== sessionQuestion.GuessSongSession.currentPosition || sessionQuestion.answeredAt) {
    throw new GuessSongServiceError('只能播放当前未作答题目', 409, 'QUESTION_ORDER_INVALID')
  }
  if (sessionQuestion.answerDeadlineAt && sessionQuestion.answerDeadlineAt <= now) {
    throw new GuessSongServiceError('本题答题时间已结束', 409, 'QUESTION_TIMED_OUT')
  }
  const variant = sessionQuestion.GuessSongQuestion.GuessSongAudioVariant.find(
    (item) => item.purpose === 'GAME' && item.durationSeconds === sessionQuestion.playbackDurationSeconds,
  )
  if (!variant) throw new GuessSongServiceError('当前题目的音频文件缺失', 503, 'AUDIO_MISSING')
  return { sessionQuestion, variant }
}

export async function requestGuessSongPlayback(input: {
  userId: string
  sessionId: string
  publicQuestionId: string
  requestKey: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(input.requestKey)) {
    throw new GuessSongServiceError('播放请求标识无效')
  }
  const playable = await getPlayableVariant(
    input.userId,
    input.sessionId,
    input.publicQuestionId,
    now,
  )
  const signedUrlExpires = getGuessSongSignedUrlExpires()
  const signedUrl = await createGuessSongSignedUrl(playable.variant.storagePath, signedUrlExpires)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.guessSongPlayRequest.findUnique({
        where: {
          sessionQuestionId_requestKey: {
            sessionQuestionId: playable.sessionQuestion.id,
            requestKey: input.requestKey,
          },
        },
      })
      if (existing) {
        return {
          playCount: existing.playCountAfter,
          remainingPlayCount: playable.sessionQuestion.maxPlayCount - existing.playCountAfter,
          answerDeadlineAt: playable.sessionQuestion.answerDeadlineAt?.toISOString() ?? null,
        }
      }

      const updated = await tx.guessSongSessionQuestion.updateMany({
        where: {
          id: playable.sessionQuestion.id,
          GuessSongSession: { userId: input.userId, status: 'IN_PROGRESS', expiresAt: { gt: now } },
          answeredAt: null,
          playCount: { lt: playable.sessionQuestion.maxPlayCount },
        },
        data: {
          playCount: { increment: 1 },
          answerDeadlineAt: playable.sessionQuestion.answerDeadlineAt
            ?? new Date(now.getTime() + GUESS_SONG_ANSWER_SECONDS * 1000),
        },
      })
      if (updated.count !== 1) {
        throw new GuessSongServiceError('本题播放次数已用完', 409, 'PLAY_LIMIT_REACHED')
      }
      const after = await tx.guessSongSessionQuestion.findUniqueOrThrow({
        where: { id: playable.sessionQuestion.id },
        select: { playCount: true, maxPlayCount: true, answerDeadlineAt: true },
      })
      await Promise.all([
        tx.guessSongPlayRequest.create({
          data: {
            requestKey: input.requestKey,
            sessionQuestionId: playable.sessionQuestion.id,
            audioVariantId: playable.variant.id,
            playCountAfter: after.playCount,
          },
        }),
        tx.guessSongSession.update({
          where: { id: input.sessionId },
          data: { totalPlayCount: { increment: 1 } },
        }),
        tx.guessSongQuestion.update({
          where: { id: playable.sessionQuestion.questionId },
          data: { playCount: { increment: 1 } },
        }),
      ])
      return {
        playCount: after.playCount,
        remainingPlayCount: after.maxPlayCount - after.playCount,
        answerDeadlineAt: after.answerDeadlineAt?.toISOString() ?? null,
      }
    })
    return {
      ...result,
      signedUrl,
      expiresIn: signedUrlExpires,
      durationSeconds: playable.sessionQuestion.playbackDurationSeconds,
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.guessSongPlayRequest.findUnique({
        where: {
          sessionQuestionId_requestKey: {
            sessionQuestionId: playable.sessionQuestion.id,
            requestKey: input.requestKey,
          },
        },
      })
      if (existing) {
        return {
          signedUrl,
          expiresIn: signedUrlExpires,
          durationSeconds: playable.sessionQuestion.playbackDurationSeconds,
          playCount: existing.playCountAfter,
          remainingPlayCount: playable.sessionQuestion.maxPlayCount - existing.playCountAfter,
          answerDeadlineAt: playable.sessionQuestion.answerDeadlineAt?.toISOString() ?? null,
        }
      }
    }
    throw error
  }
}

type AnswerOutcome = {
  duplicate: boolean
  correct: boolean
  correctSongTitle: string
  awardedScore: number
}

export async function answerGuessSongQuestion(input: {
  userId: string
  sessionId: string
  publicQuestionId: string
  optionKey: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const outcome = await prisma.$transaction<AnswerOutcome>(async (tx) => {
    const question = await tx.guessSongSessionQuestion.findUnique({
      where: { publicId: input.publicQuestionId },
      include: { GuessSongSession: true, GuessSongQuestion: true },
    })
    if (!question || question.sessionId !== input.sessionId || question.GuessSongSession.userId !== input.userId) {
      throw new GuessSongServiceError('当前题目不存在或不属于当前用户', 404, 'QUESTION_NOT_FOUND')
    }
    if (question.GuessSongSession.expiresAt <= now) {
      await tx.guessSongSession.update({ where: { id: input.sessionId }, data: { status: 'EXPIRED', activeKey: null } })
      throw new GuessSongServiceError('本场游戏已过期', 410, 'SESSION_EXPIRED')
    }
    if (question.GuessSongSession.status !== 'IN_PROGRESS') {
      throw new GuessSongServiceError('本场游戏已经结束', 409, 'SESSION_FINISHED')
    }
    if (question.position !== question.GuessSongSession.currentPosition) {
      throw new GuessSongServiceError('请按题目顺序作答', 409, 'QUESTION_ORDER_INVALID')
    }
    if (question.answeredAt) {
      return {
        duplicate: true,
        correct: Boolean(question.isCorrect),
        correctSongTitle: question.GuessSongQuestion.songTitle,
        awardedScore: question.awardedScore,
      }
    }

    const options = parseOptions(question.optionsSnapshot)
    const timedOut = Boolean(question.answerDeadlineAt && question.answerDeadlineAt <= now)
    if (input.optionKey === null && !timedOut) {
      throw new GuessSongServiceError('本题尚未超时', 409, 'QUESTION_NOT_TIMED_OUT')
    }
    if (input.optionKey !== null && !options.some((option) => option.key === input.optionKey)) {
      throw new GuessSongServiceError('答案选项无效')
    }
    if (question.playCount < 1) throw new GuessSongServiceError('请先播放音频再作答')

    const selectedOptionKey = timedOut ? '__TIMEOUT__' : input.optionKey
    const correct = !timedOut && selectedOptionKey === question.correctOptionKey
    const nextStreak = correct ? question.GuessSongSession.currentStreak + 1 : 0
    const awardedScore = calculateGuessSongScore({
      mode: question.GuessSongSession.mode,
      playCount: question.playCount,
      streak: nextStreak,
      durationSeconds: question.playbackDurationSeconds,
      correct,
    })
    const livesRemaining = question.GuessSongSession.mode === 'ENDLESS' && !correct
      ? Math.max(0, question.GuessSongSession.livesRemaining - 1)
      : question.GuessSongSession.livesRemaining
    const normalCompleted = question.GuessSongSession.mode !== 'ENDLESS'
      && question.position >= (question.GuessSongSession.questionCount ?? GUESS_SONG_MODE_CONFIG[question.GuessSongSession.mode].questionCount ?? 10)
    const completed = normalCompleted || (question.GuessSongSession.mode === 'ENDLESS' && livesRemaining === 0)

    const claimed = await tx.guessSongSessionQuestion.updateMany({
      where: { id: question.id, selectedOptionKey: null, answeredAt: null },
      data: {
        selectedOptionKey,
        isCorrect: correct,
        awardedScore,
        answeredAt: now,
      },
    })
    if (claimed.count !== 1) {
      const existing = await tx.guessSongSessionQuestion.findUniqueOrThrow({
        where: { id: question.id },
        include: { GuessSongQuestion: true },
      })
      return {
        duplicate: true,
        correct: Boolean(existing.isCorrect),
        correctSongTitle: existing.GuessSongQuestion.songTitle,
        awardedScore: existing.awardedScore,
      }
    }

    await Promise.all([
      tx.guessSongQuestion.update({
        where: { id: question.questionId },
        data: {
          answerCount: { increment: 1 },
          ...(correct ? { correctCount: { increment: 1 } } : {}),
        },
      }),
      tx.guessSongSession.update({
        where: { id: input.sessionId },
        data: {
          score: { increment: awardedScore },
          correctCount: { increment: correct ? 1 : 0 },
          wrongCount: { increment: correct ? 0 : 1 },
          currentStreak: nextStreak,
          maxStreak: Math.max(question.GuessSongSession.maxStreak, nextStreak),
          livesRemaining,
          currentPosition: completed ? question.position : question.position + 1,
          ...(completed ? { status: 'COMPLETED', completedAt: now, activeKey: null } : {}),
        },
      }),
    ])

    if (!completed && question.GuessSongSession.mode === 'ENDLESS') {
      const quizConfig = await tx.guessSongQuizConfig.findUnique({ where: { id: GUESS_SONG_QUIZ_CONFIG_ID } })
      await createNextEndlessQuestion(
        tx,
        input.sessionId,
        question.position + 1,
        question.questionId,
        quizConfig?.enabled ?? true,
      )
    }

    return {
      duplicate: false,
      correct,
      correctSongTitle: question.GuessSongQuestion.songTitle,
      awardedScore,
    }
  })

  const session = await getGuessSongSessionState(input.userId, input.sessionId, now)
  let ranks: { weekRank: number | null; monthRank: number | null } | null = null
  if (session.status === 'COMPLETED') {
    await recordGuessSongLeaderboard(input.sessionId)
    ranks = await getGuessSongRanks(input.userId, session.mode, now)
  }
  return { ...outcome, session, ranks }
}

export async function abandonGuessSongSession(userId: string, sessionId: string) {
  const updated = await prisma.guessSongSession.updateMany({
    where: { id: sessionId, userId, status: 'IN_PROGRESS' },
    data: { status: 'ABANDONED', activeKey: null },
  })
  if (updated.count !== 1) {
    throw new GuessSongServiceError('场次不存在或已经结束', 404, 'SESSION_NOT_ACTIVE')
  }
  return { id: sessionId, status: 'ABANDONED' as const }
}

export async function getGuessSongLobbySummary(userId: string, now = new Date()) {
  const week = getGuessSongPeriod('WEEK', now)
  const month = getGuessSongPeriod('MONTH', now)
  const [weeklyEntries, monthlyEntries, recentSession, activeSessions] = await Promise.all([
    prisma.guessSongLeaderboardEntry.findMany({
      where: { userId, periodType: 'WEEK', periodKey: week.periodKey },
      orderBy: { score: 'desc' },
    }),
    prisma.guessSongLeaderboardEntry.findMany({
      where: { userId, periodType: 'MONTH', periodKey: month.periodKey },
      orderBy: { score: 'desc' },
    }),
    prisma.guessSongSession.findFirst({
      where: { userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        mode: true,
        score: true,
        correctCount: true,
        wrongCount: true,
        maxStreak: true,
        totalPlayCount: true,
        completedAt: true,
      },
    }),
    prisma.guessSongSession.findMany({
      where: { userId, status: 'IN_PROGRESS', expiresAt: { gt: now } },
      select: { id: true, mode: true, currentPosition: true, expiresAt: true },
    }),
  ])
  return {
    weeklyBest: weeklyEntries[0]?.score ?? null,
    monthlyBest: monthlyEntries[0]?.score ?? null,
    recentSession,
    activeSessions,
  }
}
