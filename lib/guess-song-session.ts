import { randomInt } from 'node:crypto'
import { Prisma, type GuessSongMode } from '@prisma/client'
import {
  GUESS_SONG_ANSWER_SECONDS,
  GUESS_SONG_INITIAL_LIVES,
  GUESS_SONG_MODE_CONFIG,
  calculateGuessSongScore,
  isGuessSongMode,
  normalizeGuessSongAnswer,
  toPublicGuessSongMode,
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
import {
  GUESS_SONG_RISK_THRESHOLD,
  GuessSongRiskService,
  createClientSessionNonce,
  ensureClientSessionCredentials,
  isQuestionAttemptTokenValid,
  issueQuestionAttemptToken,
} from '@/lib/guess-song-risk'
import { prisma } from '@/lib/prisma'
import { createUUID } from '@/lib/utils/uuid'

type OptionSnapshot = { key: string; label: string }

type EligibleQuestion = {
  id: string
  songTitle: string
  musicSongId: string | null
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

function answerDeadlineAtToAvailableAt(deadline: Date | null) {
  const availableAt = deadline
    ? new Date(deadline.getTime() - GUESS_SONG_ANSWER_SECONDS * 1000)
    : null
  return availableAt?.toISOString() ?? null
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
    mode: GuessSongMode
  },
) {
  const expert = input.mode === 'EXPERT'
  if (expert && !input.question.musicSongId) {
    throw new GuessSongServiceError('专家模式题目必须关联 EasMusic 歌曲', 409, 'EXPERT_QUESTION_INVALID')
  }
  const { options, correctOptionKey } = expert
    ? { options: [], correctOptionKey: input.question.musicSongId || '' }
    : createOptions(input.question)
  const publicId = createUUID()
  const questionAttemptToken = issueQuestionAttemptToken(publicId)
  return tx.guessSongSessionQuestion.create({
    data: {
      sessionId: input.sessionId,
      questionId: input.question.id,
      publicId,
      position: input.position,
      playbackDurationSeconds: input.durationSeconds,
      maxPlayCount: input.maxPlayCount,
      questionAttemptTokenHash: questionAttemptToken.hash,
      optionsSnapshot: options,
      correctOptionKey,
    },
  })
}

/** Manual questions keep their original rules; AUTO questions serve every mode
    but only while their album is published and auto generation is enabled. */
function eligibleSourceFilter(mode: GuessSongMode, autoEnabled: boolean): Prisma.GuessSongQuestionWhereInput[] {
  const expertSongFilter = mode === 'EXPERT'
    ? { musicSongId: { not: null }, MusicSong: { expertEnabled: true } }
    : {}
  const autoBranch: Prisma.GuessSongQuestionWhereInput[] = autoEnabled
    ? [{
      questionType: GUESS_SONG_QUESTION_TYPE_AUTO,
      ...(mode === 'EXPERT'
        ? { musicSongId: { not: null }, MusicSong: { expertEnabled: true, MusicAlbum: { status: 'PUBLISHED' } } }
        : { MusicSong: { MusicAlbum: { status: 'PUBLISHED' } } }),
    }]
    : []
  if (mode === 'ENDLESS' || mode === 'EXPERT') {
    return [{ questionType: GUESS_SONG_QUESTION_TYPE_MANUAL, ...expertSongFilter }, ...autoBranch]
  }
  return [{ questionType: GUESS_SONG_QUESTION_TYPE_MANUAL, difficulty: mode }, ...autoBranch]
}

function eligibleQuestionWhere(mode: GuessSongMode, autoEnabled: boolean): Prisma.GuessSongQuestionWhereInput {
  const config = GUESS_SONG_MODE_CONFIG[mode]
  return {
    enabled: true,
    processingStatus: 'READY',
    ...(mode === 'ENDLESS' ? { allowEndless: true } : {}),
    OR: eligibleSourceFilter(mode, autoEnabled),
    GuessSongAudioVariant: {
      some: { durationSeconds: config.durationSeconds, purpose: 'GAME' },
    },
  }
}

async function findEligibleQuestions(mode: GuessSongMode, autoEnabled: boolean) {
  return prisma.guessSongQuestion.findMany({
    where: eligibleQuestionWhere(mode, autoEnabled),
    select: {
      id: true,
      songTitle: true,
      musicSongId: true,
      correctAnswer: true,
      wrongOption1: true,
      wrongOption2: true,
      wrongOption3: true,
      GuessSongAudioVariant: { where: { purpose: 'GAME' }, select: { id: true, durationSeconds: true, storagePath: true } },
    },
  })
}

async function createNextInfiniteQuestion(
  tx: Prisma.TransactionClient,
  sessionId: string,
  position: number,
  previousQuestionId: string | undefined,
  mode: GuessSongMode,
  autoEnabled: boolean,
) {
  const candidates = await tx.guessSongQuestion.findMany({
    where: eligibleQuestionWhere(mode, autoEnabled),
    select: {
      id: true,
      songTitle: true,
      musicSongId: true,
      correctAnswer: true,
      wrongOption1: true,
      wrongOption2: true,
      wrongOption3: true,
      GuessSongAudioVariant: { where: { purpose: 'GAME' }, select: { id: true, durationSeconds: true, storagePath: true } },
    },
  })
  if (candidates.length === 0) throw new GuessSongServiceError(`${GUESS_SONG_MODE_CONFIG[mode].label}模式题库暂不可用`, 409, 'QUESTION_POOL_EMPTY')
  const withoutPrevious = candidates.filter((question) => question.id !== previousQuestionId)
  const pool = withoutPrevious.length > 0 ? withoutPrevious : candidates
  const question = pool[randomInt(pool.length)]
  return createSessionQuestion(tx, {
    sessionId,
    question,
    position,
    durationSeconds: GUESS_SONG_MODE_CONFIG[mode].durationSeconds,
    maxPlayCount: GUESS_SONG_MODE_CONFIG[mode].maxPlayCount,
    mode,
  })
}

export async function createOrResumeGuessSongSession(
  userId: string,
  requestedMode: unknown,
  now = new Date(),
) {
  if (!isGuessSongMode(requestedMode)) throw new GuessSongServiceError('请选择有效游戏模式')
  // ENDLESS is kept only for old database rows and old deep links. A new start
  // through that legacy value opens the replacement simple challenge instead.
  const mode: GuessSongMode = requestedMode === 'ENDLESS' ? 'EASY' : requestedMode
  const active = await prisma.guessSongSession.findFirst({
    where: {
      userId,
      mode: mode === 'EASY' ? { in: ['EASY', 'ENDLESS'] } : mode,
      status: 'IN_PROGRESS',
    },
    orderBy: { createdAt: 'desc' },
  })
  if (active && active.expiresAt > now) {
    return { resumed: true, session: await getGuessSongSessionState(userId, active.id, now) }
  }
  if (active) {
    await prisma.guessSongSession.update({ where: { id: active.id }, data: { status: 'EXPIRED', activeKey: null } })
  }

  const quizConfig = await getGuessSongQuizConfigOrDefault()
  if (mode === 'EXPERT' && !quizConfig.expertEnabled) {
    throw new GuessSongServiceError('专家模式当前未开放', 409, 'EXPERT_DISABLED')
  }
  const candidates = await findEligibleQuestions(mode, quizConfig.enabled)
  const config = GUESS_SONG_MODE_CONFIG[mode]
  if (candidates.length === 0) throw new GuessSongServiceError(`${config.label}模式暂无可用题目`, 409, 'QUESTION_POOL_EMPTY')

  try {
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.guessSongSession.create({
        data: {
          userId,
          activeKey: `${userId}:${mode}`,
          mode,
          clientSessionNonce: createClientSessionNonce(),
          clientSessionTokenIssuedAt: now,
          livesRemaining: config.maxWrongCount || GUESS_SONG_INITIAL_LIVES,
          questionCount: null,
          expiresAt: sessionExpiry(mode, now),
          startedAt: now,
        },
      })

      await createNextInfiniteQuestion(tx, created.id, 1, undefined, mode, quizConfig.enabled)
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

  const clientCredentials = await ensureClientSessionCredentials(session, null, now)
  const currentQuestion = await prisma.guessSongSessionQuestion.findUnique({
    where: { sessionId_position: { sessionId, position: session.currentPosition } },
  })
  let questionAttemptToken: string | null = null
  if (session.status === 'IN_PROGRESS' && currentQuestion && !currentQuestion.answeredAt) {
    const issued = issueQuestionAttemptToken(currentQuestion.publicId)
    if (currentQuestion.questionAttemptTokenHash !== issued.hash) {
      await prisma.guessSongSessionQuestion.updateMany({
        where: { id: currentQuestion.id, answeredAt: null },
        data: { questionAttemptTokenHash: issued.hash },
      })
    }
    questionAttemptToken = issued.token
  }
  const config = GUESS_SONG_MODE_CONFIG[session.mode]
  const publicMode = toPublicGuessSongMode(session.mode)
  return {
    id: session.id,
    mode: publicMode,
    modeLabel: GUESS_SONG_MODE_CONFIG[publicMode].label,
    status: session.status,
    score: session.score,
    riskScore: session.riskScore,
    isValid: session.isValid,
    clientSessionToken: clientCredentials.clientSessionToken,
    correctCount: session.correctCount,
    wrongCount: session.wrongCount,
    currentStreak: session.currentStreak,
    maxStreak: session.maxStreak,
    livesRemaining: session.livesRemaining,
    maxWrongCount: session.questionCount === null ? config.maxWrongCount : null,
    totalPlayCount: session.totalPlayCount,
    currentPosition: session.currentPosition,
    totalQuestions: session.questionCount ?? null,
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    question: session.status === 'IN_PROGRESS' && currentQuestion
      ? {
          publicId: currentQuestion.publicId,
          questionAttemptToken,
          position: currentQuestion.position,
          playbackDurationSeconds: currentQuestion.playbackDurationSeconds,
          maxPlayCount: currentQuestion.maxPlayCount,
          playCount: currentQuestion.playCount,
          remainingPlayCount: currentQuestion.maxPlayCount - currentQuestion.playCount,
          answerMode: config.answerMode,
          options: parseOptions(currentQuestion.optionsSnapshot),
          answerDeadlineAt: currentQuestion.answerDeadlineAt?.toISOString() ?? null,
          answerAvailableAt: answerDeadlineAtToAvailableAt(currentQuestion.answerDeadlineAt),
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
  clientSessionToken?: string | null
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
          answerAvailableAt: answerDeadlineAtToAvailableAt(playable.sessionQuestion.answerDeadlineAt),
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
          firstPlayedAt: playable.sessionQuestion.firstPlayedAt ?? now,
          answerDeadlineAt: playable.sessionQuestion.answerDeadlineAt
            ?? new Date(now.getTime() + (
              GUESS_SONG_MODE_CONFIG[playable.sessionQuestion.GuessSongSession.mode].answerMode === 'INPUT'
                ? playable.sessionQuestion.playbackDurationSeconds
                : 0
            ) * 1000 + GUESS_SONG_ANSWER_SECONDS * 1000),
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
        answerAvailableAt: answerDeadlineAtToAvailableAt(after.answerDeadlineAt),
      }
    })
    const risk = await GuessSongRiskService.assess({
      userId: input.userId,
      sessionId: input.sessionId,
      trigger: 'PLAY',
      clientSessionToken: input.clientSessionToken,
      now,
    })
    return {
      ...result,
      signedUrl: risk.cheatDetected ? '' : signedUrl,
      expiresIn: risk.cheatDetected ? 0 : signedUrlExpires,
      durationSeconds: playable.sessionQuestion.playbackDurationSeconds,
      cheatDetected: risk.cheatDetected,
      ...(risk.cheatDetected ? { exitAfterSeconds: risk.exitAfterSeconds } : {}),
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
          answerAvailableAt: answerDeadlineAtToAvailableAt(playable.sessionQuestion.answerDeadlineAt),
        }
      }
    }
    throw error
  }
}

type AnswerOutcome = {
  duplicate: boolean
  correct: boolean
  answerStatus: 'CORRECT' | 'WRONG' | 'UNKNOWN'
  skipped: boolean
  correctSongTitle: string
  correctSongArtist: string | null
  correctSongAlbumTitle: string | null
  correctSongReleaseYear: number | null
  correctSongDescription: string | null
  awardedScore: number
}

const GUESS_SONG_SKIPPED_OPTION = '__SKIPPED__'

type MusicSongWithAlbum = Prisma.MusicSongGetPayload<{ include: { MusicAlbum: true } }>

function getGuessSongAnswerDetails(question: {
  songTitle: string
  albumTitle: string | null
  MusicSong: MusicSongWithAlbum | null
}) {
  const song = question.MusicSong
  const album = song?.MusicAlbum
  return {
    correctSongTitle: question.songTitle,
    correctSongArtist: song?.artist ?? null,
    correctSongAlbumTitle: album?.name ?? question.albumTitle ?? null,
    correctSongReleaseYear: song?.releaseYear ?? album?.releaseYear ?? null,
    correctSongDescription:
      song?.description?.trim()
      || song?.story?.trim()
      || album?.description?.trim()
      || album?.story?.trim()
      || null,
  }
}

export async function answerGuessSongQuestion(input: {
  userId: string
  sessionId: string
  publicQuestionId: string
  optionKey: string | null
  answerText?: string | null
  skip?: boolean
  clientSessionToken?: string | null
  questionAttemptToken?: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  let outcome: AnswerOutcome
  try {
    outcome = await prisma.$transaction<AnswerOutcome>(async (tx) => {
    const question = await tx.guessSongSessionQuestion.findUnique({
      where: { publicId: input.publicQuestionId },
      include: {
        GuessSongSession: true,
        GuessSongQuestion: { include: { MusicSong: { include: { MusicAlbum: true } } } },
      },
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
        answerStatus: question.selectedOptionKey === GUESS_SONG_SKIPPED_OPTION
          ? 'UNKNOWN'
          : question.isCorrect ? 'CORRECT' : 'WRONG',
        skipped: question.selectedOptionKey === GUESS_SONG_SKIPPED_OPTION,
        ...getGuessSongAnswerDetails(question.GuessSongQuestion),
        awardedScore: question.awardedScore,
      }
    }

    if (!isQuestionAttemptTokenValid(input.questionAttemptToken, question.questionAttemptTokenHash)) {
      throw new GuessSongServiceError('鏈 answer token 鏃犳晥鎴栧凡浣跨敤', 409, 'QUESTION_ATTEMPT_TOKEN_INVALID')
    }

    const expert = question.GuessSongSession.mode === 'EXPERT'
    const timedOut = Boolean(question.answerDeadlineAt && question.answerDeadlineAt <= now)
    const skipped = Boolean(input.skip && expert && !timedOut)
    if (input.skip && !expert) throw new GuessSongServiceError('只有专家模式可以跳过本题', 409, 'SKIP_NOT_SUPPORTED')
    if (question.playCount < 1) throw new GuessSongServiceError('请先播放音频再作答')

    const options = parseOptions(question.optionsSnapshot)
    let selectedOptionKey = '__TIMEOUT__'
    let correct = false
    if (skipped) {
      selectedOptionKey = GUESS_SONG_SKIPPED_OPTION
    } else if (!timedOut && expert) {
      const answerText = input.answerText?.trim() || ''
      if (!answerText) {
        throw new GuessSongServiceError('请输入或选择歌曲名称')
      }
      const targetSongId = question.GuessSongQuestion.musicSongId
      const targetSongTitle = question.GuessSongQuestion.MusicSong?.title || question.GuessSongQuestion.songTitle
      const normalizedText = normalizeGuessSongAnswer(answerText)
      const titleMatches = Boolean(normalizedText && normalizedText === normalizeGuessSongAnswer(targetSongTitle))
      selectedOptionKey = normalizedText
      correct = Boolean(targetSongId && titleMatches)
    } else if (!timedOut) {
      if (input.optionKey === null) {
        throw new GuessSongServiceError('本题尚未超时', 409, 'QUESTION_NOT_TIMED_OUT')
      }
      if (!options.some((option) => option.key === input.optionKey)) {
        throw new GuessSongServiceError('答案选项无效')
      }
      selectedOptionKey = input.optionKey
      correct = selectedOptionKey === question.correctOptionKey
    }
    const nextStreak = correct ? question.GuessSongSession.currentStreak + 1 : 0
    const awardedScore = calculateGuessSongScore({
      mode: question.GuessSongSession.mode,
      playCount: question.playCount,
      streak: nextStreak,
      durationSeconds: question.playbackDurationSeconds,
      correct,
    })
    const infiniteSession = question.GuessSongSession.questionCount === null
    const livesRemaining = infiniteSession && !correct
      ? Math.max(0, question.GuessSongSession.livesRemaining - 1)
      : question.GuessSongSession.livesRemaining
    const fixedLengthCompleted = question.GuessSongSession.questionCount !== null
      && question.position >= question.GuessSongSession.questionCount
    const completed = fixedLengthCompleted || (infiniteSession && livesRemaining === 0)

    const claimed = await tx.guessSongSessionQuestion.updateMany({
      where: { id: question.id, selectedOptionKey: null, answeredAt: null },
      data: {
        selectedOptionKey,
        isCorrect: correct,
        awardedScore,
        answeredAt: now,
        questionAttemptTokenHash: null,
        answerLatencyMs: question.firstPlayedAt
          ? Math.max(0, now.getTime() - question.firstPlayedAt.getTime())
          : null,
      },
    })
    if (claimed.count !== 1) {
      const existing = await tx.guessSongSessionQuestion.findUniqueOrThrow({
        where: { id: question.id },
        include: { GuessSongQuestion: { include: { MusicSong: { include: { MusicAlbum: true } } } } },
      })
      return {
        duplicate: true,
        correct: Boolean(existing.isCorrect),
        answerStatus: existing.selectedOptionKey === GUESS_SONG_SKIPPED_OPTION
          ? 'UNKNOWN'
          : existing.isCorrect ? 'CORRECT' : 'WRONG',
        skipped: existing.selectedOptionKey === GUESS_SONG_SKIPPED_OPTION,
        ...getGuessSongAnswerDetails(existing.GuessSongQuestion),
        awardedScore: existing.awardedScore,
      }
    }

    if (!skipped) {
      await tx.guessSongQuestion.update({
        where: { id: question.questionId },
        data: {
          answerCount: { increment: 1 },
          ...(correct ? { correctCount: { increment: 1 } } : {}),
        },
      })
    }
    await tx.guessSongSession.update({
      where: { id: input.sessionId },
      data: {
        score: { increment: awardedScore },
        correctCount: { increment: correct ? 1 : 0 },
        wrongCount: { increment: correct || skipped ? 0 : 1 },
        currentStreak: nextStreak,
        maxStreak: Math.max(question.GuessSongSession.maxStreak, nextStreak),
        livesRemaining,
        currentPosition: completed ? question.position : question.position + 1,
        ...(completed ? { status: 'COMPLETED', completedAt: now, activeKey: null } : {}),
      },
    })

    if (!completed && infiniteSession) {
      const quizConfig = await tx.guessSongQuizConfig.findUnique({ where: { id: GUESS_SONG_QUIZ_CONFIG_ID } })
      await createNextInfiniteQuestion(
        tx,
        input.sessionId,
        question.position + 1,
        question.questionId,
        question.GuessSongSession.mode,
        quizConfig?.enabled ?? true,
      )
    }

    return {
      duplicate: false,
      correct,
      answerStatus: skipped ? 'UNKNOWN' : correct ? 'CORRECT' : 'WRONG',
      skipped,
      ...getGuessSongAnswerDetails(question.GuessSongQuestion),
      awardedScore,
    }
    })
  } catch (error) {
    if (error instanceof GuessSongServiceError && error.code === 'QUESTION_ATTEMPT_TOKEN_INVALID') {
      const risk = await GuessSongRiskService.assess({
        userId: input.userId,
        sessionId: input.sessionId,
        trigger: 'ANSWER',
        clientSessionToken: input.clientSessionToken,
        questionAttemptTokenValid: false,
        now,
      })
      if (risk.cheatDetected) {
        return {
          duplicate: false,
          correct: false,
          answerStatus: 'WRONG' as const,
          skipped: false,
          correctSongTitle: '',
          correctSongArtist: null,
          correctSongAlbumTitle: null,
          correctSongReleaseYear: null,
          correctSongDescription: null,
          awardedScore: 0,
          session: await getGuessSongSessionState(input.userId, input.sessionId, now),
          ranks: null,
          cheatDetected: true,
          exitAfterSeconds: risk.exitAfterSeconds,
        }
      }
    }
    throw error
  }

  const risk = await GuessSongRiskService.assess({
    userId: input.userId,
    sessionId: input.sessionId,
    trigger: 'ANSWER',
    clientSessionToken: input.clientSessionToken,
    questionAttemptTokenValid: true,
    now,
  })
  const session = await getGuessSongSessionState(input.userId, input.sessionId, now)
  if (risk.cheatDetected) {
    return {
      ...outcome,
      session,
      ranks: null,
      cheatDetected: true,
      exitAfterSeconds: risk.exitAfterSeconds,
    }
  }
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
  const [weeklyEntries, monthlyEntries, recentSessionRow, activeSessionRows, quizConfig] = await Promise.all([
    prisma.guessSongLeaderboardEntry.findMany({
      where: {
        userId,
        periodType: 'WEEK',
        periodKey: week.periodKey,
        GuessSongSession: { isValid: true, riskScore: { lt: GUESS_SONG_RISK_THRESHOLD } },
      },
      orderBy: { score: 'desc' },
    }),
    prisma.guessSongLeaderboardEntry.findMany({
      where: {
        userId,
        periodType: 'MONTH',
        periodKey: month.periodKey,
        GuessSongSession: { isValid: true, riskScore: { lt: GUESS_SONG_RISK_THRESHOLD } },
      },
      orderBy: { score: 'desc' },
    }),
    prisma.guessSongSession.findFirst({
      where: { userId, status: 'COMPLETED', isValid: true, riskScore: { lt: GUESS_SONG_RISK_THRESHOLD } },
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
    getGuessSongQuizConfigOrDefault(),
  ])
  const recentSession = recentSessionRow
    ? { ...recentSessionRow, mode: toPublicGuessSongMode(recentSessionRow.mode) }
    : null
  const activeSessions = activeSessionRows.map((item) => ({
    ...item,
    mode: toPublicGuessSongMode(item.mode),
  }))
  return {
    expertEnabled: quizConfig.expertEnabled,
    weeklyBest: weeklyEntries[0]?.score ?? null,
    monthlyBest: monthlyEntries[0]?.score ?? null,
    recentSession,
    activeSessions,
  }
}
